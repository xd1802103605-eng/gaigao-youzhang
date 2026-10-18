import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAppServer } from '../server.mjs';

async function start(t, options) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (url, body, extra = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });

test('health and browser core modules are served with privacy and content headers', async t => {
  const root = await start(t);
  const response = await fetch(`${root}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, mode: 'local', version: '1.2.0' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const core = await fetch(`${root}/core/engine.mjs`);
  assert.equal(core.status, 200);
  assert(core.headers.get('content-type').includes('javascript'));
  assert((await core.text()).includes('parseRequirements'));
});

test('local analysis and compare use actual request text', async t => {
  const root = await start(t);
  const initial = await post(`${root}/api/analyze`, { text: '做一张招生海报，1080×1920，10月24日交付。' });
  assert.equal(initial.status, 200);
  const result = await initial.json();
  assert(result.requirements.some(x => x.value === '招生海报'));
  const compare = await post(`${root}/api/compare`, { baseline: result.requirements, text: '改到10月25日交付。' });
  assert.equal(compare.status, 200);
  assert.equal((await compare.json()).changes[0].after, '10月25日');
});

test('invalid bodies, wrong methods, missing routes and private files are rejected', async t => {
  const root = await start(t);
  assert.equal((await post(`${root}/api/analyze`, { text: '' })).status, 400);
  assert.equal((await fetch(`${root}/api/analyze`)).status, 405);
  assert.equal((await post(`${root}/api/no-such-route`, { text: 'x' })).status, 404);
  assert.equal((await fetch(`${root}/package.json`)).status, 404);
  assert.equal((await fetch(`${root}/core/../server.mjs`)).status, 404);
  assert.equal((await fetch(`${root}/core/%5C..%5Cserver.mjs`)).status, 404);
  assert.equal((await fetch(`${root}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${root}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
});

test('cross-origin calls are rejected before any model request', async t => {
  let calls = 0;
  const root = await start(t, { modelFunction: async () => { calls++; return {}; } });
  const response = await post(`${root}/api/model`, { text: '海报', config: {} }, { Origin: 'https://malicious.example' });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('model endpoint passes request config in memory and never returns the key', async t => {
  let received;
  const root = await start(t, { modelFunction: async args => { received = args; return { requirements: [], mode: 'model' }; } });
  const response = await post(`${root}/api/model`, { text: '海报', operation: 'analyze', config: { provider: 'deepseek', apiKey: 'secret-request-only' } });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(received.config.apiKey, 'secret-request-only');
  assert(!body.includes('secret-request-only'));
});

test('connection endpoint accepts only config and does not forward customer text or baseline', async t => {
  let received;
  const root = await start(t, { connectionFunction: async args => {
    received = args;
    return { ok: true, provider: 'qwen', model: 'qwen-plus', latencyMs: 10 };
  } });
  const config = { provider: 'qwen', model: 'qwen-plus', apiKey: 'secret-request-only', workspaceId: 'workspace-123' };
  const response = await post(`${root}/api/model/test`, { config, text: 'PRIVATE CUSTOMER TEXT', baseline: [{ value: 'PRIVATE BASELINE' }] });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { config });
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { ok: true, provider: 'qwen', model: 'qwen-plus', latencyMs: 10 });
  assert(!body.includes(config.apiKey));
  assert(!body.includes('PRIVATE'));
});

test('connection endpoint applies origin, host, content type, JSON and size checks before calling provider', async t => {
  let calls = 0;
  const root = await start(t, { connectionFunction: async () => { calls++; return { ok: true }; } });
  const url = `${root}/api/model/test`;
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post(url, { config: {} }, { Origin: 'https://malicious.example' })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: { Host: 'remote.example', 'Content-Type': 'application/json' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await post(url, [])).status, 400);
  assert.equal((await post(url, { config: {}, unused: 'x'.repeat(300001) })).status, 413);
  assert.equal(calls, 0);
});

test('model endpoints suppress unexpected exception content and retain safe error messages', async t => {
  const secret = 'secret-error-must-not-leak';
  const root = await start(t, {
    modelFunction: async () => { throw new Error(`Upstream raw text ${secret}`); },
    connectionFunction: async () => { throw new Error(`Fetch headers ${secret}`); },
  });
  for (const endpoint of ['/api/model', '/api/model/test']) {
    const response = await post(`${root}${endpoint}`, { text: '海报', config: { provider: 'deepseek', apiKey: secret } });
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.equal(JSON.parse(body).error, '模型调用失败，请检查设置后重试。');
    assert(!body.includes(secret));
  }
  // The real adapter creates safe validation errors without echoing config.
  const safeRoot = await start(t);
  const response = await post(`${safeRoot}/api/model/test`, { config: { provider: 'deepseek', apiKey: '' } });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /API Key/);
  assert.equal(body.code, 'MODEL_INVALID_CONFIG');
});
