/* Shared deterministic extraction for the browser and the local Node server.
 * This deliberately limited parser never resolves relative dates, invents a
 * size/price or executes instructions found in a customer's messages. */
export const FIELDS = Object.freeze({
  deliverable: '交付内容', quantity: '数量', size: '尺寸', deadline: '交付日期',
  revisions: '修改轮数', price: '约定预算', sourceFiles: '源文件',
});
const MAX_TEXT = 50000;
const RELATIVE_DATE = /今天|明天|明晚|后天|今晚|本周|这周|下周|下个月|周[一二三四五六日天]|星期[一二三四五六日天]/;
const QUESTION = /能不能|可不可以|是否|可以.{0,12}[吗么]|行不行|能.{0,12}[吗么]|要不要|[?？]/;
const INJECTION = /忽略.{0,16}(?:指令|规则|要求|提示)|(?:system|assistant|developer)\s*:|系统提示|泄露.{0,8}(?:密钥|密码)|打印.{0,8}(?:密钥|密码)/i;
const NEGATIVE = /不要|不用|无需|不需要|不做|别再|取消|不新增|不增加/;
const ADDITION = /再(?:做|给|加|出|来)|新增|增加|加一|追加|顺便|另外|另做|多做|多一|加个|加上/;
const NO_CHANGE = /不用改|不修改|不变|保持|还是|照旧|沿用/;
const DELIVERABLE = /(?:公众号)?横图|横版(?:海报|图)?|竖版(?:海报|图)?|(?:开业|活动|宣传|招生|招聘|促销)?海报|长图|封面(?:图)?|详情页|主视觉|(?:小红书|公众号|社交媒体)配图|Banner|banner|Logo|logo|标志|名片|折页|宣传册|易拉宝|包装(?:设计)?|插画|视频|网站|落地页|小程序/g;
const MONEY = /(?:[¥￥]\s*)?\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:元|块钱|块|人民币)|[¥￥]\s*\d+(?:\.\d{1,2})?/g;
const SIZE = /\d{2,5}\s*[×xX*＊]\s*\d{2,5}(?:\s*(?:px|像素|mm|cm|毫米|厘米))?|\bA[0-6]\b|\d+(?:\.\d+)?\s*(?:毫米|厘米|mm|cm)\s*[×xX*＊]\s*\d+(?:\.\d+)?\s*(?:毫米|厘米|mm|cm)/g;
const DATE = /\d{4}年\d{1,2}月\d{1,2}[日号]|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{1,2}-\d{1,2}|(?:下周|本周|这周|星期|周)[一二三四五六日天](?:上午|下午|晚上)?|今天|明天|明晚|后天|今晚|下个月/g;
const AMOUNT = /(?:\d+|[一二两三四五六七八九十百]+)\s*(?:张|版|套|个|款|份|页|条|支)/g;
const REVISIONS = /(?:\d+|[一二两三四五六七八九十]+)\s*(?:轮|次)(?:免费)?(?:修改|改稿)?/g;

function cleanText(text) {
  if (typeof text !== 'string') throw new TypeError('聊天内容需要是文本。');
  if (text.length > MAX_TEXT) throw new RangeError('单次最多处理 50,000 个字符，请按订单分段。');
  return text.trim();
}
function clauses(text) {
  const result = [];
  const re = /[^，,。；;！!？?\r\n]+[，,。；;！!？?]?/g;
  let injectionSentence = false;
  let previousEnd = 0;
  for (const match of text.matchAll(re)) {
    if (/[\r\n]/.test(text.slice(previousEnd, match.index))) injectionSentence = false;
    const quote = match[0].trim();
    injectionSentence ||= INJECTION.test(quote);
    if (quote) result.push({ quote, uncertain: QUESTION.test(quote), injection: injectionSentence });
    if (/[。；;！!？?]$/.test(quote)) injectionSentence = false;
    previousEnd = match.index + match[0].length;
  }
  return result;
}
const matches = (text, re) => [...text.matchAll(new RegExp(re.source, re.flags))].map(x => x[0].trim());
const unique = values => [...new Set(values)];
const valueOf = (items, field) => items.filter(x => x.field === field).map(x => x.value).join('；');
const normalized = value => String(value ?? '').replace(/[\s，,。；;？?！!]/g, '').replace(/[xX*＊]/g, '×');
function requirement(field, value, clause, index, extras = {}) {
  return { id: `req-${field}-${index}`, field, label: FIELDS[field], value,
    quote: clause.quote, status: clause.uncertain ? 'uncertain' : 'explicit', ...extras };
}
function isNegatedDeliverable(quote) {
  return NEGATIVE.test(quote) && !/不(?:能|可以)/.test(quote);
}
function fileValue(quote) {
  if (/另行|另议|再议|待定|待确认|另算|另外收费|单独收费/.test(quote)) return { value: '另行约定', status: 'uncertain' };
  if (/不提供|不给|不用|不要|无需|不需要|不包含|不含/.test(quote)) return { value: '不提供', status: 'explicit' };
  if (/发|给|提供|包含|交付|需要|要/.test(quote)) return { value: '提供源文件', status: 'explicit' };
  return { value: '待确认', status: 'uncertain' };
}

// Only resolve a delivery reference when its name or a unique common alias is
// present. Ambiguity is returned to the caller instead of silently choosing the
// first size in a project with more than one deliverable.
export function resolveDeliveryReference(baseline, quote) {
  const deliveries = baseline.filter(x => x.field === 'deliverable');
  const names = unique(matches(quote, DELIVERABLE));
  let candidates = [];
  if (/主(?:海报|图|视觉)|原(?:海报|图|稿)/.test(quote)) {
    candidates = deliveries.filter(x => !x.target);
  } else {
    for (const name of names) {
      let found = deliveries.filter(x => normalized(x.value) === normalized(name) || normalized(x.target) === normalized(name));
      if (!found.length) found = deliveries.filter(x => normalized(x.value).includes(normalized(name)) || normalized(name).includes(normalized(x.value)));
      if (!found.length && /横图|横版/.test(name)) found = deliveries.filter(x => /横图|横版/.test(x.value));
      candidates.push(...found);
    }
  }
  candidates = [...new Set(candidates)];
  return { candidate: candidates.length === 1 ? candidates[0] : null, ambiguous: candidates.length > 1, mentioned: names.length > 0 || /主图|原图/.test(quote) };
}

export function parseRequirements(text, options = {}) {
  text = cleanText(text);
  const requirements = [];
  const questions = [];
  let count = 0;
  const add = (field, value, clause, extra = {}) => {
    if (!requirements.some(item => item.field === field && normalized(item.value) === normalized(value) && item.quote === clause.quote)) {
      requirements.push(requirement(field, value, clause, ++count, extra));
    }
  };
  for (const clause of clauses(text)) {
    if (clause.injection) { questions.push('有一段内容像是在给 AI 下指令，已跳过，请人工检查对应消息。'); continue; }
    const quote = clause.quote;
    const deliverables = unique(matches(quote, DELIVERABLE));
    if (!isNegatedDeliverable(quote)) {
      for (const name of deliverables) add('deliverable', name, clause);
      if (deliverables.length || /数量|共做|一共/.test(quote)) {
        for (const amount of matches(quote, AMOUNT)) add('quantity', amount, clause);
      }
    }
    for (const size of matches(quote, SIZE)) add('size', size, clause);
    if (/交|完成|截止|之前|前|到|改到|时间|日期|周|星期|明天|明晚|后天|今晚|今天/.test(quote)) {
      for (const date of matches(quote, DATE)) {
        const relative = RELATIVE_DATE.test(date);
        add('deadline', date, clause, relative ? { status: 'uncertain', note: '相对日期保留原文，请确认具体年月日。' } : {});
        if (relative) questions.push(`“${date}”具体是哪一天？请确认年月日。`);
      }
    }
    if (/修改|改稿|轮/.test(quote)) {
      for (const revision of matches(quote, REVISIONS)) add('revisions', revision.replace(/(?:免费)?(?:修改|改稿)$/, ''), clause);
      if (/不限|无限/.test(quote)) add('revisions', '不限次数', clause);
    }
    if (!/源文件/.test(quote) || /预算|总价|总计|合计/.test(quote)) {
      for (const money of matches(quote, MONEY)) add('price', money, clause);
    }
    if (/源文件|工程文件|可编辑文件/.test(quote)) {
      const source = fileValue(quote);
      add('sourceFiles', source.value, clause, { status: clause.uncertain ? 'uncertain' : source.status });
    }
  }
  if (!requirements.some(x => x.field === 'deliverable')) questions.push('要交付什么作品？请补充明确名称。');
  if (!requirements.some(x => x.field === 'size')) questions.push('交付尺寸或规格是多少？');
  if (!requirements.some(x => x.field === 'deadline')) questions.push('具体交付日期是什么时候？');
  if (requirements.some(x => x.field === 'sourceFiles' && x.status === 'uncertain')) questions.push('是否交付源文件、采用什么格式、是否另收费？');
  for (const item of requirements.filter(x => x.status === 'uncertain' && x.field !== 'deadline' && x.field !== 'sourceFiles')) {
    questions.push(`请确认${item.label}：“${item.value}”是否已经达成约定？`);
  }
  return { requirements, questions: unique(questions), mode: 'rules',
    summary: requirements.length ? `整理出 ${requirements.length} 项信息；请逐条检查后再保存为已确认需求。` : '尚未识别到明确需求，请补充聊天或手动填写。',
    limitation: '规则模式只识别常见设计订单表达，可能漏掉复杂语义；所有结果均需人工确认。' };
}

export function compareRequirements(baselineRequirements, newText, options = {}) {
  if (!Array.isArray(baselineRequirements)) throw new TypeError('需要提供已确认需求列表。');
  newText = cleanText(newText);
  const parsed = parseRequirements(newText, options);
  const list = clauses(newText).filter(x => !x.injection);
  const changes = [];
  const questions = parsed.questions.filter(q => !/^要交付什么|^交付尺寸|^具体交付/.test(q));
  let count = 0;
  const baseDeliverables = valueOf(baselineRequirements.filter(x => !x.target), 'deliverable');
  const isAdditional = req => req.field === 'deliverable' && !isNegatedDeliverable(req.quote) &&
    !/改为|改成|换成|改做/.test(req.quote) && (ADDITION.test(req.quote) ||
      (req.status === 'uncertain' && !resolveDeliveryReference(baselineRequirements, req.value).candidate));
  const extraDeliverables = parsed.requirements.filter(isAdditional);
  const extraReferences = extraDeliverables.map(req => ({ field: 'deliverable', value: req.value, target: req.value }));
  const allReferences = [...baselineRequirements, ...extraReferences];
  // Resolve each quantity or size against its own named delivery. Do not let
  // the first addition in a message capture the specifications of later items.
  const scopeAt = (req, clause) => {
    let names = [...clause.quote.matchAll(new RegExp(DELIVERABLE.source, DELIVERABLE.flags))];
    if (/主(?:海报|图|视觉)|原(?:海报|图|稿)/.test(clause.quote)) {
      if (names.length <= 1) return resolveDeliveryReference(baselineRequirements, clause.quote);
    }
    if (names.length > 1) {
      // Only use an unambiguous local grammatical link, such as “2张易拉宝”
      // or “横图尺寸900×383”. A shared size after two names needs a question.
      const valueIndex = clause.quote.indexOf(req.value);
      const valueEnd = valueIndex + req.value.length;
      const before = names.filter(x => x.index + x[0].length <= valueIndex).at(-1);
      const after = names.find(x => x.index >= valueEnd);
      const prefix = before && clause.quote.slice(before.index + before[0].length, valueIndex);
      const suffix = after && clause.quote.slice(valueEnd, after.index);
      const linkedBefore = before && /^(?:的|尺寸|规格|数量|为|是|改为|改成|改到|调整为|调整成|做成|共|[:：\s])*$/.test(prefix);
      const linkedAfter = req.field === 'quantity' && after && /^(?:的|[:：\s])*$/.test(suffix);
      if (Boolean(linkedBefore) === Boolean(linkedAfter)) return { candidate: null, ambiguous: true, mentioned: true };
      names = [linkedBefore ? before : after];
    }
    if (names.length === 1) {
      const name = names[0][0];
      // A new item named in this clause is more specific than an identically
      // named item in the old version (for example “再做一张海报”).
      const local = extraDeliverables.filter(x => x.quote === clause.quote && normalized(x.value) === normalized(name));
      if (local.length === 1) return { candidate: { value: local[0].value, target: local[0].value }, ambiguous: false, mentioned: true };
      return resolveDeliveryReference(allReferences, name);
    }
    return resolveDeliveryReference(baselineRequirements, clause.quote);
  };
  const add = (field, before, after, quote, kind, certainty, extras = {}) => {
    if (changes.some(x => x.field === field && x.after === after && x.target === extras.target)) return;
    const label = extras.label || FIELDS[field];
    const question = certainty === 'uncertain' ? `请确认：${label}是否调整为“${after}”？` : '';
    changes.push({ id: `change-${field}-${++count}`, field, label, before, after, quote, kind, certainty, question, ...extras });
    if (question) questions.push(question);
  };
  for (const clause of list) {
    if (/主(?:海报|图|视觉)|原(?:海报|图|稿)|原来/.test(clause.quote) && /不用改|不修改|保持|不变/.test(clause.quote)) {
      add('deliverable', baseDeliverables || '原交付内容', baseDeliverables || '原交付内容', clause.quote, 'unchanged', 'explicit');
    }
  }
  for (const req of parsed.requirements) {
    let scope = scopeAt(req, { quote: req.quote });
    const scopedField = ['size', 'quantity', 'sourceFiles', 'revisions'].includes(req.field);
    if (['size', 'quantity'].includes(req.field) && !scope.mentioned) {
      const index = list.findIndex(x => x.quote === req.quote);
      for (let distance = 1; distance <= 2 && index - distance >= 0; distance++) {
        const previous = scopeAt(req, list[index - distance]);
        if (previous.mentioned) { scope = previous; break; }
      }
    }
    const scopeTarget = scopedField && scope.candidate?.target ? scope.candidate.target : undefined;
    let prior = baselineRequirements.filter(x => x.field === req.field && (x.target || '') === (scopeTarget || ''));
    let before = prior.map(x => x.value).join('；') || '未约定';
    let kind = prior.length ? 'modification' : 'clarification';
    let certainty = req.status === 'uncertain' ? 'uncertain' : 'explicit';
    const extras = scopeTarget ? { target: scopeTarget, label: `${scopeTarget} · ${FIELDS[req.field]}` } : {};
    if (req.field === 'deliverable') {
      const extra = isAdditional(req);
      if (!extra && extraDeliverables.some(x => normalized(x.value) === normalized(req.value))) continue;
      const existing = resolveDeliveryReference(baselineRequirements, req.value).candidate;
      if (existing && !extra) {
        add(req.field, existing.value, existing.value, req.quote, 'unchanged', certainty, existing.target ? { target: existing.target } : {});
        continue;
      }
      const same = prior.some(x => normalized(x.value) === normalized(req.value) || (NO_CHANGE.test(req.quote) && x.value.includes(req.value)));
      if (same && !extra) kind = 'unchanged';
      else if (extra || !prior.length) kind = 'addition';
      if (kind === 'addition') extras.target = req.value;
    } else if (['quantity', 'size'].includes(req.field) && scope.candidate?.target && extraDeliverables.some(x => x.value === scope.candidate.target)) {
      const extra = extraDeliverables.find(x => x.value === scope.candidate.target);
      kind = 'clarification';
      extras.target = scope.candidate.target;
      extras.label = `${extras.target} · ${FIELDS[req.field]}`;
      certainty = extra.status === 'uncertain' ? 'uncertain' : certainty;
    }
    if (scopedField && scope.ambiguous && !extras.target) {
      questions.push(`“${req.quote}”对应哪一项交付？请明确名称后再分析，本次未更新${FIELDS[req.field]}。`);
      continue;
    }
    if (['size', 'quantity'].includes(req.field) && !extras.target && !scope.candidate && allReferences.filter(x => x.field === 'deliverable').length > 1) {
      questions.push(`“${req.quote}”没有明确是哪一张图的${FIELDS[req.field]}，请写明交付名称后再分析。`);
      continue;
    }
    if (extras.target && req.field !== 'deliverable') {
      const existingTarget = baselineRequirements.filter(x => x.field === req.field && x.target === extras.target);
      const targetBefore = existingTarget.map(x => x.value).join('；') || '未约定';
      if (existingTarget.length) kind = existingTarget.some(x => normalized(x.value) === normalized(req.value)) ? 'unchanged' : 'modification';
      add(req.field, targetBefore, req.value, req.quote, kind, certainty, extras);
      continue;
    }
    if (req.field !== 'deliverable' && prior.some(x => normalized(x.value) === normalized(req.value))) kind = 'unchanged';
    if (req.field === 'sourceFiles' && prior.every(x => x.status === 'uncertain' || /待|另行|未约定/.test(x.value))) kind = 'clarification';
    add(req.field, before, req.value, req.quote, kind, certainty, extras);
  }
  for (const extra of extraDeliverables) {
    if (!changes.some(x => x.field === 'size' && x.target === extra.value)) questions.push(`新增交付“${extra.value}”的尺寸尚未说清，请向客户确认。`);
  }
  const changed = changes.filter(x => x.kind !== 'unchanged').length;
  return { changes, questions: unique(questions), mode: 'rules',
    summary: changed ? `发现 ${changed} 项待处理信息。接受或赠送后才会更新需求；询问和拒绝不会改动已确认版本。` : '没有识别到明确变更；请检查是否存在规则模式遗漏的内容。',
    limitation: '规则模式适用于一个主要海报及少量有明确名称的增项。多张图请写明修改对象；未指明对象的尺寸只追问，不覆盖原需求。复杂语义仍需人工核对。' };
}

function validAction(decision) { return ['accept', 'gift', 'reject', 'ask'].includes(decision?.action); }
function explicitFeeCents(decision) {
  if (!Object.hasOwn(decision, 'feeCents')) return undefined;
  if (!Number.isSafeInteger(decision.feeCents) || decision.feeCents < 0 || decision.feeCents > 100000000) {
    throw new RangeError('单项追加费用需要是 0 至 1,000,000 元之间的有效金额，最多两位小数。');
  }
  return decision.feeCents;
}
export function applyConfirmedChanges(baseline, changes, decisions = {}) {
  if (!Array.isArray(baseline) || !Array.isArray(changes)) throw new TypeError('需求和变更必须为列表。');
  const updated = baseline.map(item => ({ ...item }));
  const availableTargets = new Set([
    ...baseline.filter(x => x.field === 'deliverable').flatMap(x => [x.target, x.value]).filter(Boolean),
    ...changes.filter(x => x.field === 'deliverable' && ['accept', 'gift'].includes(decisions[x.id]?.action)).map(x => x.target || x.after),
  ]);
  for (const change of changes) {
    const decision = decisions[change.id];
    if (!validAction(decision) || !['accept', 'gift'].includes(decision.action) || change.kind === 'unchanged') continue;
    explicitFeeCents(decision);
    if (!FIELDS[change.field]) continue;
    if (change.target && change.field !== 'deliverable' && !availableTargets.has(change.target)) continue;
    const value = typeof decision.value === 'string' && decision.value.trim() ? decision.value.trim() : change.after;
    const replacement = { id: `req-confirmed-${change.id}`, field: change.field,
      label: FIELDS[change.field], value, quote: change.quote, status: 'explicit',
      sourceId: change.id, ...(change.target ? { target: change.target } : {}),
      ...(decision.action === 'gift' ? { gifted: true } : {}) };
    if (change.kind === 'addition') updated.push(replacement);
    else {
      const index = updated.findIndex(x => x.field === change.field && (x.target || '') === (change.target || ''));
      if (index >= 0) updated.splice(index, 1, replacement);
      else updated.push(replacement);
    }
  }
  return updated;
}

function rateInCents(rates, field, aliases = []) {
  for (const key of [field, ...aliases]) {
    if (Object.hasOwn(rates, `${key}Cents`)) {
      const cents = Number(rates[`${key}Cents`]);
      return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100000000 ? cents : 0;
    }
    if (Object.hasOwn(rates, key)) {
      const raw = String(rates[key]).trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return 0;
      const [integer, decimals = ''] = raw.split('.');
      const cents = Number(integer) * 100 + Number(decimals.padEnd(2, '0'));
      return Number.isSafeInteger(cents) && cents <= 100000000 ? cents : 0;
    }
  }
  return 0;
}
export function calculateQuote(changes, decisions = {}, rates = {}) {
  const items = [];
  const billed = new Map();
  const fee = { horizontal: rateInCents(rates, 'horizontal', ['extraDeliverable']),
    sourceFiles: rateInCents(rates, 'sourceFiles'), rush: rateInCents(rates, 'rush', ['rushFee']) };
  for (const change of changes || []) {
    const decision = decisions[change.id];
    if (!validAction(decision) || !['accept', 'gift'].includes(decision.action) || change.kind === 'unchanged') continue;
    const override = explicitFeeCents(decision);
    let key;
    const addedDelivery = change.field === 'deliverable' && change.kind === 'addition';
    const horizontal = addedDelivery && /横图|横版/.test(change.after);
    if (addedDelivery) key = `deliverable:${normalized(change.target || change.after || change.id)}`;
    if (change.field === 'sourceFiles' && /提供|交付/.test(change.after) && !/不提供|不交付/.test(change.after)) key = 'sourceFiles';
    // A changed deadline is not automatically an expedited job. The person must
    // explicitly opt in on this decision, independently of the model's label.
    if (change.field === 'deadline' && decision.rush === true) key = 'rush';
    if (!key) continue;
    const pending = decision.action === 'accept' && addedDelivery && !horizontal && override === undefined;
    const configured = addedDelivery ? (override ?? (horizontal ? fee.horizontal : undefined)) : fee[key];
    const amountCents = decision.action === 'gift' ? 0 : pending ? null : configured;
    const deliverableLabel = /横图|横版/.test(change.after) ? '新增横版' : `新增交付物（${change.after}）`;
    const item = { changeId: change.id, label: addedDelivery ? deliverableLabel : { sourceFiles: '交付源文件', rush: '加急交付' }[key],
      action: decision.action, amountCents, amount: amountCents === null ? null : amountCents / 100,
      ...(pending ? { pending: true } : {}),
      reason: decision.action === 'gift' ? '本次赠送' : pending ? '待填写此项追加费用' : addedDelivery && override !== undefined ? '按你为此项确认的报价' : '按你设置的价目表' };
    const existingIndex = billed.get(key);
    if (existingIndex === undefined) {
      billed.set(key, items.length);
      items.push(item);
    } else if (items[existingIndex].action === 'gift' && decision.action === 'accept') {
      // Duplicate evidence for one target is charged once. A gifted item cannot
      // erase an accepted charge for that same target merely by appearing first.
      items[existingIndex] = item;
    }
  }
  const pendingItems = items.filter(x => x.pending).map(x => ({ changeId: x.changeId, label: x.label }));
  const totalCents = items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
  return { items, totalCents, total: totalCents / 100, hasPending: pendingItems.length > 0, pendingItems,
    hasRates: Object.values(fee).some(x => x > 0) || items.some(x => x.amountCents > 0),
    disclaimer: pendingItems.length ? '仍有项目待报价，当前合计仅含已定价项目；不能作为最终追加费用。' : '仅为追加费用草稿，不改变原预算；加急费需你明确勾选，最终金额需双方确认。' };
}
