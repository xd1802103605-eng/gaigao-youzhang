import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithModel, testModelConnection } from '../core/ai.mjs';

const config = { provider: 'deepseek', apiKey: 'mock-secret-never-use-real-key' };
const checkReply = { ok: true, check: 'gaigao-youzhang-connection-test' };
const reply = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

test('connection check sends only synthetic data and returns no provider content or key', async () => {
  let request;
  const result = await testModelConnection({ config, text: 'PRIVATE CUSTOMER TEXT', baseline: [{ value: 'PRIVATE BASELINE' }] }, async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return reply({ ...checkReply, unrelatedProviderData: 'do not echo this' });
  });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.equal(request.body.max_tokens, 256);
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert(request.body.messages.some(x => /JSON/.test(x.content)));
  assert(!request.options.body.includes('PRIVATE'));
  assert(!request.options.body.includes(config.apiKey));
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek-flash');
  assert(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
  assert.deepEqual(Object.keys(result).sort(), ['latencyMs', 'model', 'ok', 'provider']);
  assert(!JSON.stringify(result).includes(config.apiKey));
});

test('qwen connection uses fixed Beijing endpoint or validated workspace endpoint and disables hybrid thinking', async () => {
  const seen = [];
  const fetchMock = async (url, options) => { seen.push({ url, body: JSON.parse(options.body) }); return reply(checkReply); };
  await testModelConnection({ config: { ...config, provider: 'qwen' } }, fetchMock);
  await testModelConnection({ config: { ...config, provider: 'qwen', workspaceId: ' workspace-123 ' } }, fetchMock);
  assert.equal(seen[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(seen[1].url, 'https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(seen[0].body.model, 'qwen-plus');
  assert.equal(seen[0].body.enable_thinking, false);
  await testModelConnection({ config: { ...config, provider: 'qwen', model: 'qwen3.7-plus' } }, fetchMock);
  assert(!Object.hasOwn(seen[2].body, 'enable_thinking'), 'thinking-only custom models must not receive false');
});

test('hostile config and wrong model field types are rejected before a request', async () => {
  let calls = 0;
  const fetchMock = async () => { calls++; return reply(checkReply); };
  for (const invalid of [
    null,
    { ...config, provider: '__proto__' },
    { ...config, apiKey: 'secret\r\nInjected: value' },
    { ...config, model: { toString: () => 'deepseek-flash' } },
    { ...config, provider: 'qwen', workspaceId: 'workspace-.evil.example' },
    { ...config, provider: 'qwen', workspaceId: 'workspace-' },
    { ...config, provider: 'qwen', workspaceId: ['workspace'] },
  ]) await assert.rejects(testModelConnection({ config: invalid }, fetchMock), error => error.code === 'MODEL_INVALID_CONFIG');
  assert.equal(calls, 0);
});

test('provider HTTP failures have actionable distinct errors without echoing response bodies', async () => {
  const statuses = [
    [401, 'MODEL_AUTH', /API Key.*验证/],
    [402, 'MODEL_BALANCE', /余额|额度/],
    [403, 'MODEL_PERMISSION', /权限/],
    [404, 'MODEL_NOT_FOUND', /模型或工作空间/],
    [429, 'MODEL_RATE_LIMIT', /限流/],
    [503, 'MODEL_SERVICE', /暂时异常/],
  ];
  for (const [status, code, message] of statuses) {
    await assert.rejects(testModelConnection({ config }, async () => new Response(`SECRET ${config.apiKey}`, { status })), error => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert(!error.message.includes(config.apiKey));
      return true;
    });
  }
});

test('network, timeout, response JSON, answer JSON and wrong check result remain distinct failures', async () => {
  const cases = [
    [async () => { throw new Error(`Network message ${config.apiKey}`); }, 'MODEL_NETWORK', /无法连接/],
    [async () => { throw new DOMException(`secret ${config.apiKey}`, 'AbortError'); }, 'MODEL_TIMEOUT', /45 秒/],
    [async () => new Response(`not JSON: ${config.apiKey}`), 'MODEL_RESPONSE_JSON', /有效 JSON/],
    [async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: `invalid ${config.apiKey}` } }] }), 'MODEL_CONTENT_JSON', /有效 JSON/],
    [async () => reply({ ok: true }), 'MODEL_CONNECTION_RESULT', /不符合预期/],
    [async () => Response.json({ choices: [] }), 'MODEL_RESPONSE', /回答/],
  ];
  for (const [fetchMock, code, message] of cases) {
    await assert.rejects(testModelConnection({ config }, fetchMock), error => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert(!error.message.includes(config.apiKey));
      return true;
    });
  }
});

test('full analysis shares workspace and structured-output settings while retaining semantic validation', async () => {
  const text = '客户：预算300元。';
  let request;
  const args = { text, config: { ...config, provider: 'qwen', workspaceId: 'workspace-123' } };
  const output = await analyzeWithModel(args, async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return reply({ requirements: [{ field: 'price', value: '300元', quote: '预算300元。', status: 'explicit' }] });
  });
  assert.equal(request.url, 'https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(request.body.enable_thinking, false);
  assert.equal(request.body.max_tokens, 6000);
  assert.equal(output.requirements[0].value, '300元');
  await assert.rejects(analyzeWithModel(args, async () => reply({ requirements: [
    { field: 'price', value: '500元', quote: '预算300元。', status: 'explicit' },
  ] })), /依据/);
});
