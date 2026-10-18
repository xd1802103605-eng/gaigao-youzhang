import { parseRequirements, compareRequirements, applyConfirmedChanges, calculateQuote } from '/core/engine.mjs';
import { analyzeWithModel, testModelConnection } from '/core/ai.mjs';

const STORAGE_KEY = 'gaigao-youzhang.workspace.v1';
const ORIGINAL = '客户：做1张咖啡店开业海报，尺寸1080×1920，10月22日交付，预算300元，包含2轮修改。\n设计师：交付PNG，源文件另行约定。';
const FOLLOWUP = '客户：主海报不用改，能不能再给一版公众号横图？尺寸900×383，源文件也发我，改到10月21日交付，预算还是300元。';
const NO_CHANGE = '客户：主海报、尺寸、交期、预算都不变，不要增加横图。';
const LABELS = { deliverable:'交付内容', quantity:'交付数量', size:'画面尺寸', deadline:'交付日期', revisions:'修改轮次', price:'项目预算', sourceFiles:'源文件约定' };
const STEPS = ['整理需求', '确认版本', '处理变更', '导出交付'];
const titles = ['把聊天，整理成清楚的需求。', '确认这一版，再开始创作。', '客户改了什么，一眼有据。', '让每一次确认，都有留存。'];
const descriptions = ['粘贴客户的原始沟通，提取交付项，并逐条查看对应原话。', '检查交付内容和待确认项，保存一份不会被覆盖的需求基线。', '逐项对照原来的约定与新消息，每个决定都由你来做。', '核对最终交付清单，带着明确的边界继续创作。'];
const icons = {
  logo:'<path d="M4 5h16M4 11h11M4 17h6"/><circle cx="18" cy="17" r="4"/><path d="m16.5 17 1 1 2-2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',
  doc:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  check:'<path d="m5 12 4 4L19 6"/>', shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  link:'<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/>',
  message:'<path d="M21 4H3v14h5l4 4 4-4h5zM7 9h10M7 13h6"/>',
  spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  print:'<path d="M6 8V3h12v5M6 16H3V8h18v8h-3M6 13h12v8H6zM17 10h1"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  edit:'<path d="m15 4 5 5M4 16l12-12a3.5 3.5 0 0 1 5 5L9 21H4z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  coffee:'<path d="M4 8h13v7a6.5 6.5 0 0 1-13 0zM17 9h2a3 3 0 0 1 0 6h-2M3 22h16M7 3v2M12 2v3"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>', question:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2M12 17v.1"/>',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function icon(name) {
  const wrapper = el('span', {class:'icon', 'aria-hidden':'true'});
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.doc}</svg>`;
  return wrapper;
}
const id = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const current = () => state.projects.find(p => p.id === state.activeId) || state.projects[0];
const latest = p => p.versions.at(-1);
const formatTime = value => new Intl.DateTimeFormat('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const money = value => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(Number(value)||0);
let step = 3;
let busy = false;
let persistent = true;
let saveTimer;
let sessionConfig = {mode:'rules',provider:'deepseek',model:'deepseek-flash',apiKey:'',workspaceId:''};
let connectionState = {status:'untested',config:null,message:''};
let connectionPending = false;
let connectionRevision = 0;
let updateConnectionUI = null;
let state = loadState();

function seedProject() {
  const parsed = parseRequirements(ORIGINAL, {referenceDate:'2026-10-16'});
  const reqs = parsed.requirements.map(r => ({...r}));
  const sourceFiles = reqs.find(r=>r.field==='sourceFiles');
  if (sourceFiles) { sourceFiles.value='源文件另行约定，本次未承诺交付'; sourceFiles.status='explicit'; }
  const version = {id:id(),label:'V1',createdAt:now(),requirements:clone(reqs),sourceText:ORIGINAL,mode:'rules',note:'合成演示数据 · 设计师已检查确认'};
  const comparison = compareRequirements(reqs,FOLLOWUP,{referenceDate:'2026-10-16'});
  return {id:id(),name:'青禾咖啡 · 开业海报',isDemo:true,createdAt:now(),original:ORIGINAL,requirements:reqs,requirementsMode:'rules',questions:[],analyzedSource:ORIGINAL,versions:[version],newText:FOLLOWUP,comparedSource:FOLLOWUP,compareVersionId:version.id,changes:comparison.changes||[],comparisonQuestions:comparison.questions||[],comparisonLimitation:comparison.limitation||'',comparisonSummary:comparison.summary||'',comparisonMode:'rules',decisions:{},rates:{horizontal:100,sourceFiles:80,rush:60},draft:'',changesCommitted:false};
}
function loadState() {
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw) return validateWorkspace(JSON.parse(raw));
  } catch(error) { persistent=false; setTimeout(()=>toast('本地记录暂不可用，页面仍可使用。请及时导出 JSON 备份。','error'),500); }
  const demo=seedProject(); return {app:'gaigao-youzhang',schemaVersion:1,projects:[demo],activeId:demo.id};
}
function validateWorkspace(data) {
  if(!data || data.app!=='gaigao-youzhang' || data.schemaVersion!==1 || !Array.isArray(data.projects) || !data.projects.length || data.projects.length>50) throw new Error('请选择改稿有账导出的 JSON 文件。');
  const allowedFields=Object.keys(LABELS), actions=['accept','gift','reject','ask'];
  function str(value,max=2000000) { if(typeof value!=='string'||value.length>max)throw new Error('文件内容不完整或文字超长。'); return value; }
  function feeDetails(value) { if(!Object.hasOwn(value,'feeCents'))return {};if(!Number.isSafeInteger(value.feeCents)||value.feeCents<0||value.feeCents>100000000)throw new Error('文件包含无效的单项追加费用。');return {feeCents:value.feeCents}; }
  function quoteSnapshot(value) {
    if(value===undefined)return undefined;
    if(!value||!Array.isArray(value.items)||value.items.length>100||value.hasPending||!Number.isSafeInteger(value.totalCents)||value.totalCents<0||value.totalCents>10000000000)throw new Error('已保存版本的报价快照无效。');
    const items=value.items.map(item=>{if(!item||!['accept','gift'].includes(item.action)||item.pending||!Number.isSafeInteger(item.amountCents)||item.amountCents<0||item.amountCents>100000000||(item.action==='gift'&&item.amountCents!==0))throw new Error('已保存版本的报价明细无效。');return{changeId:str(item.changeId,150),label:str(item.label||'',2000),action:item.action,amountCents:item.amountCents,amount:item.amountCents/100,reason:str(item.reason||'',2000)};});
    if(items.reduce((sum,item)=>sum+item.amountCents,0)!==value.totalCents)throw new Error('已保存版本的报价合计与明细不一致。');
    return {items,totalCents:value.totalCents,total:value.totalCents/100,hasPending:false,pendingItems:[]};
  }
  function reqs(rows){if(!Array.isArray(rows)||rows.length>100)throw new Error('需求记录格式不正确。');return rows.map(r=>{if(!allowedFields.includes(r.field))throw new Error('文件包含未知需求字段。');return {id:str(r.id,150),field:r.field,label:str(r.label||LABELS[r.field],200),value:str(r.value,2000),quote:str(r.quote||'',50000),status:r.status==='explicit'?'explicit':'uncertain',...(r.target?{target:str(r.target,2000)}:{}),...(r.sourceId?{sourceId:str(r.sourceId,150)}:{}),...(r.gifted?{gifted:true}:{}),...(r.note?{note:str(r.note,2000)}:{})};});}
  const projects=data.projects.map(p=>{
    if(!Array.isArray(p.versions)||p.versions.length>200||!Array.isArray(p.changes)||p.changes.length>100)throw new Error('版本或变更记录格式不正确。');
    const versions=p.versions.map(v=>{if(!Number.isFinite(Date.parse(v.createdAt)))throw new Error('版本日期格式不正确。');return{id:str(v.id,150),label:str(v.label,100),createdAt:v.createdAt,requirements:reqs(v.requirements),sourceText:str(v.sourceText||''),mode:v.mode==='model'?'model':'rules',note:str(v.note||'',2000),...(v.quoteSnapshot!==undefined?{quoteSnapshot:quoteSnapshot(v.quoteSnapshot)}:{}),changeSnapshot:Array.isArray(v.changeSnapshot)?v.changeSnapshot.slice(0,100).map(s=>({label:str(s.label||'',200),before:str(s.before||'',2000),after:str(s.after||'',2000),quote:str(s.quote||'',50000),action:actions.includes(s.action)?s.action:'ask',...(s.field&&allowedFields.includes(s.field)?{field:s.field}:{}),...(s.target?{target:str(s.target,2000)}:{}),...(s.rush?{rush:true}:{}),...feeDetails(s)})):[]};});
    const changes=p.changes.map(c=>{if(!allowedFields.includes(c.field))throw new Error('未知变更字段。');return{id:str(c.id,150),field:c.field,label:str(c.label||LABELS[c.field],200),before:str(c.before||'',2000),after:str(c.after||'',2000),quote:str(c.quote||'',50000),kind:['addition','modification','clarification','unchanged'].includes(c.kind)?c.kind:'clarification',certainty:c.certainty==='explicit'?'explicit':'uncertain',question:str(c.question||'',2000),...(c.target?{target:str(c.target,2000)}:{})};});
    const decisions={};for(const c of changes){const d=p.decisions?.[c.id];if(d&&actions.includes(d.action))decisions[c.id]={action:d.action,value:typeof d.value==='string'?str(d.value,2000):'',rush:d.rush===true,...feeDetails(d)};}
    const rates={};for(const field of ['horizontal','sourceFiles','rush']){const n=Number(p.rates?.[field]??0);if(!Number.isFinite(n)||n<0||n>1000000)throw new Error('价目表金额无效。');rates[field]=n;}
    return{id:str(p.id,150),name:str(p.name,100),isDemo:Boolean(p.isDemo),createdAt:typeof p.createdAt==='string'?p.createdAt:now(),original:str(p.original||''),requirements:reqs(p.requirements||[]),requirementsMode:p.requirementsMode==='model'?'model':'rules',questions:Array.isArray(p.questions)?p.questions.slice(0,40).map(q=>typeof q==='string'?str(q,2000):str(String(q.question||q.label||''),2000)):[],analyzedSource:str(p.analyzedSource||''),versions,newText:str(p.newText||''),comparedSource:str(p.comparedSource||''),compareVersionId:typeof p.compareVersionId==='string'?p.compareVersionId:'',changes,comparisonQuestions:Array.isArray(p.comparisonQuestions)?p.comparisonQuestions.slice(0,100).map(q=>str(typeof q==='string'?q:String(q.question||q.label||''),2000)):[],comparisonLimitation:str(p.comparisonLimitation||'',5000),comparisonSummary:str(p.comparisonSummary||'',5000),comparisonMode:p.comparisonMode==='model'?'model':'rules',decisions,rates,draft:str(p.draft||''),changesCommitted:Boolean(p.changesCommitted)};
  });
  if(new Set(projects.map(p=>p.id)).size!==projects.length)throw new Error('文件存在重复项目编号。');
  return{app:'gaigao-youzhang',schemaVersion:1,projects,activeId:projects.some(p=>p.id===data.activeId)?data.activeId:projects[0].id};
}
function persist(immediate=false) {
  const save=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));persistent=true;}catch(error){if(persistent)toast('本地空间不足或浏览器禁止保存。请导出 JSON 备份。','error');persistent=false;}};
  clearTimeout(saveTimer);if(immediate)save();else saveTimer=setTimeout(save,250);
}
function toast(message,type='success') {
  const node=el('div',{class:`toast ${type}`,role:type==='error'?'alert':'status'},message);
  document.querySelector('#toasts').append(node);setTimeout(()=>node.remove(),type==='error'?9000:4500);
}
function button(label,onClick,{kind='',ico,small=false,disabled=false,title}={}) {
  return el('button',{type:'button',class:`btn ${kind} ${small?'small':''}`,disabled,title,onClick:async event=>{try{await onClick(event);}catch(error){toast(error.message||'操作没有完成，请重试。','error');}}},ico?icon(ico):null,label);
}
function badge(text,kind=''){return el('span',{class:`badge ${kind}`},text);}
function notice(text,warning=false){return el('div',{class:`notice ${warning?'warning':''}`},icon(warning?'question':'info'),el('span',{},text));}
function columnHead(label,ico,aside){return el('div',{class:'column-head'},el('h2',{},icon(ico),label),aside);}
function modeLabel(mode){return mode==='model'?'AI 辅助提取':'本地规则演示';}
function formField(label,input,hint){return el('div',{class:'field'},el('label',{for:input.id},label),input,hint?el('small',{},hint):null);}

function render() {
  const p=current();document.title=`${p.name} · 改稿有账`;
  const shell=el('div',{class:'app-shell'},renderSidebar(p),el('div',{class:'workspace'},renderTopbar(p),renderMain(p)));
  document.querySelector('#app').replaceChildren(shell);
}
function renderSidebar(p) {
  const sidebar=el('aside',{class:'sidebar','aria-label':'项目与流程'});
  sidebar.append(el('a',{class:'brand',href:'#',onClick:e=>{e.preventDefault();step=3;render();}},el('span',{class:'brand-mark'},icon('logo')),el('span',{},el('div',{class:'brand-name'},'改稿有账'),el('div',{class:'brand-sub'},'每次修改，都有依据'))));
  sidebar.append(el('div',{class:'section-label'},'WORKSPACE · 我的项目',el('button',{class:'icon-btn',title:'创建项目','aria-label':'创建项目',onClick:()=>newProjectModal()},icon('plus'))));
  const list=el('div',{class:'project-list'});
  state.projects.forEach(project=>list.append(el('button',{class:`project-button ${project.id===p.id?'active':''}`,onClick:()=>{state.activeId=project.id;step=project.versions.length?3:1;persist();render();}},el('span',{class:'project-dot'}),el('span',{class:'project-text'},project.name))));
  list.append(el('button',{class:'project-button',onClick:()=>newProjectModal()},icon('plus'),'新建项目'));
  sidebar.append(list,el('div',{class:'section-label'},'YOUR WORKFLOW · 工作流程'));
  const nav=el('nav',{class:'steps','aria-label':'工作流程'});
  STEPS.forEach((name,index)=>nav.append(el('button',{class:`step ${step===index+1?'active':''}`,'aria-current':step===index+1?'step':undefined,onClick:()=>{step=index+1;render();}},el('span',{class:'step-number'},`0${index+1}`),name,(index===0&&p.requirements.length)||(index===1&&p.versions.length)||(index===2&&p.changesCommitted)?el('span',{class:'done-dot'}):null)));
  sidebar.append(nav,el('div',{class:'sidebar-foot'},el('div',{class:'local-pill'},el('span'),persistent?'已在此浏览器保存':'请导出备份'),el('p',{class:'sidebar-note'},'你的沟通与项目记录留在本机。',el('br'),'AI 模式仅按你的选择发送输入。'),el('div',{class:'sidebar-tools'},el('button',{class:'text-link',onClick:()=>document.querySelector('#import-file').click()},'导入备份'),el('button',{class:'text-link',onClick:()=>manageProjectModal()},'项目管理'))));
  return sidebar;
}
function renderTopbar(p) {
  return el('header',{class:'topbar'},el('div',{class:'breadcrumb'},'工作台',icon('chevron'),el('strong',{},p.name),p.isDemo?el('span',{class:'demo-tag'},'合成演示'):null),el('div',{class:'top-actions'},el('span',{class:'mode-indicator'},sessionConfig.mode==='rules'?'RULE-BASED DEMO':'AI ASSISTED'),el('button',{class:'top-link',onClick:guideModal},icon('question'),'使用指引'),el('button',{class:'top-link',onClick:demoModal},icon('coffee'),'演示案例'),el('button',{class:'top-link',onClick:settingsModal},icon('settings'),'模型设置'),el('span',{class:'avatar','aria-label':'个人工作区'},'我')));
}
function renderMain(p) {
  const baseline=latest(p);
  const main=el('main',{class:'main',id:'main',tabindex:'-1'});
  main.append(el('div',{class:'eyebrow'},`PROJECT DESK / 0${step}`),el('div',{class:'page-heading'},el('div',{},el('h1',{},titles[step-1]),el('p',{},descriptions[step-1])),el('div',{class:'heading-tools'},button('项目设置',projectSettingsModal,{ico:'edit'}),button(step===4?'导出 JSON 备份':'导出项目',()=>downloadJSON(),{ico:'download'}))));
  main.append(el('div',{class:'version-strip'},el('div',{class:'version-left'},el('span',{class:'version-chip'},baseline?baseline.label:'草稿'),el('span',{},baseline?'已确认需求基线':'尚未保存确认版本'),el('span',{class:'mini-separator'}),el('span',{},`${p.versions.length} 个历史版本`)),el('div',{class:'version-right'},el('button',{onClick:historyModal},icon('history'),'版本历史'),el('button',{onClick:()=>{step=2;render();}},icon('layers'),'查看需求'))));
  if(step===1)main.append(renderAnalyze(p));
  if(step===2)main.append(renderBaseline(p));
  if(step===3)main.append(renderCompare(p));
  if(step===4)main.append(renderDelivery(p));
  main.append(el('footer',{class:'page-footer'},el('span',{},icon('shield'),'由你确认，才成为约定。'),el('span',{},'改稿有账 · 独立设计师的需求变更工作台')));
  return main;
}
function renderAnalyze(p) {
  const wrapper=el('div',{});
  wrapper.append(notice(sessionConfig.mode==='rules'?'当前使用本地规则演示：支持演示范围内的海报需求提取，不是大模型。复杂聊天请切换 AI 模式，并检查提取结果。':'AI 模式会将本次聊天发送给你选择的模型。请先脱敏；模型结果仍需你逐条确认。'));
  const textarea=el('textarea',{id:'original-chat',class:'input-area chat',maxlength:50000,'aria-label':'原始客户沟通',value:p.original,placeholder:'粘贴关于交付内容、尺寸、交期、预算和修改次数的聊天……',onInput:event=>{p.original=event.target.value;persist();document.querySelector('#original-count').textContent=`${p.original.length} 字`;}});
  const left=el('section',{},columnHead('原始沟通','message',badge('仅文本 · 可编辑','outline')),textarea,el('div',{class:'input-meta'},el('span',{id:'original-count'},`${p.original.length} 字`),el('span',{},'先脱敏，再整理')),button(busy?'正在整理…':'提取需求清单',()=>analyzeOriginal(),{kind:'primary',ico:busy?null:'spark',disabled:busy}),el('p',{class:'fine-print'},'报价、是否包含源文件等未明确约定的内容，会保持待确认。'),el('div',{class:'preset-menu'},el('button',{onClick:()=>{p.original=ORIGINAL;p.analyzedSource='';persist();render();}},'填入咖啡海报示例'),el('button',{onClick:()=>{p.original='客户：做一张活动海报，预算还没定，尺寸你看着办，交付时间再商量。';p.analyzedSource='';persist();render();}},'试试模糊需求')));
  const right=el('section',{},columnHead('需求清单','doc',badge(`${p.requirements.length} 个字段`)));
  if(p.requirements.length)right.append(renderRequirementEditor(p),renderQuestions(p.questions),el('div',{class:'editor-tools'},button('检查并确认版本',()=>{step=2;render();},{kind:'dark',ico:'arrow'})));
  else right.append(emptyState('等待整理需求','输入客户沟通后，提取出的需求会显示在这里。','doc'));
  if(busy)right.prepend(el('div',{class:'loading-bar','aria-label':'正在分析'}));
  wrapper.append(el('div',{class:'work-grid'},left,right));return wrapper;
}
function renderRequirementEditor(p) {
  const list=el('div',{class:'editor-list'});
  p.requirements.forEach(r=>{
    const input=el('input',{id:`requirement-${r.id}`,type:'text',value:r.value,maxlength:2000,'aria-label':r.label,onInput:event=>{r.value=event.target.value;persist();}});
    const row=el('div',{class:'editor-row'},el('div',{class:'editor-row-top'},el('label',{for:input.id},r.label),badge(r.status==='explicit'?'已明确':'待确认',r.status==='explicit'?'green':'orange'),input),el('div',{class:'evidence'},icon('link'),el('span',{},r.quote?`原文：「${r.quote}」`:'无对应原话。请自行向客户确认后填写。')));
    if(r.status==='uncertain')row.append(el('label',{class:'confirm-check'},el('input',{type:'checkbox',onChange:event=>{if(event.target.checked){if(!r.value.trim()||/^(待确认|待补充|待定|不清楚|未知|你看着办)$/.test(r.value.trim())||/[?？]/.test(r.value)){event.target.checked=false;toast('请先填写已和客户确认的具体值。','error');return;}r.status='explicit';persist();render();}}}),'我已和客户确认，并填入了明确的值'));
    list.append(row);
  });list.append(el('div',{class:'editor-row'},button('补充一个需求字段',addRequirementModal,{ico:'plus',small:true})));return list;
}
function renderQuestions(questions) {
  if(!questions?.length)return null;
  return el('div',{class:'question-list'},el('strong',{},'建议追问'),questions.map(q=>el('div',{},'· ',typeof q==='string'?q:(q.question||q.label||'请确认未明确的需求'))));
}
function renderBaseline(p) {
  const wrapper=el('div',{class:'full-panel'});
  wrapper.append(notice('保存后的版本会保留快照。修改清单后再次保存，会创建一个新版本；旧版本始终可以在历史中查看。'));
  if(!p.requirements.length){wrapper.append(emptyState('先整理一份需求清单','粘贴客户聊天，逐项检查提取结果后再保存基线。','layers',button('去整理需求',()=>{step=1;render();},{kind:'primary'})));return wrapper;}
  if(p.original!==p.analyzedSource)wrapper.append(notice('原始聊天已经修改，请重新提取需求，再保存版本。',true));
  wrapper.append(el('div',{class:'version-banner'},el('div',{},el('h2',{},p.name),el('p',{},`准备保存为 V${p.versions.length+1} · 确认前可以直接修改下方值`)),el('div',{class:'version-lock'},icon('lock'),'保留每次确认')));
  wrapper.append(renderRequirementEditor(p),renderQuestions(p.questions));
  const uncertain=p.requirements.filter(r=>r.status!=='explicit'||!r.value.trim()).length;
  wrapper.append(el('div',{class:'review-footer'},el('p',{},uncertain?`还有 ${uncertain} 项需要你填写并确认。`:'已列出的需求已确认；未列出的内容仍未约定。',el('br'),'客户的提问不会自动变成你的承诺。'),button('保存确认版本',saveInitialVersion,{kind:'primary',ico:'check'})));
  return wrapper;
}
function baselineForComparison(p){return p.versions.find(v=>v.id===p.compareVersionId)||latest(p);}
function renderCompare(p) {
  const wrapper=el('div',{});
  if(!latest(p)){wrapper.append(notice('先保存已确认需求，再处理客户的新消息。'),emptyState('还没有可对照的版本','完成需求整理与确认，新的修改才有清楚的参照。','layers',button('去整理需求',()=>{step=1;render();},{kind:'primary'})));return wrapper;}
  wrapper.append(notice(p.isDemo?'这是一个可操作的合成案例。左侧是确认过的订单，右侧是新消息带来的变化。先逐条处理，再生成确认单。':'每条变化都附有客户原话。问句和未确定事项保持待确认；接受或赠送前，请填入你确认的交付值。'));
  const base=baselineForComparison(p);
  const left=el('section',{class:'left-column'},columnHead('原来的约定','doc',badge(`${base.label} 已确认`,'outline')));
  const sheet=el('div',{class:'source-sheet'},el('div',{class:'sheet-top'},el('span',{},icon('lock'),'CONFIRMED BRIEF'),el('span',{},base.label)));
  const rows=el('div',{class:'baseline-list'});
  base.requirements.forEach(r=>rows.append(el('div',{class:'baseline-row'},el('span',{class:'baseline-label'},r.label),el('span',{class:'baseline-value'},r.value))));
  sheet.append(rows,el('div',{class:'source-quote'},base.sourceText));left.append(sheet);
  const text=el('textarea',{id:'new-message',class:'input-area',maxlength:50000,'aria-label':'客户追加消息',value:p.newText,onInput:event=>{p.newText=event.target.value;persist();document.querySelector('#message-count').textContent=`${p.newText.length} 字`;}});
  const message=el('div',{class:'message-section'},el('label',{class:'small-label',for:'new-message'},'客户的新消息',el('span',{},'粘贴追加沟通')),text,el('div',{class:'input-meta'},el('span',{id:'message-count'},`${p.newText.length} 字`),el('button',{onClick:()=>{p.newText=NO_CHANGE;persist();render();}},'试试「没有变化」')),button(busy?'正在对照…':'分析这次变更',runComparison,{kind:'dark',ico:busy?null:'spark',disabled:busy}),el('p',{class:'fine-print'},sessionConfig.mode==='rules'?'本地规则演示 · 不上传聊天 · 结果请自行核对':'AI 模式 · 输入会发送给选定的模型 · 结果请自行核对'),el('p',{class:'fine-print'},'涉及多张图时请写明对象，例如「主海报尺寸」或「横图尺寸」。'));
  left.append(message);
  const changes=p.changes.filter(c=>c.kind!=='unchanged');
  const unresolved=changes.filter(c=>!p.decisions[c.id]||p.decisions[c.id].action==='ask').length;
  const right=el('section',{class:'right-column'},columnHead('这次变更','layers',el('span',{class:'column-sub'},'CHANGES & EVIDENCE')));
  if(busy)right.append(el('div',{class:'loading-bar','aria-label':'正在对照'}));
  const processed=changes.filter(c=>p.decisions[c.id]&&p.decisions[c.id].action!=='ask').length;
  right.append(el('div',{class:'compare-toolbar'},el('div',{class:'stats'},el('span',{},'发现 ',el('b',{},String(changes.length)),' 项变化'),el('span',{},'·'),el('span',{},'已处理 ',el('strong',{},String(processed)),' 项'),el('span',{},'·'),el('span',{},'待确认 ',el('b',{},String(unresolved)),' 项')),badge(modeLabel(p.comparisonMode),'gray')));
  if(p.newText!==p.comparedSource)right.append(notice('消息已编辑，下面仍是上次结果。请重新分析后再保存。',true));
  if(p.comparisonQuestions?.length)right.append(el('details',{class:'raw-collapse',style:'margin:0 0 14px'},el('summary',{},`需向客户确认 ${p.comparisonQuestions.length} 个问题`),renderQuestions(p.comparisonQuestions)));
  if(changes.length){const list=el('div',{class:'change-list'});changes.forEach((c,i)=>list.append(renderChange(p,c,i)));right.append(list);}
  else right.append(emptyState(p.comparedSource?(p.comparisonQuestions?.length?'这段消息还不够明确':'没有发现需要处理的变化'):'等待新消息',p.comparedSource?(p.comparisonQuestions?.length?'请展开上方待确认问题，补充具体对象和要求后再分析。':'本次规则或模型没有识别出新增约定。请核对原文；如果有遗漏，可修改文字后再次分析。'):'粘贴客户的新消息，查看它与已确认需求的区别。','check'));
  const quote=projectQuote(p);
  right.append(renderQuote(quote,p.changesCommitted),el('div',{class:'review-footer'},el('p',{},p.changesCommitted?'本次处理已经保存为新版本。':'只有「接受」和「本次赠送」会写入新版本。',el('br'),unresolved?`${unresolved} 项待确认将列入追问，不会写成交付承诺。`:'每项决定都会保留到确认单中。'),button(p.changesCommitted?'查看交付确认单':'保存决定，生成确认单',()=>commitChanges(),{kind:'primary',ico:'arrow'})));
  wrapper.append(el('div',{class:'work-grid'},left,right));return wrapper;
}
function renderChange(p,c,index) {
  const d=p.decisions[c.id];
  const kind={addition:'新增交付',modification:'约定变化',clarification:'需要确认'}[c.kind]||'需要确认';
  const card=el('article',{class:`change-card ${d&&d.action!=='ask'?'resolved':''}`},el('div',{class:'change-card-head'},el('div',{class:'change-title'},el('span',{class:'change-index'},String(index+1).padStart(2,'0')),c.label),el('span',{class:'change-kind'},kind)));
  const body=el('div',{class:'change-body'},el('div',{class:'diff-line'},el('div',{class:'diff-cell before'},el('span',{class:'diff-label'},'原先约定'),c.before||'未约定'),el('span',{class:'diff-arrow'},'→'),el('div',{class:'diff-cell after'},el('span',{class:'diff-label'},'客户这次提出'),c.after||'待补充')),el('div',{class:'evidence'},icon('link'),el('span',{},`新消息原文：「${c.quote||'未提供对应原话，请核实'}」`)));
  const oldEvidence=baselineForComparison(p)?.requirements.filter(r=>r.field===c.field&&(!c.target||!r.target||r.target===c.target)).map(r=>r.quote).filter(Boolean);
  if(oldEvidence?.length)body.append(el('details',{class:'raw-collapse',style:'margin-top:8px'},el('summary',{},'查看原约定依据'),el('p',{},[...new Set(oldEvidence)].map(q=>`「${q}」`).join('\n'))));
  if(c.certainty==='uncertain'||c.question)body.append(el('p',{class:'question-note'},icon('question'),c.question||'这是提问或未明确的内容，接受前请先确认具体值。'));
  card.append(body);
  const controls=el('div',{class:'action-buttons'});
  [['accept','接受变更'],['gift','本次赠送'],['ask','需要追问'],['reject','不接受']].forEach(([action,label])=>controls.append(el('button',{class:`action-btn ${d?.action===action?'selected':''}`,'data-action':action,'aria-pressed':d?.action===action,disabled:p.changesCommitted,onClick:()=>{p.decisions[c.id]={action,value:d?.value??(c.certainty==='uncertain'?'':c.after),rush:d?.rush===true,...(d&&Object.hasOwn(d,'feeCents')?{feeCents:d.feeCents}:{})};p.draft='';persist();render();}},label)));
  const caption=p.changesCommitted?'已留存':d?{accept:'待写入新版本',gift:'费用记为 0',ask:'不形成承诺',reject:'保留原约定'}[d.action]:'由你决定';
  card.append(el('div',{class:'change-action'},controls,el('span',{class:'decision-caption'},caption)));
  if(d&&['accept','gift'].includes(d.action)){
    card.append(el('div',{class:'confirm-value'},el('label',{for:`value-${c.id}`},'确认值'),el('input',{id:`value-${c.id}`,type:'text',value:d.value||'',maxlength:2000,disabled:p.changesCommitted,placeholder:c.certainty==='uncertain'?'请填入已确认的具体交付内容':'填写你接受的具体值',onInput:event=>{d.value=event.target.value;p.draft='';persist();}})));
    if(d.action==='accept'&&c.field==='deliverable'&&c.kind==='addition'&&!/横图|横版/.test(c.after)){
      const feeInput=el('input',{id:`fee-${c.id}`,class:'custom-fee-input',type:'number',min:0,max:1000000,step:'0.01',inputmode:'decimal',required:true,value:Object.hasOwn(d,'feeCents')?String(d.feeCents/100):'',disabled:p.changesCommitted,placeholder:'请填写此项报价',onInput:event=>{
        const raw=event.target.value.trim();
        if(/^\d+(?:\.\d{1,2})?$/.test(raw)&&Number(raw)<=1000000){const [whole,fraction='']=raw.split('.');d.feeCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));event.target.setCustomValidity('');}
        else{delete d.feeCents;event.target.setCustomValidity(raw?'请填写 0 至 1,000,000 元之间、最多两位小数的金额。':'请填写此项追加费用；本次不收费可选择「本次赠送」。');}
        p.draft='';persist();document.querySelector('.quote-summary')?.replaceWith(renderQuote(projectQuote(p),p.changesCommitted));
      }});
      card.append(el('div',{class:'fee-editor'},el('div',{class:'confirm-value'},el('label',{for:feeInput.id},'此项追加费用（元）'),feeInput),el('p',{class:'fee-hint'},'此交付物没有预设单价，请填写本次报价。最多两位小数；本次不收费可选择「本次赠送」。')));
    }
    if(c.field==='deadline')card.append(el('label',{class:'confirm-check',style:'padding:0 16px 10px;margin-top:0'},el('input',{type:'checkbox',checked:d.rush===true,disabled:p.changesCommitted,onChange:event=>{d.rush=event.target.checked;p.draft='';persist();render();}}),'此项按加急计费（提前交付不会自动收费）'));
  }
  return card;
}
function projectQuote(p) {return p.changesCommitted&&latest(p)?.quoteSnapshot?latest(p).quoteSnapshot:calculateQuote(p.changes,p.decisions,p.rates);}
function quoteItemText(item){return `${item.label}${item.action==='gift'?' · 本次赠送':''}：${item.pending?'待填写报价':`¥ ${money(item.amount)}`}`;}
function quoteTotalText(quote){return quote.hasPending?`追加总额待定（已定价部分 ¥ ${money(quote.total)}；仍有 ${(quote.pendingItems||[]).length} 项待填写报价）`:`本次追加金额：¥ ${money(quote.total)}（按逐项报价和个人价目表计算，待双方确认）`;}
function appendQuoteDetails(container,quote){if(quote.items?.length)container.append(el('ul',{class:'delivery-changes'},quote.items.map(item=>el('li',{},quoteItemText(item)))));}
function renderQuote(quote,locked=false) {
  const box=el('div',{class:'quote-summary'},el('div',{class:'quote-line'},el('span',{},'本次追加费用'),el('div',{class:'quote-tools'},el('span',{},locked?'已保存报价快照':'逐项报价 / 个人价目表'),locked?null:el('button',{onClick:ratesModal},'编辑'))));
  if(quote.items?.length)quote.items.forEach(item=>box.append(el('div',{class:`quote-line ${item.pending?'pending-price':''}`},el('span',{},item.label,item.action==='gift'?' · 本次赠送':''),el('span',{},item.pending?'待填写报价':`¥ ${money(item.amount)}`))));
  else box.append(el('div',{class:'quote-line'},el('span',{},'处理变更后，按已设置的单价计算'),el('span',{},'—')));
  if(quote.hasPending)box.append(el('div',{class:'pending-price'},'尚有费用待填写，追加总额未定。'),el('p',{class:'fine-print'},`已定价部分：¥ ${money(quote.total)}。请为接受的新增交付填写报价后再保存决定。`));
  else box.append(el('div',{class:'quote-line total'},el('span',{},'建议确认的追加金额'),el('strong',{},el('small',{},'¥'),money(quote.total))));
  box.append(el('p',{class:'fine-print'},'每个交付物独立收费或赠送，最终以双方确认结果为准。原项目预算不自动改变。'));
  return box;
}
function renderDelivery(p) {
  const wrapper=el('div',{class:'delivery-layout'});
  const base=latest(p);
  if(!base)return el('div',{class:'full-panel'},emptyState('先完成需求确认','保存一份明确的需求版本，就能导出可交付的确认单。','doc',button('去整理需求',()=>{step=1;render();},{kind:'primary'})));
  const quote=projectQuote(p);
  const pending=p.changes.filter(c=>c.kind!=='unchanged'&&(!p.decisions[c.id]||p.decisions[c.id].action==='ask'));
  const paper=el('article',{class:'delivery-paper',id:'delivery-document'},el('div',{class:'paper-kicker'},'GAIGAO YOUZHANG / PROJECT CONFIRMATION'),el('h2',{},'项目交付确认单'),el('div',{class:'paper-meta'},el('span',{},`项目：${p.name}`),el('span',{},`${base.label} · ${formatTime(base.createdAt)}`)),el('div',{class:'provenance'},`${p.isDemo?'合成案例 · ':''}此单根据设计师确认的版本生成；请双方检查后确认。`));
  paper.append(el('h3',{class:'paper-section-title'},'01 / 当前交付约定'),requirementTable(base.requirements));
  if(p.changes.length){
    paper.append(el('h3',{class:'paper-section-title'},'02 / 本次变更处理'));
    const list=el('ul',{class:'delivery-changes'});
    p.changes.filter(c=>c.kind!=='unchanged').forEach(c=>{const d=p.decisions[c.id];const action=d?{accept:'接受',gift:'本次赠送',reject:'不接受，保留原约定',ask:'待追问'}[d.action]:'尚未处理';list.append(el('li',{},`${c.label}：${action}${d&&['accept','gift'].includes(d.action)?` · ${d.value||c.after}`:''}`));});paper.append(list);
    if(!p.changesCommitted)paper.append(el('p',{class:'error-text'},'这些变更决定尚未保存为确认版本，当前交付清单仍为已保存版本。'));
    paper.append(el('h3',{class:'paper-section-title'},'03 / 追加费用与待确认项'),el('p',{class:'quote-line'},quoteTotalText(quote)));appendQuoteDetails(paper,quote);
    if(pending.length)paper.append(el('ul',{class:'delivery-changes'},pending.map(c=>el('li',{},c.question||`请确认${c.label}：${c.after}`))));
    else paper.append(el('p',{class:'fine-print'},'当前没有列出的待追问项。'));
  }
  paper.append(el('div',{class:'signature-row'},el('span',{},'设计师确认 / 日期'),el('span',{},'客户确认 / 日期')));
  const side=el('aside',{class:'delivery-side'},el('div',{class:'export-buttons'},button('打印 / 保存为 PDF',()=>window.print(),{kind:'primary',ico:'print'}),button('导出 Markdown',()=>downloadMarkdown(),{ico:'download'}),button('导出 JSON 备份',()=>downloadJSON(),{ico:'download'})));
  const draft=p.draft||makeDraft(p);if(!p.draft)p.draft=draft;
  const draftInput=el('textarea',{class:'input-area',id:'client-draft',maxlength:50000,'aria-label':'给客户的沟通草稿',value:draft,onInput:event=>{p.draft=event.target.value;persist();}});
  const draftBox=el('div',{class:'draft-box'},el('h3',{},'发给客户的话'),el('p',{},'按你的决定生成，发送前可继续编辑。'),draftInput,el('div',{class:'draft-actions'},button('重新生成',()=>{p.draft=makeDraft(p);persist();render();toast('已根据当前决定重新生成草稿。');},{small:true}),button('复制文字',()=>copyText(draftInput.value),{small:true,ico:'copy'})),el('p',{class:'fine-print'},'仅复制草稿，由你自行发送给客户。'));
  side.append(draftBox);wrapper.append(paper,side);return wrapper;
}
function requirementTable(requirements) {return el('table',{class:'plain-table'},el('tbody',{},requirements.map(r=>el('tr',{},el('td',{},r.label),el('td',{},r.value)))));}
function emptyState(title,description,ico,action){return el('div',{class:'empty-state'},icon(ico),el('h3',{},title),el('p',{},description),action);}

function modelConfig(config) {
  return {provider:config.provider,model:config.model.trim(),apiKey:config.apiKey.trim(),...(config.provider==='qwen'&&config.workspaceId?.trim()?{workspaceId:config.workspaceId.trim()}:{})};
}
function sameModelConfig(a,b) {
  return Boolean(a&&b&&['provider','model','apiKey','workspaceId'].every(key=>(a[key]||'')===(b[key]||'')));
}
async function requestModel(path,payload,directCall) {
  async function direct(){try{return await directCall();}catch(error){throw new Error(`${error.message||'模型连接失败。'} 若浏览器阻止连接，请解压作品并双击启动作品.cmd后重试。`);}}
  if(location.protocol==='file:')return direct();
  let response;
  try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});}catch(error){if(error.name==='TimeoutError')throw new Error('模型请求超时，请稍后重试。');if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))return direct();throw new Error('本地服务无法连接。请保持启动窗口开启，再重新测试或分析。');}
  if(response.status===404||response.status===405||response.headers.get('content-type')?.includes('text/html'))return direct();
  let data;try{data=await response.json();}catch{throw new Error('模型服务没有返回有效结果，请检查本地服务。');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('模型服务没有返回有效结果，请检查本地服务。');
  if(!response.ok||data.error)throw new Error(typeof data.error==='string'?data.error:(data.error?.message||'模型请求失败，请检查模型和密钥。'));
  return data.result||data;
}
async function modelOperation(operation,text,baseline,config={...sessionConfig}) {
  if(config.mode==='rules')return operation==='analyze'?parseRequirements(text,{referenceDate:'2026-10-16'}):compareRequirements(baseline,text,{referenceDate:'2026-10-16'});
  if(!config.apiKey.trim())throw new Error('请在模型设置中填入 API Key；密钥只在本次页面内存中使用。');
  const payload={operation,text,baseline,config:modelConfig(config)};
  return requestModel('/api/model',payload,()=>analyzeWithModel(payload));
}
async function analyzeOriginal() {
  if(busy)throw new Error('上一条分析还在进行，请等结果返回后再操作。');
  const p=current();if(!p.original.trim())throw new Error('请先粘贴客户的原始沟通。');
  const source=p.original,baselineId=latest(p)?.id,requirementsSnapshot=JSON.stringify(p.requirements),config={...sessionConfig};
  busy=true;render();
  try{const result=await modelOperation('analyze',source,[],config);if(!state.projects.includes(p)||p.original!==source||latest(p)?.id!==baselineId)throw new Error('等待期间原文或确认版本已改变，本次结果没有写入。请重新提取需求。');if(JSON.stringify(p.requirements)!==requirementsSnapshot)throw new Error('需求清单在等待期间已修改，本次结果没有写入，已保留你的修改。请重新分析。');if(result.requirements.length>100)throw new Error('本次提取超过 100 项需求，请按订单拆分后再整理。');p.requirements=result.requirements;p.requirementsMode=result.mode==='model'?'model':'rules';p.questions=result.questions||[];p.analyzedSource=source;p.draft='';persist(true);toast(`已整理 ${p.requirements.length} 项需求，请检查原文与待确认项。`);}finally{busy=false;render();}
}
function saveInitialVersion() {
  const p=current();if(!p.requirements.length)throw new Error('请先提取需求清单。');
  if(p.versions.length>=200)throw new Error('此项目已有 200 个版本。请导出备份，并创建新项目继续记录。');
  if(p.original!==p.analyzedSource)throw new Error('原始聊天已经改变，请重新提取需求。');
  if(!p.requirements.some(r=>r.field==='deliverable'&&r.value.trim()))throw new Error('请先补充明确的交付内容。');
  const missing=p.requirements.filter(r=>r.status!=='explicit'||!r.value.trim()||/^(待确认|待补充|待定|不清楚|未知|你看着办)$/.test(r.value.trim())||/[?？]/.test(r.value));
  if(missing.length)throw new Error(`请先填写并确认：${missing.map(r=>r.label).join('、')}。`);
  const previous=latest(p);
  if(previous&&JSON.stringify(previous.requirements)===JSON.stringify(p.requirements)){step=3;render();toast('这份需求已保存，继续处理后续变更。');return;}
  p.versions.push({id:id(),label:`V${p.versions.length+1}`,createdAt:now(),requirements:clone(p.requirements),sourceText:p.original,mode:p.requirementsMode==='model'?'model':'rules',note:'设计师逐项检查并保存'});
  p.compareVersionId=latest(p).id;p.changes=[];p.decisions={};p.comparisonQuestions=[];p.comparisonLimitation='';p.comparedSource='';p.changesCommitted=false;p.draft='';persist(true);step=3;render();toast('已保存新版本，旧版本仍在历史中保留。');
}
async function runComparison() {
  if(busy)throw new Error('上一条分析还在进行，请等结果返回后再操作。');
  const p=current();if(!latest(p))throw new Error('请先保存确认版本。');if(!p.newText.trim())throw new Error('请先填写客户的新消息。');
  if(Object.values(p.decisions).some(d=>d.action)&&!p.changesCommitted){showModal('重新分析这段消息',el('p',{class:'modal-intro'},'重新分析会清空当前这次变更的未保存决定，已确认的历史版本会继续保留。'),[button('保留当前决定',closeModal),button('重新分析',async()=>{closeModal();await performComparison(p);},{kind:'primary'})]);return;}
  await performComparison(p);
}
async function performComparison(p) {
  if(busy)throw new Error('上一条分析还在进行，请等结果返回后再操作。');
  if(!state.projects.includes(p))throw new Error('这个项目已移除，请选择项目后重新分析。');
  const base=latest(p);if(!base)throw new Error('请先保存确认版本。');
  const source=p.newText,baselineId=base.id,requirements=clone(base.requirements),decisionsSnapshot=JSON.stringify(p.decisions),config={...sessionConfig};
  busy=true;render();
  try{const result=await modelOperation('compare',source,requirements,config);if(!state.projects.includes(p)||p.newText!==source||latest(p)?.id!==baselineId)throw new Error('等待期间消息或确认版本已改变，本次结果没有写入。请重新分析这次变更。');if(JSON.stringify(p.decisions)!==decisionsSnapshot)throw new Error('变更决定在等待期间已修改，本次结果没有写入，已保留你的修改。请重新分析。');if(result.changes.length>100)throw new Error('本次变化超过 100 项，请拆成更短的消息再分析。');p.changes=result.changes;p.comparisonSummary=result.summary||'';p.comparisonQuestions=result.questions||[];p.comparisonLimitation=result.limitation||'';p.comparisonMode=result.mode==='model'?'model':'rules';p.comparedSource=source;p.compareVersionId=baselineId;p.decisions={};p.changesCommitted=false;p.draft='';persist(true);toast(`对照完成，识别到 ${p.changes.filter(c=>c.kind!=='unchanged').length} 项需要核对的变化。`);}finally{busy=false;render();}
}
function commitChanges() {
  const p=current();if(p.changesCommitted){step=4;render();return;}
  if(p.versions.length>=200)throw new Error('此项目已有 200 个版本。请导出备份，并创建新项目继续记录。');
  if(p.newText!==p.comparedSource)throw new Error('消息已经编辑，请重新分析后再保存决定。');
  const changes=p.changes.filter(c=>c.kind!=='unchanged');
  if(!changes.length){p.draft=makeDraft(p);step=4;persist();render();return;}
  const undecided=changes.filter(c=>!p.decisions[c.id]);if(undecided.length)throw new Error(`还有 ${undecided.length} 项没有决定，请逐项选择。`);
  for(const c of changes){const d=p.decisions[c.id];if(['accept','gift'].includes(d.action)&&(!d.value?.trim()||/[?？]/.test(d.value)||/^(能不能|可不可以|是否|待确认|待补充)/.test(d.value.trim())))throw new Error(`请为「${c.label}」填写已确认的具体值；客户问句不能成为交付承诺。`);}
  const quote=calculateQuote(changes,p.decisions,p.rates);
  if(quote.hasPending)throw new Error(`请填写接受的新增交付的「此项追加费用（元）」：${quote.pendingItems.map(item=>item.label).join('、')}。本次不收费可选择「本次赠送」。`);
  const base=baselineForComparison(p);
  const accepted=changes.filter(c=>['accept','gift'].includes(p.decisions[c.id].action));
  for(const c of accepted){if(c.target&&c.field!=='deliverable'&&!accepted.some(x=>x.field==='deliverable'&&(x.target===c.target||x.after===c.target))&&!base.requirements.some(x=>x.field==='deliverable'&&(x.target===c.target||x.value===c.target)))throw new Error(`「${c.label}」属于新增的${c.target}。请先接受该交付，或把关联字段改为追问 / 不接受。`);}
  const next=applyConfirmedChanges(base.requirements,changes,p.decisions);
  const version={id:id(),label:`V${p.versions.length+1}`,createdAt:now(),requirements:clone(next),sourceText:[base.sourceText,p.newText].filter(Boolean).join('\n\n后续沟通：\n'),mode:p.comparisonMode,note:accepted.length?`已确认 ${accepted.length} 项变更`:'本次未增加交付承诺，保留原需求',quoteSnapshot:clone(quote),changeSnapshot:changes.map(c=>({label:c.label,field:c.field,before:c.before,after:p.decisions[c.id].value||c.after,quote:c.quote,action:p.decisions[c.id].action,...(c.target?{target:c.target}:{}),rush:p.decisions[c.id].rush===true,...(Object.hasOwn(p.decisions[c.id],'feeCents')?{feeCents:p.decisions[c.id].feeCents}:{})}))};
  p.versions.push(version);p.requirements=clone(next);p.requirementsMode=version.mode;p.original=version.sourceText;p.analyzedSource=p.original;p.questions=[];p.changesCommitted=true;p.draft=makeDraft(p);persist(true);step=4;render();toast(`${version.label} 已保存，可导出交付确认单。`);
}

function showModal(title,content,actions=[],{scrollBody=false}={}) {
  const dialog=document.querySelector('#modal');dialog.classList.toggle('fixed-modal-actions',scrollBody);dialog.replaceChildren(el('div',{class:'modal-head'},el('h2',{id:'modal-title'},title),el('button',{class:'icon-btn','aria-label':'关闭窗口',onClick:closeModal},icon('close'))),scrollBody?el('div',{class:'modal-scroll-body'},content):content,actions.length?el('div',{class:'modal-actions'},actions):null);if(!dialog.open)dialog.showModal();
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}},{once:true});
}
function closeModal(){updateConnectionUI=null;document.querySelector('#modal').close();}
function newProjectModal() {
  const input=el('input',{id:'new-project-name',type:'text',maxlength:100,placeholder:'例如：青禾咖啡 · 开业海报'});
  const create=()=>{const name=input.value.trim();if(!name)throw new Error('请给项目起一个名字。');if(state.projects.length>=50)throw new Error('最多保存 50 个项目，请先导出备份并清理旧项目。');const p={id:id(),name,isDemo:false,createdAt:now(),original:'',requirements:[],requirementsMode:'rules',questions:[],analyzedSource:'',versions:[],newText:'',comparedSource:'',compareVersionId:'',changes:[],comparisonSummary:'',comparisonMode:'rules',decisions:{},rates:{horizontal:100,sourceFiles:80,rush:60},draft:'',changesCommitted:false};state.projects.push(p);state.activeId=p.id;step=1;persist(true);closeModal();render();toast('项目已创建，粘贴第一段客户沟通吧。');};
  showModal('创建一个新项目',formField('项目名称',input,'一个订单一个项目，版本和变更会分别保留。'),[button('取消',closeModal),button('创建项目',create,{kind:'primary',ico:'plus'})]);input.focus();
}
function projectSettingsModal() {
  const p=current(),input=el('input',{id:'project-name',type:'text',maxlength:100,value:p.name});
  showModal('项目设置',el('div',{},formField('项目名称',input),el('p',{class:'modal-intro'},`项目创建于 ${formatTime(p.createdAt)}，已保留 ${p.versions.length} 个确认版本。`),el('div',{class:'preset-menu'},button('新建项目',()=>{closeModal();newProjectModal();},{ico:'plus',small:true}),button('导入备份',()=>{closeModal();document.querySelector('#import-file').click();},{ico:'upload',small:true}),button('管理当前项目',manageProjectModal,{small:true}))),[button('取消',closeModal),button('保存名称',()=>{if(!input.value.trim())throw new Error('项目名称不能为空。');p.name=input.value.trim();persist(true);closeModal();render();toast('项目名称已更新。');},{kind:'primary'})]);
}
function addRequirementModal() {
  const p=current();
  const field=el('select',{id:'extra-field'},Object.entries(LABELS).map(([value,label])=>el('option',{value},label)));
  const value=el('input',{id:'extra-value',type:'text',maxlength:2000,placeholder:'填写已和客户确认的具体内容'});
  const quote=el('textarea',{id:'extra-quote',class:'input-area',maxlength:10000,placeholder:'可选：从原始聊天逐字复制对应原话',style:'min-height:80px'});
  const checked=el('input',{type:'checkbox'});
  const content=el('div',{},el('p',{class:'modal-intro'},'补齐提取时漏掉的需求，或添加你后来向客户确认的内容。没有对应原话时，请留空证据。'),formField('需求字段',field),formField('确认值',value),formField('原文证据（可选）',quote),el('label',{class:'confirm-check'},checked,'这项内容已和客户确认'));
  showModal('补充需求项',content,[button('取消',closeModal),button('添加到清单',()=>{if(p.requirements.length>=100)throw new Error('一份需求最多包含 100 项，请拆分项目。');if(!value.value.trim())throw new Error('请填写具体内容。');if(quote.value&&!p.original.includes(quote.value))throw new Error('原文证据需要逐字出现在当前的原始沟通中，或留空。');p.requirements.push({id:id(),field:field.value,label:LABELS[field.value],value:value.value.trim(),quote:quote.value,status:checked.checked?'explicit':'uncertain'});persist();closeModal();render();toast('需求项已补充，请检查后保存确认版本。');},{kind:'primary',ico:'plus'})]);
}
function settingsModal() {
  const rules=el('input',{type:'radio',name:'model-mode',value:'rules',checked:sessionConfig.mode==='rules'}),live=el('input',{type:'radio',name:'model-mode',value:'model',checked:sessionConfig.mode==='model'});
  const provider=el('select',{id:'provider'},el('option',{value:'deepseek'},'DeepSeek'),el('option',{value:'qwen'},'通义千问 Qwen'));provider.value=sessionConfig.provider;
  const model=el('input',{id:'model-name',type:'text',value:sessionConfig.model,placeholder:'deepseek-flash',maxlength:150});
  const key=el('input',{id:'model-key',type:'password',value:sessionConfig.apiKey,placeholder:'输入你自己的 API Key',autocomplete:'off',maxlength:1000});
  const workspace=el('input',{id:'workspace-id',type:'text',value:sessionConfig.workspaceId||'',placeholder:'使用千问北京子业务空间时填写',autocomplete:'off',maxlength:150});
  const workspaceField=formField('业务空间 ID（千问北京，可选）',workspace,'普通体验可先留空。若使用北京地域子业务空间，请在百炼空间详情中复制 ID，并使用该空间可用的北京地域密钥。');
  workspaceField.hidden=provider.value!=='qwen';
  const connectionStatus=el('div',{class:'connection-status',role:'status','aria-live':'polite','aria-atomic':'true'});
  const draftConfig=()=>modelConfig({provider:provider.value,model:model.value,apiKey:key.value,workspaceId:workspace.value});
  const testButton=button('测试连接',async()=>{
    if(connectionPending)return;
    const config=draftConfig();
    if(!config.apiKey||!config.model){connectionState={status:'failed',config,message:'请先填写模型名称和 API Key，再测试连接。'};refreshConnectionStatus();return;}
    const revision=++connectionRevision;
    connectionPending=true;connectionState={status:'testing',config,message:''};refreshConnectionStatus();
    try{
      const result=await requestModel('/api/model/test',{config},()=>testModelConnection({config}));
      if(!result||result.ok!==true||result.provider!==config.provider||result.model!==config.model)throw new Error('没有收到有效的连接确认，请检查服务后重试。');
      if(revision===connectionRevision)connectionState={status:'success',config,message:'密钥和模型可以连接。接下来可保存设置，再分析脱敏后的客户聊天。',latencyMs:Number.isFinite(result.latencyMs)?result.latencyMs:null};
    }catch(error){
      if(revision===connectionRevision)connectionState={status:'failed',config,message:error.message||'连接失败，请检查密钥、模型名称和网络后重试。'};
    }finally{connectionPending=false;updateConnectionUI?.();}
  },{ico:'link'});
  function refreshConnectionStatus(){
    const valid=sameModelConfig(connectionState.config,draftConfig());
    const status=valid?connectionState.status:'untested';
    const title={untested:'尚未测试',testing:'正在测试连接…',success:'连接成功',failed:'连接失败'}[status];
    let message=valid&&connectionState.message?connectionState.message:'保存设置不会验证密钥。请先测试连接，确认密钥和模型是否可用。';
    if(status==='testing')message='正在发送固定示例内容，不会发送项目聊天，请稍候。';
    if(status==='untested'&&connectionPending)message='设置已修改，之前的测试不再适用。当前请求结束后，请重新测试。';
    connectionStatus.dataset.state=status;
    connectionStatus.replaceChildren(el('strong',{},icon(status==='success'?'check':status==='failed'?'question':'info'),title),el('p',{},message),status==='success'?el('small',{},`${connectionState.latencyMs!==null?`本次用时 ${(connectionState.latencyMs/1000).toFixed(1)} 秒。`:''}连接成功只说明可以调用，需求分析仍需你逐条检查。`):null);
    testButton.disabled=connectionPending;testButton.replaceChildren(icon('link'),connectionPending?'正在测试…':'测试连接');
  }
  function invalidateConnection(){
    connectionRevision+=1;connectionState={status:'untested',config:null,message:''};refreshConnectionStatus();
  }
  updateConnectionUI=refreshConnectionStatus;
  [model,key,workspace].forEach(input=>input.addEventListener('input',invalidateConnection));
  const detail=el('div',{},el('div',{class:'form-grid'},formField('模型供应商',provider),formField('模型名称',model,'可填写你的账户可用模型。')),workspaceField,formField('API Key',key,'只在本次页面内存中使用。刷新后清空，不写入本地存储或导出文件。'),el('div',{class:'provider-links'},externalLink('申请 DeepSeek 密钥','https://platform.deepseek.com/api_keys'),externalLink('打开阿里云百炼','https://bailian.console.aliyun.com/'),externalLink('千问密钥与地域说明','https://help.aliyun.com/zh/model-studio/get-api-key')),el('div',{class:'connection-test'},testButton,el('p',{},'测试只发送固定示例内容，不会发送项目聊天；会产生少量模型调用费用。')),connectionStatus,el('div',{class:'inline-warning'},'启用 AI 后，点击分析会把该次聊天与必要的已确认需求发送给所选供应商。请使用脱敏内容。测试和分析的费用均由你的模型账户承担。'),el('p',{class:'settings-disclosure'},'建议解压作品后双击「启动作品.cmd」，保持启动窗口开启。直接打开 HTML 时，如提示无法连接，请改用这种启动方式。'));
  detail.hidden=sessionConfig.mode==='rules';
  [rules,live].forEach(r=>r.addEventListener('change',()=>{detail.hidden=!live.checked;invalidateConnection();}));
  provider.addEventListener('change',()=>{model.value=provider.value==='qwen'?'qwen-plus':'deepseek-flash';model.placeholder=model.value;workspaceField.hidden=provider.value!=='qwen';invalidateConnection();});
  const content=el('div',{},el('p',{class:'modal-intro'},'本地规则演示无需密钥，可体验完整流程。AI 模式可理解更自由的客户聊天，结果仍需人工检查。'),el('div',{class:'mode-options'},el('label',{class:'mode-option'},rules,'本地规则演示'),el('label',{class:'mode-option'},live,'AI 模式')),detail);
  showModal('选择分析方式',content,[button('取消',closeModal),button('保存本次设置',()=>{if(live.checked&&(!key.value.trim()||!model.value.trim()))throw new Error('AI 模式需要填写模型名称和 API Key。');const tested=sameModelConfig(connectionState.config,draftConfig())&&connectionState.status==='success';sessionConfig={mode:live.checked?'model':'rules',provider:provider.value,model:model.value.trim(),apiKey:key.value.trim(),workspaceId:workspace.value.trim()};closeModal();render();toast(live.checked?(tested?'AI 模式已启用。连接已测试，分析结果仍需人工检查。':'AI 模式已启用，连接尚未通过测试。可在模型设置中测试连接。'):'已使用本地规则演示，不上传聊天。');},{kind:'primary'})],{scrollBody:true});
  refreshConnectionStatus();
}
function externalLink(label,href){return el('a',{href,target:'_blank',rel:'noopener noreferrer'},label,icon('arrow'));}
function guideModal(){
  const steps=[
    ['先体验完整流程','保持「本地规则演示」，载入演示案例。查看需求、处理客户的新要求，再导出交付确认单，无需注册或密钥。'],
    ['准备使用 AI','解压完整作品包，双击「启动作品.cmd」，保持启动窗口开启。若提示缺少 Node.js，请按作品里的 README 安装后重试。'],
    ['申请自己的密钥',el('span',{},'登录 ',externalLink('DeepSeek 开放平台','https://platform.deepseek.com/api_keys'),' 或 ',externalLink('阿里云百炼','https://bailian.console.aliyun.com/'),'，创建 API Key，并确认账户有可用额度。密钥直接填进作品，无需发给别人。')],
    ['填写模型设置','点击右上「模型设置」，选择「AI 模式」，填写供应商、可用模型名称和 API Key。千问默认接入北京地域；使用子业务空间时可再填写空间 ID。'],
    ['测试并保存','点击「测试连接」，等待明确结果。测试仅发送固定示例，会产生少量调用费用。连接成功后点击「保存本次设置」；保存本身不会测试密钥。'],
    ['分析真实需求','先去掉姓名、电话等客户隐私，再粘贴聊天，点击「提取需求清单」或「分析这次变更」。检查每条需求及原文依据，确认后保存版本。'],
    ['逐项确认追加费用','横图、源文件和勾选的加急项使用个人价目表；易拉宝等其他新增交付选择「接受变更」后，填写「此项追加费用（元）」。留空时总额待定，不能保存决定。本次不收费可选「本次赠送」，每项独立计算。']
  ];
  const content=el('div',{},el('p',{class:'modal-intro'},'从无需密钥的体验开始，再接入自己的 AI 账户。'),el('ol',{class:'guide-steps'},steps.map(([title,body],index)=>el('li',{},el('span',{class:'guide-number'},index+1),el('div',{},el('h3',{},title),el('p',{},body))))),el('div',{class:'inline-warning'},'密钥只保留在当前页面，刷新后需要重新填写。连接测试成功仅说明可以调用；模型理解和提取的内容仍需人工核对。'),el('p',{class:'settings-disclosure'},'遇到连接失败：按提示检查密钥、账户额度、模型名称和密钥地域；若提示本地服务无法连接，重新双击启动作品.cmd。'));
  showModal('使用指引',content,[button('关闭',closeModal),button('打开模型设置',settingsModal,{kind:'primary',ico:'settings'})],{scrollBody:true});
}
function ratesModal() {
  const p=current(),inputs={};
  const fields=[['horizontal','增加一版横图',100],['sourceFiles','额外交付源文件',80],['rush','提前交付 / 加急',60]];
  const content=el('div',{},el('p',{class:'modal-intro'},'这是你自己的单价表，单位为元。只对你选择「接受」的匹配项计费；「本次赠送」始终按 0 元计算。'));
  fields.forEach(([key,label])=>{const input=el('input',{id:`rate-${key}`,type:'number',min:0,max:1000000,step:.01,value:p.rates[key]??0});inputs[key]=input;content.append(formField(label,input));});
  content.append(el('p',{class:'settings-disclosure'},'模型不决定报价。易拉宝等其他新增交付需在变更卡片中逐项填写费用。修改这里不会改写原项目预算或已保存版本的报价。'));
  showModal('我的追加费用表',content,[button('取消',closeModal),button('保存价目表',()=>{for(const [key,input]of Object.entries(inputs)){const n=Number(input.value);if(!input.value||!Number.isFinite(n)||n<0||n>1000000)throw new Error('请填写 0 至 1,000,000 之间的有效金额。');p.rates[key]=Math.round(n*100)/100;}p.draft='';persist();closeModal();render();toast('价目表已更新，金额按你的单价计算。');},{kind:'primary'})]);
}
function historyModal() {
  const p=current(),content=el('div',{},el('p',{class:'modal-intro'},'每个确认版本都独立保留，新的决定不会覆盖旧记录。'));
  if(!p.versions.length)content.append(emptyState('还没有确认版本','整理并确认第一份需求后，历史记录会出现在这里。','history'));
  p.versions.slice().reverse().forEach(v=>{
    const details=el('details',{},el('summary',{},'查看需求与本次决定'),el('dl',{},v.requirements.map(r=>[el('dt',{},r.label),el('dd',{},r.value)])));
    if(v.changeSnapshot?.length)details.append(el('ul',{class:'delivery-changes'},v.changeSnapshot.map(s=>el('li',{},`${s.label} · ${{accept:'接受',gift:'本次赠送',ask:'待追问',reject:'不接受'}[s.action]}：${s.after}${s.action==='accept'&&Object.hasOwn(s,'feeCents')?` · 此项追加费用 ¥ ${money(s.feeCents/100)}`:''}`))));
    if(v.quoteSnapshot){details.append(el('p',{},quoteTotalText(v.quoteSnapshot)));appendQuoteDetails(details,v.quoteSnapshot);}
    content.append(el('div',{class:'history-item'},el('div',{class:'history-heading'},el('strong',{},v.label),badge(v.id===latest(p)?.id?'当前版本':'历史快照',v.id===latest(p)?.id?'green':'gray')),el('p',{},`${formatTime(v.createdAt)} · ${v.note||'已确认需求'}`),details));
  });showModal('版本历史',content,[button('关闭',closeModal)]);
}
function demoModal() {
  showModal('用一个真实感的订单，试试完整流程',el('div',{},el('p',{class:'modal-intro'},'演示使用合成聊天，不包含真实客户信息。它展示「先确认需求，再识别追加事项」的工作过程。'),el('div',{class:'source-quote'},ORIGINAL),el('p',{class:'modal-intro'},'接下来客户提出横图、源文件和提前交付。你可以接受、赠送、追问或拒绝，并生成确认单。'),el('div',{class:'inline-warning'},'载入演示会新增一个示例项目，当前项目及历史版本会保留。')),[button('取消',closeModal),button('载入演示案例',()=>{if(state.projects.length>=50)throw new Error('项目数量已达上限，请先清理旧项目。');const demo=seedProject();state.projects.push(demo);state.activeId=demo.id;step=3;persist(true);closeModal();render();toast('演示已载入，试着处理右侧的变化。');},{kind:'primary',ico:'coffee'})]);
}
function manageProjectModal() {
  const p=current();
  showModal('管理当前项目',el('div',{},el('p',{class:'modal-intro'},`当前项目「${p.name}」有 ${p.versions.length} 个确认版本。删除会移除本浏览器中的项目记录，请先按需导出备份。`),el('div',{class:'preset-menu'},button('导出当前项目备份',downloadJSON,{ico:'download'}),button('导入 JSON 文件',()=>{closeModal();document.querySelector('#import-file').click();},{ico:'upload'}))),[button('关闭',closeModal),button('删除当前项目',()=>{showModal('确认删除项目',el('p',{class:'modal-intro'},`删除「${p.name}」及其所有本地版本？已导出的文件不受影响，此操作无法撤销。`),[button('保留项目',closeModal),button('确认删除',()=>{state.projects=state.projects.filter(x=>x.id!==p.id);if(!state.projects.length){const demo=seedProject();state.projects.push(demo);}state.activeId=state.projects[0].id;step=state.projects[0].versions.length?3:1;persist(true);closeModal();render();toast('项目已从此浏览器移除。');},{kind:'danger',ico:'trash'})]);},{kind:'danger',ico:'trash'})]);
}
function makeDraft(p) {
  const base=latest(p);if(!base)return '';
  const changes=p.changes.filter(c=>c.kind!=='unchanged'),accepted=[],gift=[],rejected=[],pending=[];
  for(const c of changes){const d=p.decisions[c.id];const text=`${c.label}：${d?.value||c.after}`;if(d?.action==='accept')accepted.push(text);else if(d?.action==='gift')gift.push(text);else if(d?.action==='reject')rejected.push(`${c.label}保留原约定（${c.before||'原订单未包含'}）`);else pending.push(c.question||`请确认${c.label}的具体内容：${c.after}`);}
  const quote=projectQuote(p),lines=[`你好，关于「${p.name}」，我整理了一下这次的交付约定：`,'',...base.requirements.map(r=>`· ${r.label}：${r.value}`)];
  if(accepted.length)lines.push('','这次可以调整的内容：',...accepted.map(s=>`· ${s}`));
  if(gift.length)lines.push('','这次额外赠送（仅本次）：',...gift.map(s=>`· ${s}`));
  if(rejected.length)lines.push('','以下内容保留原约定：',...rejected.map(s=>`· ${s}`));
  if(accepted.length||gift.length)lines.push('',quote.hasPending?`本次追加总额待定，已定价部分为 ¥${money(quote.total)}，仍有新增交付需要报价，暂不确认总金额。`:`按逐项报价和个人价目表，本次追加费用为 ¥${money(quote.total)}，原订单预算保持原约定，待你确认。`,...(quote.items||[]).map(item=>`· ${quoteItemText(item)}`));
  if(pending.length)lines.push('','这些事项还需要你确认，暂不计入交付：',...pending.map(s=>`· ${s}`));
  if(!p.changesCommitted&&changes.length)lines.push('','以上变更仍为沟通草稿，我会在确认后更新正式交付版本。');
  lines.push('','麻烦核对一下，确认后我就按这份清单继续推进。');return lines.join('\n');
}
function download(content,type,name) {
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function safeFilename(name){return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,80);}
function downloadJSON() {
  const p=current(),exportData={app:'gaigao-youzhang',schemaVersion:1,exportedAt:now(),projects:[clone(p)],activeId:p.id};
  download(JSON.stringify(exportData,null,2),'application/json;charset=utf-8',`${safeFilename(p.name)}-项目备份.json`);toast('JSON 备份已导出，不包含 API Key。');
}
function markdownEscape(text){return String(text||'').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');}
function downloadMarkdown() {
  const p=current(),base=latest(p);if(!base)throw new Error('请先保存需求版本。');
  const quote=projectQuote(p),lines=[`# ${p.name} · 交付确认单`,'',`版本：${base.label}　保存时间：${formatTime(base.createdAt)}`,p.isDemo?'合成演示数据':'','', '## 当前已确认需求','','| 字段 | 约定值 | 对应原文 |','| --- | --- | --- |',...base.requirements.map(r=>`| ${markdownEscape(r.label)} | ${markdownEscape(r.value)} | ${markdownEscape(r.quote)} |`)];
  const changes=p.changes.filter(c=>c.kind!=='unchanged');if(changes.length){lines.push('','## 本次变更与决定','','| 事项 | 原约定 | 客户新提议 | 对应原文 | 决定 | 确认值 |','| --- | --- | --- | --- | --- | --- |',...changes.map(c=>{const d=p.decisions[c.id];return`| ${[c.label,c.before,c.after,c.quote,d?{accept:'接受',gift:'本次赠送',reject:'不接受',ask:'待追问'}[d.action]:'未处理',d?.value||''].map(markdownEscape).join(' | ')} |`;}),'','## 本次追加费用明细','',...(quote.items||[]).map(item=>`- ${quoteItemText(item)}`),'',quoteTotalText(quote),p.changesCommitted?'本次决定与报价已保存到确认版本。':'本次变更决定尚未写入确认版本。');}
  lines.push('','## 给客户的沟通草稿','',p.draft||makeDraft(p),'','---','此确认单供双方核对。提问和待确认内容不自动成为交付承诺。');
  download(lines.join('\n'),'text/markdown;charset=utf-8',`${safeFilename(p.name)}-${base.label}-确认单.md`);toast('Markdown 确认单已导出。');
}
async function copyText(text) {
  try{await navigator.clipboard.writeText(text);toast('已复制，可粘贴给客户。');}catch{const area=document.querySelector('#client-draft');area?.focus();area?.select();toast('浏览器未允许自动复制，已选中文字，请按 Ctrl+C。','info');}
}
document.querySelector('#import-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{if(file.size>5*1024*1024)throw new Error('备份文件超过 5 MB，请选择单个项目导出的 JSON。');const data=validateWorkspace(JSON.parse(await file.text()));showModal('导入项目备份',el('p',{class:'modal-intro'},`已检查文件，将导入 ${data.projects.length} 个项目。导入会创建新的项目副本，保留当前所有项目。`),[button('取消',closeModal),button('确认导入',()=>{if(state.projects.length+data.projects.length>50)throw new Error('导入后会超过 50 个项目，请先清理旧项目。');for(const p of data.projects){p.id=id();p.name=`${p.name}（导入）`;state.projects.push(p);state.activeId=p.id;}step=current().versions.length?3:1;persist(true);closeModal();render();toast('项目已导入，原有项目均已保留。');},{kind:'primary',ico:'upload'})]);}catch(error){toast(error instanceof SyntaxError?'文件不是有效 JSON，请选择改稿有账导出的备份。':error.message,'error');}
});
window.addEventListener('unhandledrejection',event=>{event.preventDefault();toast(event.reason?.message||'操作未完成，请重试。','error');});
window.addEventListener('pagehide',()=>persist(true));
render();
persist();
