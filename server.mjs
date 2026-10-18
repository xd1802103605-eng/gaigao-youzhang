import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRequirements, compareRequirements } from './core/engine.mjs';
import { analyzeWithModel, testModelConnection } from './core/ai.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 300000;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.deepseek.com https://dashscope.aliyuncs.com https://*.cn-beijing.maas.aliyuncs.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
function json(res, status, value) {
  res.writeHead(status, { ...SECURITY, 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(value));
}
async function requestBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    const error = new Error('接口仅接受 JSON 数据。'); error.status = 415; throw error;
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { const error = new Error('请求内容过大，请分段处理。'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('请求不是有效的 JSON。'); error.status = 400; throw error; }
}

export function createAppServer({ modelFunction = analyzeWithModel, connectionFunction = testModelConnection } = {}) {
  return http.createServer(async (req, res) => {
    let modelRequest = false;
    try {
      // Loopback binding + Host and Origin checks prevent hostile webpages from
      // using this server as a model proxy through DNS rebinding or a form POST.
      const host = req.headers.host || '';
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return json(res, 403, { error: '只允许本机访问。' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return json(res, 403, { error: '不允许其他网页调用本地接口。' });
      const url = new URL(req.url, `http://${host}`);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: '路径格式不正确。' }); }
      if (pathname.startsWith('/api/')) {
        if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, mode: 'local', version: '1.2.0' });
        if (req.method !== 'POST') return json(res, 405, { error: '此接口需要 POST 请求。' });
        if (!['/api/analyze', '/api/compare', '/api/model', '/api/model/test'].includes(pathname)) return json(res, 404, { error: '接口不存在。' });
        const body = await requestBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: '请求内容格式不正确。' });
        if (pathname === '/api/model/test') {
          modelRequest = true;
          // Ignore all other body fields so a connection check cannot forward
          // project text or confirmed requirements to the model service.
          const result = await connectionFunction({ config: body.config });
          return json(res, 200, result);
        }
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 50000) return json(res, 400, { error: '请输入 1 至 50,000 个字符的聊天内容。' });
        const baseline = body.baseline ?? body.baselineRequirements ?? [];
        if (!Array.isArray(baseline) || baseline.length > 100 || baseline.some(x => !x || typeof x.field !== 'string' || typeof x.value !== 'string' || x.value.length > 2000)) return json(res, 400, { error: '已确认需求格式不正确。' });
        let result;
        if (pathname === '/api/analyze') result = parseRequirements(body.text, body.options);
        else if (pathname === '/api/compare') result = compareRequirements(baseline, body.text, body.options);
        else {
          modelRequest = true;
          result = await modelFunction({ operation: body.operation, text: body.text, baseline, config: body.config });
        }
        return json(res, 200, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '只支持读取页面。' });
      const coreFile = pathname.startsWith('/core/');
      const folder = path.join(ROOT, coreFile ? 'core' : 'dist');
      const relative = pathname === '/' ? 'index.html' : coreFile ? pathname.slice('/core/'.length) : pathname.slice(1);
      if (!relative || relative.includes('\0') || relative.includes('\\')) return json(res, 404, { error: '文件不存在。' });
      const file = path.resolve(folder, relative);
      if (!file.startsWith(`${folder}${path.sep}`) || (coreFile && !['engine.mjs', 'ai.mjs'].includes(relative))) return json(res, 404, { error: '文件不存在。' });
      let bytes;
      try { bytes = await readFile(file); } catch { return json(res, 404, { error: '文件不存在。' }); }
      res.writeHead(200, { ...SECURITY, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length });
      return res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      // Never log request bodies, upstream responses or API keys.
      const safe = !modelRequest || error.safeForUser === true;
      const message = safe ? (error.message || '处理失败，请重试。') : '模型调用失败，请检查设置后重试。';
      if (!res.headersSent) json(res, modelRequest ? 400 : (error.status || 400), { error: message,
        ...(modelRequest && safe && typeof error.code === 'string' ? { code: error.code } : {}) });
      else res.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createAppServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '4173 端口已在使用。请在浏览器打开 http://127.0.0.1:4173，或关闭旧窗口后重试。' : '本地服务启动失败。');
    process.exitCode = 1;
  });
  server.listen(4173, '127.0.0.1', () => console.log('改稿有账已启动：http://127.0.0.1:4173\n关闭此窗口即可停止服务。'));
}
