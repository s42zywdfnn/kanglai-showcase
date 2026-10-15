import {readDashboard, readProvinceGeometry} from './data-adapter.js';
import {DEMO_EVENTS, createState, applyNext, resetState, setPaused} from './event-model.js';
import {applyOperation,incrementShare} from './operations-model.js';
import {tweenValue,trendGeometry} from './motion-model.js';

const screen=document.querySelector('#screen');
const dialog=document.querySelector('#detail-dialog');
const filmDialog=document.querySelector('#brand-film-dialog');
const film=filmDialog.querySelector('video');
film.src='film/media/brand-film.mp4';
let exitFilmFullscreen=false;
const fmt=n=>Number(n).toLocaleString('zh-CN');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STEPS=['资料输入','AI分析','V1草案','专业确认','多维行动','专业点评','阶段复盘','调整与复核'];
const AUDIT=[['既有医嘱','医院营养安排优先'],['资料缺口','待确认信息不写成结论'],['行动适配','按当日状态安排最低执行'],['安全边界','出现不适及时暂停并反馈']];
let baseline,state,geometry,selectedRegion='浙江省',operationNotice='',chartMin,chartMax,graphDisplayAction,graphFrame,mapFrame,tourLastTime=0,tourElapsed=0,tourPathLength=0;
let resumeAfterFilm=false;
const countFrames=new WeakMap();

function scale(){const s=Math.min(innerWidth/1920,innerHeight/1080);screen.style.transform=`translate(-50%,-50%) scale(${s})`;}
addEventListener('resize',scale);scale();
function row(items,name){return items.find(x=>x.name===name);}
function currentStage(){return state.current?.stage??0;}
function gain(value,original,unit=''){const amount=value-original;return amount>0?`<small class="data-gain">本轮 +${fmt(amount)}${unit}</small>`:'';}
function renderMetrics(){
  const d=state.data;
  const items=[
    ['history','累计用户',d.historical.display,'人','含 AI 在管用户 · 跨阶段去重'],
    ['enroll','AI赋能在管用户',fmt(d.totals.users),'人','唯一身份去重'],
    ['plan','累计生成方案版本',fmt(d.totals.planVersions),'份','同一人可多版本'],
    ['action','累计行动记录',fmt(d.totals.actionRecords),'条','同一人可多次行动'],
    ['feedback','累计阶段反馈',fmt(d.totals.stageFeedback),'条','进入复评与调整']
  ];
  const fields={enroll:'users',plan:'planVersions',action:'actionRecords',feedback:'stageFeedback'};
  return `<section class="metrics" aria-label="服务规模与记录总量">${items.map(([key,label,value,unit,note])=>`<button class="metric" data-detail="${key}" type="button"><span class="metric-label">${label}</span><strong class="metric-value">${value}<span class="metric-unit">${unit}</span></strong><span class="metric-index">${note}</span>${key==='history'?gain(d.totals.users,baseline.totals.users,'人'):fields[key]?gain(d.totals[fields[key]],baseline.totals[fields[key]],unit):''}</button>`).join('')}</section>`;
}
function renderProfile(){
  const d=state.data,female=row(d.people.gender,'女性').value;
  const middleAge=row(d.people.age,'40—49岁').value+row(d.people.age,'50—59岁').value;
  return `<div class="left-column">
    <section class="panel profile-panel"><div class="panel-head"><h2>服务人群画像</h2><button type="button" data-detail="profile">完整分布 ↗</button></div>
      <div class="profile-insights"><div><strong>${Math.round(female/d.totals.users*100)}%</strong><span>女性</span><small class="profile-count">${fmt(female)} 人</small>${gain(female,row(baseline.people.gender,'女性').value,'人')}</div><div><strong>${Math.round(middleAge/d.totals.users*100)}%</strong><span>40—59 岁</span><small class="profile-count">${fmt(middleAge)} 人</small>${gain(middleAge,row(baseline.people.age,'40—49岁').value+row(baseline.people.age,'50—59岁').value,'人')}</div></div>
      <p class="insight-foot">累计占比 · 在管去重：${fmt(d.totals.users)} 人</p>
    </section>
    <section class="panel region-need-panel"><div class="panel-head"><h2>健康需求关注</h2><span>可多选</span></div>
      <div class="demand-insights">${d.people.needs.map((x,i)=>`<div><span>${esc(x.name.replace('管理','').replace('支持',''))}</span><strong>${fmt(x.value)}</strong>${gain(x.value,baseline.people.needs[i].value)}</div>`).join('')}</div>
    </section>
    <section class="panel lifestyle-panel"><div class="panel-head"><h2>六维行动分布</h2><span>累计% · 本轮%</span></div>
      <div class="pillar-insights">${d.actions.pillars.map((x,i)=>`<div><span>${esc(x.name)}</span><strong>${Math.round(x.value/d.totals.actionRecords*100)}%</strong>${gain(x.value,baseline.actions.pillars[i].value,'条')}</div>`).join('')}</div>
    </section></div>`;
}
const project=([lon,lat])=>[32+(lon-73)*12.25,40+(54-lat)*11.6];
const insetProject=([lon,lat])=>[688+(lon-105)*6.3,318+(23-lat)*9.2];
function polygonPath(polygons,inset=false){const fn=inset?insetProject:project;return polygons.map(poly=>poly.map(ring=>ring.map((point,i)=>{const [x,y]=fn(point);return `${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`;}).join(' ')+' Z').join(' ')).join(' ');}
function renderMapSvg(){
  const d=state.data,values=new Map(d.people.regions.map(x=>[x.name,x.value]));
  const paths=geometry.features.filter(f=>f.properties.name).map(f=>{const name=f.properties.name,polys=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];return `<path class="province ${name===selectedRegion?'active':''}" data-region="${esc(name)}" d="${polygonPath(polys)}" fill-rule="evenodd" tabindex="0" role="button" aria-label="查看${esc(name)}"><title>${esc(name)} ${fmt(values.get(name))} 人</title></path>`;}).join('');
  const islands=geometry.features.find(f=>!f.properties.name);
  const marker=geometry.features.find(f=>f.properties.name===selectedRegion);
  const [mx,my]=project(marker.properties.centroid||marker.properties.center);
  return `<svg id="china-map" viewBox="0 0 860 540" role="img" aria-label="省级服务区域分布"><defs><radialGradient id="mapGlow"><stop stop-color="#62bc82" stop-opacity=".35"/><stop offset="1" stop-color="#62bc82" stop-opacity="0"/></radialGradient></defs><ellipse cx="435" cy="265" rx="320" ry="215" fill="url(#mapGlow)"/>${paths}<rect x="674" y="323" width="159" height="205" rx="6" fill="#0c302a88" stroke="#6da78e88"/>${islands?`<path class="islands" d="${polygonPath(islands.geometry.coordinates,true)}"/>`:''}<text class="map-muted-label" x="690" y="344">南海诸岛</text><circle class="map-pulse event-pulse" cx="${mx}" cy="${my}" r="5"/></svg>`;
}
function renderMiniMap(){const d=state.data,r=row(d.people.regions,selectedRegion),old=row(baseline.people.regions,selectedRegion),leaders=[...d.people.regions].sort((a,b)=>b.value-a.value).slice(0,3);return `<section class="mini-map-panel"><div class="mini-map-head"><h2>全国服务覆盖</h2><span>34 个省级区域</span></div><div class="mini-map-visual"><div id="map-svg-host">${renderMapSvg()}</div></div><div class="map-info"><div class="map-info-label">当前聚焦 ${gain(r.value,old.value,'人')}</div><div class="map-info-name">${esc(r.name)}</div><div class="map-info-value">${fmt(r.value)}<small>人</small></div><div class="map-info-note">占在管用户 ${(r.value/d.totals.users*100).toFixed(1)}%</div></div><div class="map-nav"><button id="prev-region" type="button" aria-label="上一区域">‹</button><span>${String(d.people.regions.indexOf(r)+1).padStart(2,'0')} / 34</span><button id="next-region" type="button" aria-label="下一区域">›</button></div><div class="map-ranking"><div>在管用户较多的地区</div>${leaders.map(x=>`<div class="map-rank-row" data-rank="${esc(x.name)}"><span>${esc(x.name)}</span><i><b style="width:${(x.value/leaders[0].value*100).toFixed(1)}%"></b></i><em>${fmt(x.value)}</em></div>`).join('')}</div><div class="map-brief">区域人数与顶部在管用户同一去重口径</div></section>`;}
function planSheet(v,status){
  const change=v==='V2';
  return `<div class="plan-sheet"><header><div><small>青荷康康 · 生活方式医学</small><b>369 健康管理方案</b></div><strong>${v}</strong></header><div class="plan-meta">小青 / 首月行动 <span>${status}</span></div><div class="plan-rule"></div><div class="plan-focus"><span>调理主线 <b>关系边界与身心安定</b></span><span>辅助方向 <b>稳糖代谢 · 肌肉恢复</b></span></div><div class="plan-goal"><b>阶段目标</b><span>稳定日常节奏，逐步恢复活动，练习合理分担责任</span></div><div class="plan-actions"><span class="${change?'changed':''}"><b>关系</b>${change?'每天识别一件可交还的责任':'识别责任边界'}</span><span class="${change?'changed':''}"><b>运动</b>${change?'状态差时采用最低执行版':'按当日状态循序活动'}</span><span><b>睡眠</b>记录夜醒与睡前刺激</span><span><b>营养</b>遵医嘱规律进食</span></div><footer>${change?'V2 调整：降低困难日执行负担 · 保留记录与复评':'V1 首轮：多维记录 · 每周复盘 · 既有医嘱优先'}</footer></div>`;
}
function renderWorkflowVisual(event){const id=event?.id||'e09';const scenes={
e01:`<div class="visual-top"><b>多源信息进入个人健康档案</b><span class="live-dot">持续汇集</span></div><div class="intake-grid"><article class="intake-card"><header><b>01 自检表</b><small>自填信息</small></header><div class="intake-media"><img src="assets/intake-self-check.jpg" alt="平板上的健康习惯自检问卷"><span>自主填写</span></div><footer>习惯 · 目标 · 可用时间</footer></article><article class="intake-card"><header><b>02 体检报告</b><small>检查资料</small></header><div class="intake-media"><img src="assets/intake-report.jpg" alt="无个人信息的体检报告与扫描界面"><span>报告录入</span></div><footer>原报告归档 · 指标提取</footer></article><article class="intake-card"><header><b>03 舌苔照片</b><small>图像资料</small></header><div class="intake-media"><img src="assets/intake-tongue.jpg" alt="手机中的舌苔图像采集画面"><span>待专业判读</span></div><footer>保留图像 · 不自动诊断</footer></article><article class="intake-card"><header><b>04 专家面诊</b><small>专业意见</small></header><div class="intake-media"><img src="assets/consult.jpg" alt="专家面诊场景画面"><span>面诊记录</span></div><footer>意见与既有医嘱</footer></article></div><div class="intake-transfer"><div class="intake-connectors"><span><i class="device-watch" aria-hidden="true"></i>手表</span><span><i class="device-phone" aria-hidden="true"></i>小程序</span><span><i class="record-pulse" aria-hidden="true"></i>日常记录</span></div><i class="intake-line"></i><b>健康档案</b></div>`,
e02:`<div class="visual-top"><b>多源资料汇聚 → 六维画像 → 知识依据</b><span class="live-dot">画像形成中</span></div><div class="ai-flow"><div class="ai-sources"><span>自检 / 体检 / 图像</span><span>日常行动记录</span><span>微信沟通要点</span><span>专家面诊意见</span></div><div class="ai-hub"><div><b>AI</b><small>统一档案</small></div></div><div class="ai-tags"><div><small>主因线索</small><b>关系压力牵动节奏</b></div><div><small>调理重点</small><b>身心安定 · 责任边界</b></div><div><small>可执行条件</small><b>运动按状态分级</b></div><div><small>待观察信息</small><b>夜醒与日常反馈</b></div></div></div><div class="ai-knowledge"><span>依据匹配</span><b>生活方式知识</b><b>个案经验</b><b>安全规则</b><b>专家审核要点</b><em>→ V1 输入</em></div>`,
e03:`<div class="visual-top"><b>画像重点与知识依据生成 369 V1</b><span>草案 · 尚未交付</span></div><div class="plan-compose"><div class="plan-inputs"><div><i>01</i>档案 · 主因线索</div><div><i>02</i>六维画像 · 执行条件</div><div><i>03</i>知识规则 · 安全边界</div><strong>AI 辅助生成 <em>→</em></strong></div>${planSheet('V1','待专业确认')}</div>`,
e04:`<div class="visual-top"><b>专家审核同一份多维 V1 方案</b><span>V1 · 核对完成</span></div><div class="plan-approval">${planSheet('V1','已确认 / 可交付')}<div class="approval-side"><small>专业审核</small><strong>逐项核对 V1</strong><div class="approval-check"><span>主线与阶段目标是否适配</span><span>运动、睡眠、关系行动能否执行</span><span>既有医嘱与不适暂停边界</span></div><b>专家确认 · V1 交付</b></div></div>`,
e05:`<div class="visual-top"><b>执行 V1 · 每日六维行动进入档案</b><span class="live-dot">第 1 周记录</span></div><div class="daily-execution"><div class="daily-app"><div class="daily-app-head"><small>青荷康康 · 今日行动</small><b>首月 / 第 1 周</b></div><div class="daily-app-row"><i>01</i><span>关系边界</span><em>记录</em></div><div class="daily-app-row"><i>02</i><span>循序活动</span><em>记录</em></div><div class="daily-app-row"><i>03</i><span>睡眠节奏</span><em>记录</em></div><div class="daily-app-row"><i>04</i><span>规律进食</span><em>记录</em></div><div class="daily-app-foot">行动 · 感受 · 当日状态</div></div><div class="daily-feed"><article><b>关系</b><span>区分自己的任务与可交还的责任</span><small>边界练习 → 画像更新</small></article><article><b>运动</b><span>按体力状态选择低强度活动</span><small>执行条件 → 画像更新</small></article><article><b>睡眠</b><span>记录夜醒、睡前刺激与感受</span><small>生活节奏 → 画像更新</small></article><article><b>营养</b><span>记录规律进食与身体感受</span><small>既有医嘱 → 优先</small></article></div></div><div class="visual-note">多维记录持续回流同一健康档案；画面为服务流程重现。</div>`,
e06:`<div class="visual-top"><b>专业人员读取同一档案，给出分维回应</b><span>结合已交付 V1</span></div><div class="feedback-board"><div class="feedback-input"><small>本周记录摘要</small><div><b>关系</b><span>边界练习已开始</span></div><div><b>运动</b><span>状态不同，执行量有波动</span></div><div><b>睡眠</b><span>夜醒信息继续观察</span></div></div><div class="feedback-output"><small>专业点评要点</small><div><i>01</i><span>先肯定已完成的边界识别，下一步只选一件可交还的任务。</span></div><div><i>02</i><span>低状态日降低活动负担，不追求一次完成全部计划。</span></div><div><i>03</i><span>继续记录夜醒与不适，异常情况按既有医嘱处理并反馈。</span></div></div></div><div class="visual-note">点评连接具体记录与既有方案，保留专业判断和安全边界。</div>`,
e07:`<div class="visual-top"><b>记录与点评汇总 → 第 1 周阶段复盘</b><span class="live-dot">形成调整依据</span></div><div class="review-sequence"><div><b>关系</b><span>边界识别已起步；沟通动作仍需拆小</span></div><div><b>运动</b><span>体力状态波动；困难日执行负担偏高</span></div><div><b>睡眠</b><span>夜醒仍需持续记录，暂不推断改善</span></div></div><div class="weekly-feedback"><b>调整重点</b><span>保持多维记录；把运动改为按状态选择的最低执行版，关系练习从一件事开始。</span></div><div class="visual-note">复盘反映执行反馈，不作为健康效果或诊断结论。</div>`,
e08:`<div class="visual-top"><b>复盘依据进入 V2：调整执行强度</b><span>变更待专业核对</span></div><div class="plan-revision"><div>${planSheet('V1','已交付')}</div><i>→</i><div>${planSheet('V2','待专业确认')}</div></div>`,
e09:`<div class="visual-top"><b>专家复核 V2 变更并交付</b><span>V2 · 核对完成</span></div><div class="plan-approval">${planSheet('V2','已确认 / 继续执行')}<div class="approval-side"><small>专业复核</small><strong>核对 V2 变更</strong><div class="approval-check"><span>主线与目标继续保留</span><span>关系任务拆分是否可执行</span><span>运动最低执行版是否适配</span><span>继续记录夜醒、边界与不适</span></div><b>专家确认 · V2 交付</b><div class="service-loop"><span>行动反馈</span><i></i><span>档案更新</span><i></i><span>下一轮行动</span></div></div></div>`
};return `<div class="workflow-visual scene-${id}" key="${id}">${scenes[id]}</div>`;}
function renderCase(){
  const stage=currentStage(),event=state.current;
  const v1=state.versions['P-001'],v2=state.versions['P-002'];
  const delivered=v2==='已确认'?'V2 已确认':v1==='已确认'?'V1 已确认':'尚未交付';
  const draft=v2==='待核对'?'V2 待核对':v1==='待核对'?'V1 待核对':'无';
  return `<section class="case-panel" aria-label="一个方案怎样形成"><div class="case-head"><div><div class="case-eyebrow">PERSONALIZED PLAN × AI ASSISTED WORKFLOW</div><h2>一个方案怎样形成</h2></div><button type="button" data-detail="case">查看方案依据 ↗</button></div>
    <div class="case-rail" style="--stage-progress:${stage/7*86}%">${STEPS.map((name,i)=>`<div class="case-rail-step${i===stage?' active':i<stage?' done':''}"><i></i><span>${name}</span></div>`).join('')}</div>
    <div class="case-stage"><div class="process-view"><div class="process-kicker">案例第 ${String(state.cursor).padStart(2,'0')} / ${String(DEMO_EVENTS.length).padStart(2,'0')} 步 <span>服务过程回放</span></div><div class="case-status"><span>已交付方案：${delivered}</span><span>待核对草案：${draft}</span></div><h3>${esc(event?.title||'从一个人的健康资料开始')}</h3><p class="event-detail">${esc(event?.detail||'资料、生活条件与既有建议汇集，形成一份能执行的方案。')}</p></div>
      ${renderWorkflowVisual(event)}</div>
    <div class="case-bottom"><span class="operation-notice">运营数据联动 · ${esc(operationNotice)}</span><div><button id="next-event" type="button">下一条 ›</button><button id="reset-events" type="button">重置</button></div></div>
    <div class="case-progress"><span></span></div></section>`;
}
function renderAudit(){const active=state.current?.type==='review';return `<section class="panel audit-panel${active?' audit-focus':''}"><div class="panel-head"><h2>专业把关重点</h2><span>方案交付前核对</span></div><div class="audit-intro">AI形成草案，专业人员判断适配与安全边界</div><div class="audit-list">${AUDIT.map(([title,detail],i)=>`<div class="audit-item"><b>${String(i+1).padStart(2,'0')}</b><div><strong>${title}</strong><p>${detail}</p></div></div>`).join('')}</div><div class="audit-foot">依据真实脱敏方案提炼审核要点</div></section>`;}
function renderRight(){return `<div class="right-column"><section class="panel resource-panel"><div class="panel-head"><h2>专业知识与协作资源</h2><span>服务支撑</span></div><div class="resource-highlight"><div><strong>140+</strong><span>健康内容 IP</span></div><div><strong>近200</strong><span>合作医疗专家</span></div></div><div class="resource-band">6–8 个专科合作方向</div><div class="knowledge-inline"><span>自建知识库</span><span>个案库</span><span>RAG 检索</span><span>规则模板</span></div></section>${renderAudit()}</div>`;}
function chartSvg(){const rows=state.data.trend,shape=trendGeometry(rows.map(x=>x.actions),chartMax,chartMin),firstY=(118-(rows[0].actions-chartMin)/(chartMax-chartMin)*100).toFixed(2);return `<svg class="trend-chart" viewBox="0 0 405 145" role="img" aria-label="近七日行动记录趋势"><defs><linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#95deb0" stop-opacity=".34"/><stop offset="1" stop-color="#95deb0" stop-opacity="0"/></linearGradient></defs><path class="chart-grid" d="M31 24H395 M31 70H395 M31 117H395"/><path class="chart-area" d="${shape.area}"/><path class="chart-line" d="${shape.line}"/><path class="chart-run" d="${shape.line}"/>${rows.map((r,i)=>`<circle class="chart-point" cx="${32+i*58}" cy="${(118-(r.actions-chartMin)/(chartMax-chartMin)*100).toFixed(2)}" r="3.7"><title>${r.day} ${fmt(r.actions)} 条</title></circle><text class="axis-label" x="${17+i*58}" y="139">${r.day}</text>`).join('')}<g class="chart-tour"><line class="chart-tour-guide" x1="32" x2="32" y1="24" y2="117"/><circle class="chart-tour-halo" cx="32" cy="${firstY}" r="11"/><circle class="chart-tour-dot" cx="32" cy="${firstY}" r="5"/><g class="chart-tour-label"><rect x="-49" y="-11" width="98" height="21" rx="5"/><text y="4" text-anchor="middle"></text></g></g></svg>`;}
function renderBottom(){const d=state.data,t=d.trend.at(-1),base=baseline.trend.at(-1);return `<div class="bottom"><section class="service-panel"><div class="bottom-head"><h2>两类实际服务交付</h2><span>覆盖肥胖、糖尿病、高血脂、妇科健康</span></div><div class="program-grid">${d.people.primaryServices.map((x,i)=>`<button class="program-card" type="button" data-detail="program:${i}"><span class="program-index">0${i+1} / SERVICE</span><strong>${i?'TLC 21天生活方式方案':'369 健康管理方案'}</strong><span class="program-cycle">${i?'21 天分阶段执行 · 记录与复盘':'首月四周安排 · 每周行动与边界'}</span><span class="program-count">在管 ${fmt(x.value)} 人 ↗ ${gain(x.value,baseline.people.primaryServices[i].value,'人')}</span></button>`).join('')}</div></section><section class="trend-panel"><div class="bottom-head"><h2>行动与反馈趋势</h2><span>近七日记录 · 非健康成效</span></div><div class="trend-body"><div>${chartSvg()}</div><div class="trend-side"><div><i class="trend-key"></i>示例日行动<strong>${fmt(t.actions)} 条 ${gain(t.actions,base.actions)}</strong></div><div>示例日方案版本<strong>${fmt(t.plans)} 份 ${gain(t.plans,base.plans)}</strong></div><div>示例日阶段反馈<strong>${fmt(t.feedback)} 条 ${gain(t.feedback,base.feedback)}</strong></div></div></div></section></div>`;}
function render(){screen.classList.toggle('paused',state.paused);screen.innerHTML=`<header class="topbar"><div class="brand"><img src="assets/brand-icon.jpg" alt="青荷康康 Logo"><div class="brand-name">青荷康康</div></div><div class="title-wrap"><h1>AI驱动的生活方式健康专项</h1></div><div class="top-actions"><button class="playback-control brand-film-button" id="open-brand-film" type="button" aria-haspopup="dialog" aria-controls="brand-film-dialog">▶ 品牌片</button><button class="playback-control" id="playback-control" type="button">${state.paused?'▶ 继续':'Ⅱ 暂停'}</button><button class="playback-control" id="fullscreen" type="button">⛶ 全屏</button></div></header>${renderMetrics()}<div class="middle">${renderProfile()}<div class="center-panel">${renderCase()}${renderMiniMap()}</div>${renderRight()}</div>${renderBottom()}`;bind();}
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
function animateNumber(element,target,prefix='',suffix=''){
  if(!element)return;
  const node=element.firstChild;
  const from=Number(node.nodeValue.match(/[\d,]+/)?.[0].replaceAll(',',''));
  const prior=countFrames.get(node);
  if(prior)cancelAnimationFrame(prior);
  if(!Number.isFinite(from)||from===target||reduceMotion.matches){node.nodeValue=`${prefix}${fmt(target)}${suffix}`;return;}
  const start=performance.now(),duration=1050;
  function frame(now){const progress=Math.min(1,(now-start)/duration);node.nodeValue=`${prefix}${fmt(Math.round(tweenValue(from,target,progress)))}${suffix}`;if(progress<1)countFrames.set(node,requestAnimationFrame(frame));else countFrames.delete(node);}
  countFrames.set(node,requestAnimationFrame(frame));
}
function animatePercent(element,target){
  const node=element.firstChild,from=parseFloat(node.nodeValue),prior=countFrames.get(node);
  if(prior)cancelAnimationFrame(prior);
  if(!Number.isFinite(from)||from===target||reduceMotion.matches){node.nodeValue=`${target.toFixed(1)}%`;return;}
  const start=performance.now();
  function frame(now){const t=Math.min(1,(now-start)/1050);node.nodeValue=`${tweenValue(from,target,t).toFixed(1)}%`;if(t<1)countFrames.set(node,requestAnimationFrame(frame));else countFrames.delete(node);}
  countFrames.set(node,requestAnimationFrame(frame));
}
function setIncrementShare(host,share,label){
  let line=host.querySelector(':scope > .increment-share');
  if(share===null){if(line){const node=line.querySelector('b').firstChild,frame=countFrames.get(node);if(frame)cancelAnimationFrame(frame);countFrames.delete(node);line.remove();}return;}
  if(!line){line=document.createElement('small');line.className='increment-share';line.innerHTML=`${label} <b>0.0%</b>`;host.append(line);}
  animatePercent(line.querySelector('b'),share);
}
function setGain(host,value,original,unit=''){
  let badge=host.querySelector(':scope > .data-gain');
  const delta=value-original;
  if(delta<=0){badge?.remove();return;}
  if(!badge){badge=document.createElement('small');badge.className='data-gain';host.append(badge);if(!reduceMotion.matches)badge.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:600,easing:'ease-out'});}
  badge.textContent=`本轮 +${fmt(delta)}${unit}`;
}
function setPillarGain(host,value,original,share){
  let badge=host.querySelector(':scope > .data-gain');
  const delta=value-original;
  if(delta<=0){if(badge){const node=badge.querySelector('b')?.firstChild,frame=node&&countFrames.get(node);if(frame)cancelAnimationFrame(frame);badge.remove();}return;}
  if(!badge){badge=document.createElement('small');badge.className='data-gain';badge.innerHTML='+0条 · <b>0.0%</b>';host.append(badge);}
  badge.firstChild.nodeValue=`+${fmt(delta)}条 · `;
  badge.title=`本轮新增 ${fmt(delta)} 条，占本轮新增行动记录的 ${share.toFixed(1)}%`;
  animatePercent(badge.querySelector('b'),share);
}
function patchData(){
  const d=state.data,metric=screen.querySelectorAll('.metric');
  setGain(metric[0],d.totals.users,baseline.totals.users,'人');
  [['users',1,'人'],['planVersions',2,'份'],['actionRecords',3,'条'],['stageFeedback',4,'条']].forEach(([field,index,unit])=>{animateNumber(metric[index].querySelector('.metric-value'),d.totals[field]);setGain(metric[index],d.totals[field],baseline.totals[field],unit);});
  const female=row(d.people.gender,'女性').value,middle=row(d.people.age,'40—49岁').value+row(d.people.age,'50—59岁').value;
  const oldFemale=row(baseline.people.gender,'女性').value,oldMiddle=row(baseline.people.age,'40—49岁').value+row(baseline.people.age,'50—59岁').value;
  const cards=screen.querySelectorAll('.profile-insights>div');
  [[female,oldFemale],[middle,oldMiddle]].forEach(([value,original],i)=>{cards[i].querySelector('strong').textContent=`${Math.round(value/d.totals.users*100)}%`;animateNumber(cards[i].querySelector('.profile-count'),value,'',' 人');setGain(cards[i],value,original,'人');setIncrementShare(cards[i],incrementShare(value,original,d.totals.users,baseline.totals.users),'新增占比');});
  animateNumber(screen.querySelector('.insight-foot'),d.totals.users,'累计占比 · 在管去重：',' 人');
  screen.querySelectorAll('.demand-insights>div').forEach((card,i)=>{animateNumber(card.querySelector('strong'),d.people.needs[i].value);setGain(card,d.people.needs[i].value,baseline.people.needs[i].value);});
  screen.querySelectorAll('.pillar-insights>div').forEach((card,i)=>{const value=d.actions.pillars[i].value,original=baseline.actions.pillars[i].value;card.querySelector('strong').textContent=`${Math.round(value/d.totals.actionRecords*100)}%`;setPillarGain(card,value,original,incrementShare(value,original,d.totals.actionRecords,baseline.totals.actionRecords));});
  screen.querySelectorAll('.program-card').forEach((card,i)=>{const value=d.people.primaryServices[i].value,host=card.querySelector('.program-count');animateNumber(host,value,'在管 ',' 人 ↗ ');setGain(host,value,baseline.people.primaryServices[i].value,'人');});
  const sample=d.trend.at(-1),original=baseline.trend.at(-1);
  screen.querySelectorAll('.trend-side strong').forEach((host,i)=>{const [field,unit]=[['actions','条'],['plans','份'],['feedback','条']][i];animateNumber(host,sample[field],'',` ${unit} `);setGain(host,sample[field],original[field]);});
}
function patchCase(){
  const panel=screen.querySelector('.case-panel'),template=document.createElement('template');template.innerHTML=renderCase();
  const stage=panel.querySelector('.case-stage');panel.querySelector('.case-stage-ghost')?.remove();
  if(!reduceMotion.matches){
    const ghost=stage.cloneNode(true);ghost.classList.add('case-stage-ghost');ghost.style.cssText=`top:${stage.offsetTop}px;left:${stage.offsetLeft}px;width:${stage.offsetWidth}px;height:${stage.offsetHeight}px`;panel.append(ghost);
    ghost.animate([{opacity:1,transform:'translateY(0)',offset:0},{opacity:0,transform:'translateY(-12px)',offset:.4},{opacity:0,offset:1}],{duration:900,easing:'ease-in-out'}).finished.then(()=>ghost.remove()).catch(()=>{});
  }
  stage.innerHTML=template.content.querySelector('.case-stage').innerHTML;
  if(!reduceMotion.matches){stage.querySelector('.workflow-visual').style.animation='none';stage.animate([{opacity:0,transform:'translateY(12px)',offset:0},{opacity:0,transform:'translateY(12px)',offset:.42},{opacity:1,transform:'translateY(0)',offset:1}],{duration:900,easing:'ease-in-out'});}
  const current=currentStage(),rail=panel.querySelector('.case-rail');rail.style.setProperty('--stage-progress',`${current/7*86}%`);
  rail.querySelectorAll('.case-rail-step').forEach((node,i)=>{node.classList.toggle('active',i===current);node.classList.toggle('done',i<current);});
  panel.querySelector('.operation-notice').textContent=`运营数据联动 · ${operationNotice}`;
  screen.querySelector('.audit-panel').classList.toggle('audit-focus',state.current?.type==='review');
  const progress=panel.querySelector('.case-progress span');progress.style.animation='none';void progress.offsetWidth;progress.style.animation='';
}
function patchMap(previousRegion){
  const d=state.data,r=row(d.people.regions,selectedRegion),old=row(baseline.people.regions,selectedRegion);
  screen.querySelectorAll('.province').forEach(node=>{node.classList.toggle('active',node.dataset.region===selectedRegion);node.querySelector('title').textContent=`${node.dataset.region} ${fmt(row(d.people.regions,node.dataset.region).value)} 人`;});
  const info=screen.querySelector('.map-info');info.querySelector('.map-info-name').textContent=r.name;
  const value=info.querySelector('.map-info-value');if(previousRegion===selectedRegion)animateNumber(value,r.value);else{const frame=countFrames.get(value.firstChild);if(frame)cancelAnimationFrame(frame);countFrames.delete(value.firstChild);value.firstChild.nodeValue=fmt(r.value);}
  setGain(info.querySelector('.map-info-label'),r.value,old.value,'人');
  info.querySelector('.map-info-note').textContent=`占在管用户 ${(r.value/d.totals.users*100).toFixed(1)}%`;
  screen.querySelector('.map-nav span').textContent=`${String(d.people.regions.indexOf(r)+1).padStart(2,'0')} / 34`;
  const leaders=[...d.people.regions].sort((a,b)=>b.value-a.value).slice(0,3);
  screen.querySelectorAll('.map-rank-row').forEach((node,i)=>{const place=leaders[i];node.dataset.rank=place.name;node.querySelector('span').textContent=place.name;animateNumber(node.querySelector('em'),place.value);node.querySelector('b').style.width=`${(place.value/leaders[0].value*100).toFixed(1)}%`;});
  if(previousRegion!==selectedRegion&&!reduceMotion.matches)info.animate([{opacity:.45},{opacity:1}],{duration:600,easing:'ease-out'});
  const marker=screen.querySelector('.map-pulse'),feature=geometry.features.find(f=>f.properties.name===selectedRegion),[toX,toY]=project(feature.properties.centroid||feature.properties.center);
  const fromX=Number(marker.getAttribute('cx')),fromY=Number(marker.getAttribute('cy'));
  if(mapFrame)cancelAnimationFrame(mapFrame);
  if(reduceMotion.matches||previousRegion===selectedRegion){marker.setAttribute('cx',toX);marker.setAttribute('cy',toY);return;}
  const start=performance.now();function move(now){const t=Math.min(1,(now-start)/850);marker.setAttribute('cx',tweenValue(fromX,toX,t));marker.setAttribute('cy',tweenValue(fromY,toY,t));if(t<1)mapFrame=requestAnimationFrame(move);}mapFrame=requestAnimationFrame(move);
}
function drawTrend(action,emphasis=0){
  const values=[...state.data.trend.slice(0,-1).map(x=>x.actions),action],shape=trendGeometry(values,chartMax,chartMin),chart=screen.querySelector('.trend-chart');
  const line=chart.querySelector('.chart-line');line.style.animation='none';line.style.strokeDasharray='none';line.setAttribute('d',shape.line);
  chart.querySelector('.chart-area').setAttribute('d',shape.area);
  const run=chart.querySelector('.chart-run');run.setAttribute('d',shape.line);tourPathLength=run.getTotalLength();
  const point=chart.querySelectorAll('.chart-point')[6];point.setAttribute('cy',shape.lastY);point.setAttribute('r',(3.7+2*Math.max(0,emphasis)).toFixed(2));point.querySelector('title').textContent=`${state.data.trend.at(-1).day} ${fmt(Math.round(action))} 条`;
}
function tourTrend(now){
  const chart=screen.querySelector('.trend-chart');
  if(!chart||reduceMotion.matches)return;
  if(state.paused||document.hidden){tourLastTime=now;requestAnimationFrame(tourTrend);return;}
  if(tourLastTime)tourElapsed=(tourElapsed+Math.min(now-tourLastTime,60))%8000;
  tourLastTime=now;
  const phase=tourElapsed/8000,progress=Math.min(1,phase/.9),opacity=Math.min(1,phase/.08,Math.max(0,(1-phase)/.1));
  const points=chart.querySelectorAll('.chart-point'),segment=Math.min(5,Math.floor(progress*6)),part=progress*6-segment;
  const x=32+progress*348,y=Number(points[segment].getAttribute('cy'))*(1-part)+Number(points[segment+1].getAttribute('cy'))*part;
  const run=chart.querySelector('.chart-run'),tour=chart.querySelector('.chart-tour');
  if(!tourPathLength)tourPathLength=run.getTotalLength();
  run.style.strokeDasharray=`${tourPathLength} ${tourPathLength}`;
  run.style.strokeDashoffset=String(tourPathLength*(1-progress));
  run.style.opacity=opacity;
  tour.style.opacity=opacity;
  const guide=tour.querySelector('.chart-tour-guide');guide.setAttribute('x1',x);guide.setAttribute('x2',x);
  tour.querySelectorAll('circle').forEach(dot=>{dot.setAttribute('cx',x);dot.setAttribute('cy',y);});
  const focus=Math.round(progress*6),reading=state.data.trend[focus],label=tour.querySelector('.chart-tour-label');
  label.setAttribute('transform',`translate(${Math.max(79,Math.min(330,x))} ${Math.max(14,y-25)})`);
  label.querySelector('text').textContent=`${reading.day} · ${fmt(focus===6?Math.round(graphDisplayAction):reading.actions)}`;
  chart.querySelectorAll('.axis-label').forEach((axis,i)=>axis.classList.toggle('current',opacity>.1&&i===focus));
  requestAnimationFrame(tourTrend);
}
function patchTrend(){
  const target=state.data.trend.at(-1).actions;if(graphFrame)cancelAnimationFrame(graphFrame);
  if(graphDisplayAction===target)return;
  if(reduceMotion.matches){graphDisplayAction=target;drawTrend(target);return;}
  const from=graphDisplayAction,start=performance.now();function frame(now){const t=Math.min(1,(now-start)/1200);graphDisplayAction=tweenValue(from,target,t);drawTrend(graphDisplayAction,Math.sin(Math.PI*t));if(t<1)graphFrame=requestAnimationFrame(frame);else graphFrame=null;}graphFrame=requestAnimationFrame(frame);
}
function patchScreen(previousRegion){patchCase();patchData();patchMap(previousRegion);patchTrend();}
function updatePause(){screen.classList.toggle('paused',state.paused);screen.querySelector('#playback-control').textContent=state.paused?'▶ 继续':'Ⅱ 暂停';}
function openBrandFilm(){resumeAfterFilm=!state.paused;if(resumeAfterFilm){state=setPaused(state,true);updatePause();}filmDialog.showModal();if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().then(()=>{if(filmDialog.open)exitFilmFullscreen=true;else document.exitFullscreen().catch(()=>{});}).catch(()=>{});film.play().catch(()=>{});}
function advance(){const previousRegion=selectedRegion,keepPaused=state.paused;if(state.completed){state=resetState(baseline);selectedRegion='浙江省';}state=applyNext(setPaused(state,false));const operation=applyOperation(state.data,state.current.id);state.data=operation.data;operationNotice=operation.summary;if(operation.focus)selectedRegion=operation.focus;state=setPaused(state,keepPaused);patchScreen(previousRegion);}
function resetPlayback(){const previousRegion=selectedRegion,paused=state.paused;state=setPaused(applyNext(resetState(baseline)),paused);state.data=applyOperation(state.data,state.current.id).data;operationNotice='数据基线已载入 · 等待服务事件';selectedRegion='浙江省';patchScreen(previousRegion);}
function stepRegion(delta){const previousRegion=selectedRegion,rows=state.data.people.regions,i=rows.findIndex(x=>x.name===selectedRegion);selectedRegion=rows[(i+delta+rows.length)%rows.length].name;patchMap(previousRegion);}
function showDetail(key){const d=state.data;let title='',body='';if(key==='history'){title='累计用户';body=`<p>${esc(d.historical.definition)}。</p>`;}else if(key==='profile'){title='服务人群画像完整分布';body=`<p>年龄分布：${d.people.age.map(x=>`${esc(x.name)} ${fmt(x.value)} 人`).join('；')}。</p><p>性别分布：${d.people.gender.map(x=>`${esc(x.name)} ${fmt(x.value)} 人`).join('；')}。年龄与性别均按同一在管用户基线统计。</p>`;}else if(key==='enroll'){title='AI赋能在管用户';body=`<p>${esc(d.definitions.users)}。年龄、性别、地区与主服务路径分别合计 ${fmt(d.totals.users)} 人。本轮新增来自预置服务批次，中央个案不单独计数。</p>`;}else if(key==='plan'){title='累计生成方案版本';body=`<p>${esc(d.definitions.planVersions)}。方案版本按业务台账口径统计；预置批次在草案生成时新增版本，专业确认只转移状态；中央个案不单独计数。</p>`;}else if(key==='action'){title='累计行动记录';body=`<p>${esc(d.definitions.actionRecords)}。六维行动记录合计 ${fmt(d.totals.actionRecords)} 条；预置批次行动按六维同步增加；中央个案不单独计数。</p>`;}else if(key==='feedback'){title='累计阶段反馈';body=`<p>${esc(d.definitions.stageFeedback)}。预置批次反馈同步增加；中央个案不单独计数，也不自动生成新方案。</p>`;}else if(key==='case'){title='中央案例素材依据';body='<p>中央案例以提供的 369 方案为内容依据，参考管理后台和小程序的界面结构重绘。关系边界、身心安定、运动、睡眠、营养等调理方向来自方案；打卡、点评、阶段复盘与 V2 为流程化重现，不充当同一客户的原始日志、真实聊天或专家签批记录。不同后台截图中的客户资料未被拼接，周边运营批次另行计数。</p>';}else if(key.startsWith('program:')){const x=d.people.primaryServices[Number(key.split(':')[1])];title=x.name;body=`<p>在管 ${fmt(x.value)} 人，作为同一去重人群的主服务路径；同一人仅归属一类。方案交付材料与人数统计属于不同来源。</p>`;}document.querySelector('#detail-title').textContent=title;document.querySelector('#detail-content').innerHTML=body;dialog.showModal();}
function bind(){screen.querySelectorAll('[data-detail]').forEach(el=>el.onclick=()=>showDetail(el.dataset.detail));screen.querySelectorAll('[data-region]').forEach(el=>el.onclick=()=>{const previous=selectedRegion;selectedRegion=el.dataset.region;patchMap(previous);});screen.querySelector('#prev-region').onclick=()=>stepRegion(-1);screen.querySelector('#next-region').onclick=()=>stepRegion(1);screen.querySelector('#open-brand-film').onclick=openBrandFilm;screen.querySelector('#playback-control').onclick=()=>{state=setPaused(state,!state.paused);updatePause();};screen.querySelector('#next-event').onclick=()=>advance();screen.querySelector('#reset-events').onclick=()=>resetPlayback();screen.querySelector('#fullscreen').onclick=async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();};}
dialog.querySelector('.close-detail').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close();};
filmDialog.querySelector('#close-brand-film').onclick=()=>filmDialog.close();
filmDialog.onclick=e=>{if(e.target===filmDialog)filmDialog.close();};
filmDialog.addEventListener('close',()=>{if(exitFilmFullscreen&&document.fullscreenElement===document.documentElement)document.exitFullscreen().catch(()=>{});exitFilmFullscreen=false;film.pause();if(film.readyState)film.currentTime=0;if(resumeAfterFilm){state=setPaused(state,false);updatePause();}resumeAfterFilm=false;});
document.addEventListener('keydown',e=>{if(dialog.open||filmDialog.open||e.target.closest('button,[role="button"]'))return;if(e.code==='Space'){e.preventDefault();state=setPaused(state,!state.paused);updatePause();}if(e.key==='ArrowRight')advance();if(e.key==='ArrowLeft')stepRegion(-1);});

try{[baseline,geometry]=await Promise.all([readDashboard(),readProvinceGeometry()]);chartMin=Math.min(...baseline.trend.map(x=>x.actions))-600;chartMax=Math.max(...baseline.trend.map(x=>x.actions))+850;state=applyNext(createState(baseline));state.data=applyOperation(state.data,state.current.id).data;operationNotice='数据基线已载入 · 等待服务事件';graphDisplayAction=state.data.trend.at(-1).actions;render();if(!reduceMotion.matches)requestAnimationFrame(tourTrend);setInterval(()=>{if(state.paused)return;advance();},4700);window.qingheScreen={getState:()=>structuredClone(state),reset:resetPlayback};}catch(error){screen.innerHTML=`<div class="loading">数据载入失败：${esc(error.message)}</div>`;console.error(error);}
