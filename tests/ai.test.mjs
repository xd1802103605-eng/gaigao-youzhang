import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithModel, validateModelResult } from '../core/ai.mjs';
import { applyConfirmedChanges } from '../core/engine.mjs';

const text = '客户：做一张海报，尺寸800×1200，预算300元。';
const modelResult = () => ({ requirements: [{ field: 'deliverable', value: '海报', quote: '做一张海报，', status: 'explicit' },
  { field: 'price', value: '300元', quote: '预算300元。', status: 'explicit' }], questions: [], summary: '请确认需求。' });

test('valid model evidence is retained and IDs and labels are locally assigned', () => {
  const result = validateModelResult(modelResult(), { operation: 'analyze', text });
  assert.equal(result.mode, 'model');
  assert.equal(result.requirements[0].id, 'model-req-1');
  assert.equal(result.requirements[0].label, '交付内容');
});

test('invented evidence, invented amounts and unsupported fields are rejected', () => {
  let result = modelResult();
  result.requirements[0].quote = '明天交付';
  assert.throws(() => validateModelResult(result, { operation: 'analyze', text }), /引用/);
  result = modelResult(); result.requirements[1].value = '500元';
  assert.throws(() => validateModelResult(result, { operation: 'analyze', text }), /依据/);
  result = modelResult(); result.requirements[0].field = 'system';
  assert.throws(() => validateModelResult(result, { operation: 'analyze', text }), /字段/);
});

test('model cannot promote a question or relative date to explicit status', () => {
  const question = '能不能再给一版横图？明天交付。';
  const result = validateModelResult({ requirements: [
    { field: 'deliverable', value: '横图', quote: '能不能再给一版横图？', status: 'explicit' },
    { field: 'deadline', value: '明天', quote: '明天交付。', status: 'explicit' },
  ] }, { operation: 'analyze', text: question });
  assert(result.requirements.every(x => x.status === 'uncertain'));
});

test('model cannot invent a previous agreement or add a negated deliverable', () => {
  const row = { field: 'deliverable', before: '网站', after: '横图', quote: '不要新增横图。', kind: 'addition', certainty: 'explicit' };
  assert.throws(() => validateModelResult({ changes: [row] }, { operation: 'compare', text: row.quote, baseline: [{ field: 'deliverable', value: '海报' }] }), /原约定/);
  row.before = '海报';
  assert.throws(() => validateModelResult({ changes: [row] }, { operation: 'compare', text: row.quote, baseline: [{ field: 'deliverable', value: '海报' }] }), /否定/);
});

test('real-call adapter uses fixed endpoint and treats customer instructions as user data', async () => {
  const apiKey = 'test-secret-memory-only';
  let request;
  const output = await analyzeWithModel({ text, config: { provider: 'deepseek', apiKey } }, async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelResult()) } }] });
  });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.body.model, 'deepseek-flash');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.equal(request.body.messages[0].role, 'system');
  assert.equal(JSON.parse(request.body.messages[1].content).customer_chat_data, text);
  assert(!JSON.stringify(output).includes(apiKey));
});

test('arbitrary endpoints and hostile workspace names are never fetched', async () => {
  let calls = 0;
  const fake = async () => { calls++; throw new Error('should not call'); };
  await assert.rejects(analyzeWithModel({ text, config: { provider: 'http://localhost', apiKey: 'test-key-123' } }, fake), /请选择/);
  await assert.rejects(analyzeWithModel({ text, config: { provider: 'toString', apiKey: 'test-key-123' } }, fake), /请选择/);
  await assert.rejects(analyzeWithModel({ text, config: { provider: 'qwen', apiKey: 'test-key-123', workspaceId: 'a.invalid/../../localhost' } }, fake), /空间 ID/);
  assert.equal(calls, 0);
});

test('provider auth failure, empty content, truncation, non-JSON and bad quote remain errors', async () => {
  const args = { text, config: { provider: 'deepseek', apiKey: 'test-key-123' } };
  await assert.rejects(analyzeWithModel(args, async () => new Response('', { status: 401 })), /401/);
  await assert.rejects(analyzeWithModel(args, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })), /不完整/);
  await assert.rejects(analyzeWithModel(args, async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })), /空内容/);
  await assert.rejects(analyzeWithModel(args, async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }] })), /JSON/);
  const invalid = modelResult(); invalid.requirements[0].quote = '伪造原文';
  await assert.rejects(analyzeWithModel(args, async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(invalid) } }] })), /引用/);
});

test('model must keep a later horizontal size change associated with its established target', () => {
  const baseline = [
    { field: 'deliverable', value: '开业海报' }, { field: 'size', value: '1080×1920' },
    { field: 'deliverable', value: '公众号横图', target: '公众号横图' }, { field: 'size', value: '900×383', target: '公众号横图' },
  ];
  const text = '横图改为1200×628。';
  const change = { field: 'size', before: '1080×1920', after: '1200×628', quote: text, kind: 'modification', certainty: 'explicit' };
  assert.throws(() => validateModelResult({ changes: [change] }, { operation: 'compare', text, baseline }), /误关联/);
  change.before = '900×383'; change.target = '公众号横图';
  const valid = validateModelResult({ changes: [change] }, { operation: 'compare', text, baseline });
  assert.equal(valid.changes[0].target, '公众号横图');
  change.quote = '尺寸改为1200×628。'; delete change.target; change.before = '1080×1920';
  assert.throws(() => validateModelResult({ changes: [change] }, { operation: 'compare', text: change.quote, baseline }), /修改对象/);
});

test('new delivery specifications cannot overwrite the main poster when the model omits their target', () => {
  const baseline = [
    { field: 'deliverable', value: '开业海报' }, { field: 'size', value: '1080×1920' },
    { field: 'quantity', value: '1张' }, { field: 'sourceFiles', value: '另行约定' },
  ];
  const text = '新增公众号横图，尺寸900×383，数量2张。主海报尺寸改为1200×2000。主海报改为2张。源文件也发我。';
  const addition = { field: 'deliverable', before: '未约定', after: '公众号横图', target: '公众号横图', quote: '新增公众号横图，', kind: 'addition', certainty: 'explicit' };
  const specifications = [
    { field: 'size', before: '1080×1920', after: '900×383', quote: '尺寸900×383，', kind: 'modification', certainty: 'explicit' },
    { field: 'quantity', before: '1张', after: '2张', quote: '数量2张。', kind: 'modification', certainty: 'explicit' },
  ];
  for (const row of specifications) {
    // Put the new delivery second too: validation must not depend on row order.
    assert.throws(() => validateModelResult({ changes: [row, addition] }, { operation: 'compare', text, baseline }), /修改对象/);
  }
  const correct = specifications.map(row => ({ ...row, before: '未约定', kind: 'clarification', target: '公众号横图' }));
  const result = validateModelResult({ changes: [...correct, addition] }, { operation: 'compare', text, baseline });
  const decisions = Object.fromEntries(result.changes.map(row => [row.id, { action: 'accept' }]));
  const updated = applyConfirmedChanges(baseline, result.changes, decisions);
  assert.equal(updated.find(row => row.field === 'size' && !row.target).value, '1080×1920');
  assert.equal(updated.find(row => row.field === 'quantity' && !row.target).value, '1张');
  assert.equal(updated.find(row => row.field === 'size' && row.target === '公众号横图').value, '900×383');
  assert.equal(updated.find(row => row.field === 'quantity' && row.target === '公众号横图').value, '2张');
  const mainSize = { ...specifications[0], after: '1200×2000', quote: '主海报尺寸改为1200×2000。' };
  const mainQuantity = { ...specifications[1], quote: '主海报改为2张。' };
  const source = { field: 'sourceFiles', before: '另行约定', after: '提供源文件', quote: '源文件也发我。', kind: 'clarification', certainty: 'explicit' };
  assert.equal(validateModelResult({ changes: [addition, mainSize, mainQuantity, source] }, { operation: 'compare', text, baseline }).changes.length, 4);
  assert.equal(validateModelResult({ changes: [specifications[0]] }, { operation: 'compare', text: specifications[0].quote, baseline }).changes[0].target, undefined);
});

test('complete numeric values are required, not a suffix of a larger amount, size, quantity or date', () => {
  const examples = [
    ['price', '预算1300元。', '300元', '1300元'],
    ['price', '预算1,300.50元。', '300.50元', '1,300.50元'],
    ['size', '尺寸1800×1200。', '800×1200', '1800×1200'],
    ['quantity', '共做21张海报。', '1张', '21张'],
    ['deadline', '10月22日交付。', '0月22日', '10月22日'],
    ['deadline', '2026年10月22日交付。', '10月22日', '2026年10月22日'],
    ['revisions', '包含12轮修改。', '2轮', '12轮'],
  ];
  for (const [field, quote, invalid, valid] of examples) {
    const row = { field, value: invalid, quote, status: 'explicit' };
    assert.throws(() => validateModelResult({ requirements: [row] }, { operation: 'analyze', text: quote }), /依据/);
    row.value = valid;
    assert.equal(validateModelResult({ requirements: [row] }, { operation: 'analyze', text: quote }).requirements[0].value, valid);
    const change = { field, before: '未约定', after: invalid, quote, kind: 'clarification', certainty: 'explicit' };
    assert.throws(() => validateModelResult({ changes: [change] }, { operation: 'compare', text: quote }), /依据/);
  }
});

test('可以…吗 and all relative weekday expressions stay tentative even without question punctuation', () => {
  for (const quote of ['可以再给横图吗', '下个月交付', '星期一交付', '本周五交付', '下个月星期一交付']) {
    const deadline = quote.includes('交付');
    const row = { field: deadline ? 'deadline' : 'deliverable', value: deadline ? quote.replace('交付', '') : '横图', quote, status: 'explicit' };
    assert.equal(validateModelResult({ requirements: [row] }, { operation: 'analyze', text: quote }).requirements[0].status, 'uncertain');
    const change = { field: row.field, before: '未约定', after: row.value, quote, kind: deadline ? 'clarification' : 'addition', certainty: 'explicit' };
    assert.equal(validateModelResult({ changes: [change] }, { operation: 'compare', text: quote }).changes[0].certainty, 'uncertain');
  }
});

test('an unchanged label cannot bypass a contradictory complete source amount', () => {
  const quote = '预算还是1300元。';
  const row = { field: 'price', before: '300元', after: '300元', quote, kind: 'unchanged', certainty: 'explicit' };
  assert.throws(() => validateModelResult({ changes: [row] }, { operation: 'compare', text: quote, baseline: [{ field: 'price', value: '300元' }] }), /依据/);
});
