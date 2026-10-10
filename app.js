import {readDashboard, readProvinceGeometry} from './data-adapter.js';
import {applyDemoEvent, caseStageIndex} from './demo-playback.js';

const screen = document.querySelector('#screen');
const dialog = document.querySelector('#detail-dialog');
const detailTitle = document.querySelector('#detail-title');
const detailContent = document.querySelector('#detail-content');
let data;
let baseline;
let geometry;
let selectedRegion = '浙江省';
let currentEvent = null;
let elapsed = 0;
let eventCursor = 0;
let caseStage = 0;
let paused = false;
let lastTick = 0;
const fmt = n => new Intl.NumberFormat('zh-CN').format(n);
const clockTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr = esc;

function scale() {
  const ratio = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  screen.style.transform = `translate(-50%, -50%) scale(${ratio})`;
}
window.addEventListener('resize', scale);
scale();

function assertData(d, map) {
  const total = d.cohort.total;
  if (d.programs.reduce((n, item) => n + item.activeUsers, 0) !== total) throw new Error('主服务人数与在管队列不一致');
  for (const key of ['age','gender','regions']) {
    const sum = d.cohort[key].reduce((n, item) => n + item.value, 0);
    if (sum !== total) throw new Error(`${key} 分布合计 ${sum}，与队列 ${total} 不一致`);
  }
  const names = map.features.filter(f => f.properties.name).map(f => f.properties.name);
  if (new Set(d.cohort.regions.map(x => x.name)).size !== names.length || names.some(name => !d.cohort.regions.some(x => x.name === name && Number.isInteger(x.value) && x.value > 0))) throw new Error('省级区域数据未完整配置');
  if (d.cohort.needs.some(x => x.value > total) || d.cohort.lifestyle.some(x => x.value > total)) throw new Error('健康标签人数超过在管队列');
  if (d.cohort.needs.find(x => x.id === 'women').value > d.cohort.gender.find(x => x.label === '女性').value) throw new Error('女性健康人数超过女性人数');
  if (d.services.some(s => !d.cohort.needs.some(n => n.id === s.needId))) throw new Error('服务场景缺少对应需求标签');
  if (d.operations.trend.reduce((n, item) => n + item.actions, 0) !== d.operations.actionRecords) throw new Error('行动趋势与记录总数不一致');
  if (d.operations.pendingReview > d.operations.aiDrafts) throw new Error('待审核数超过草案数');
}

function prepareData(d) {
  const managed = d.metrics.find(m => m.id === 'managed');
  managed.value = d.cohort.total;
  managed.display = fmt(managed.value);
  const drafts = d.metrics.find(m => m.id === 'aiDrafts');
  drafts.value = d.operations.aiDrafts;
  drafts.display = fmt(drafts.value);
}

const lifestylePercent = count => Math.round(count / data.cohort.total * 100);

function renderMetrics() {
  return `<section class="metrics" aria-label="核心指标">${data.metrics.map((metric, i) => `
    <button class="metric" type="button" data-detail="metric:${attr(metric.id)}" aria-label="查看${attr(metric.label)}口径">
      <span class="metric-label">${esc(metric.label)}</span>
      <strong class="metric-value" id="metric-${attr(metric.id)}">${esc(metric.display)}<span class="metric-unit">${esc(metric.unit)}</span></strong>
      <span class="metric-index">${metric.status === '样机数值' ? '运营演示数据' : `0${i + 1} / DATA`}</span>
    </button>`).join('')}</section>`;
}

function renderProfile() {
  const {cohort} = data;
  const ageMax = Math.max(...cohort.age.map(x => x.value));
  const female = cohort.gender.find(x => x.label === '女性').value;
  const male = cohort.gender.find(x => x.label === '男性').value;
  return `<div class="left-column">
    <section class="panel">
      <div class="panel-head"><h2>服务人群画像</h2><span>模拟运营队列</span></div>
      <p class="panel-note">${fmt(cohort.total)} 位健康管理用户 · 人口特征分布</p>
      <div class="profile-grid">
        <div><div class="small-title">年龄结构</div>${cohort.age.map(row => `<div class="age-row" role="button" tabindex="0" data-detail="age:${attr(row.label)}"><span>${esc(row.label)}</span><span class="track"><span class="fill" style="display:block;width:${row.value / ageMax * 100}%"></span></span><strong>${fmt(row.value)}</strong></div>`).join('')}</div>
        <div class="gender-wrap" role="button" tabindex="0" data-detail="gender"><div class="small-title">性别分布</div><div class="donut" style="--female:${female / cohort.total * 100}%"><div class="donut-inner"><span><strong>${Math.round(female / cohort.total * 100)}%</strong><br>女性</span></div></div><div class="gender-legend"><span><i class="female-dot"></i>女 <b>${fmt(female)}</b></span><span><i class="male-dot"></i>男 <b>${fmt(male)}</b></span></div></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>区域与健康需求</h2><button class="mini-link" type="button" data-detail="tags">标签分层 ↗</button></div>
      <div class="region-list">${cohort.regions.slice(0, 6).map(row => `<button class="region-row ${selectedRegion === row.name ? 'active' : ''}" type="button" data-region="${attr(row.name)}"><span>${esc(row.short)}</span><span class="track"><span class="fill" style="display:block;width:${row.value / cohort.regions[0].value * 100}%"></span></span><strong>${fmt(row.value)}</strong></button>`).join('')}</div>
      <button class="region-all" type="button" data-detail="map">查看全部 34 个省级区域 ↗</button>
      <div class="need-chips">${cohort.needs.map(row => `<button type="button" data-detail="need:${attr(row.label)}">${esc(row.label.replace('健康管理','').replace('支持',''))} <strong>${fmt(row.value)}</strong></button>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>生活方式调理重点</h2><span>可多选</span></div>
      <div class="lifestyle-grid">${cohort.lifestyle.map(row => `<div class="lifestyle-row" role="button" tabindex="0" data-detail="lifestyle:${attr(row.label)}"><span>${esc(row.label)}</span><span class="track"><span class="fill" style="display:block;width:${lifestylePercent(row.value)}%"></span></span><strong>${lifestylePercent(row.value)}%</strong></div>`).join('')}</div>
      <div class="lifestyle-note">${esc(cohort.lifestyleDefinition)}</div>
    </section>
  </div>`;
}

const project = (lon, lat) => [32 + (lon - 73) * 12.25, 40 + (54 - lat) * 11.6];
const projectInset = (lon, lat) => [688 + (lon - 105) * 6.3, 318 + (23 - lat) * 9.2];
function polygonPath(coordinates, inset = false) {
  const fn = inset ? projectInset : project;
  return coordinates.map(polygon => polygon.map(ring => ring.map(([lon,lat], i) => {
    const [x,y] = fn(lon, lat);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z').join(' ')).join(' ');
}
function renderMapSvg() {
  const cohortRegions = new Map(data.cohort.regions.map(x => [x.name, x]));
  const provinces = geometry.features.filter(f => f.properties.name).map(f => {
    const name = f.properties.name;
    const parts = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    const value = cohortRegions.get(name).value;
    const tier = value >= 100 ? 'tier-high' : value >= 40 ? 'tier-mid' : 'tier-low';
    return `<path class="province ${tier} ${name === selectedRegion ? 'active' : ''}" data-region="${attr(name)}" d="${polygonPath(parts)}" fill-rule="evenodd" tabindex="0" role="button" aria-label="查看${attr(name)}服务情况"><title>${esc(name)} ${fmt(value)}人</title></path>`;
  }).join('');
  const islands = geometry.features.find(f => !f.properties.name);
  const islandPath = islands ? `<path class="islands" d="${polygonPath(islands.geometry.coordinates, true)}" fill-rule="evenodd"/>` : '';
  const markers = data.cohort.regions.filter((r,i) => i < 6 || r.name === selectedRegion || r.name === currentEvent?.region).map(r => {
    const feature = geometry.features.find(f => f.properties.name === r.name);
    const [x,y] = project(...(feature.properties.centroid || feature.properties.center));
    return `<circle class="map-pulse ${r.name === currentEvent?.region ? 'event-pulse' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.name === selectedRegion ? 5 : 3.4}" data-region="${attr(r.name)}"><title>${esc(r.name)} ${fmt(r.value)}人</title></circle>`;
  }).join('');
  const zhejiang = project(120.0, 29.1);
  return `<svg id="china-map" viewBox="0 0 860 540" role="img" aria-label="全国省级地图，当前选中${attr(selectedRegion)}">
    <defs><radialGradient id="mapGlow"><stop stop-color="#3f9f75" stop-opacity=".28"/><stop offset="1" stop-color="#3f9f75" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="455" cy="260" rx="300" ry="210" fill="url(#mapGlow)"/>
    ${provinces}
    <rect x="674" y="323" width="159" height="205" rx="7" fill="#0c302a88" stroke="#6da78e88" stroke-width="1"/>
    ${islandPath}
    <text class="map-muted-label" x="690" y="344">南海诸岛</text>
    ${markers}
    <text class="map-label" x="${(zhejiang[0]+11).toFixed(1)}" y="${(zhejiang[1]+1).toFixed(1)}">浙江</text>
  </svg>`;
}

function regionInfo() {
  const region = data.cohort.regions.find(r => r.name === selectedRegion);
  return {name:region.name, value:fmt(region.value), note:'当前队列人数 · 样机配置与模拟事件'};
}
function renderMapInfo() {
  const item = regionInfo();
  return `<div class="map-info"><div class="map-info-label">当前查看 · 模拟队列</div><div class="map-info-name">${esc(item.name)}</div><div class="map-info-value">${item.value}<small>人</small></div><div class="map-info-note">${esc(item.note)}</div></div>`;
}
function renderMiniMap() {
  return `<section class="mini-map-panel" aria-label="演示队列地域分布">
    <div class="mini-map-head"><h2>演示队列地域分布</h2><button type="button" data-detail="map">查看口径 ↗</button></div>
    <div class="mini-map-visual"><div id="map-svg-host">${renderMapSvg()}</div></div>
    <div id="map-info-host">${renderMapInfo()}</div>
    <div class="mini-map-caption">区域人数来自同一模拟在管队列<br>模拟新入管时，该区域人数同步增加</div>
    <div class="demo-event" id="demo-event">模拟运营事件 · 等待下一条记录</div>
  </section>`;
}

function renderCaseFrame() {
  const stage = data.caseStudy.stages[caseStage];
  return `<div class="case-frame">
    <div class="case-kicker">${esc(stage.kicker)}<span>${esc(stage.label)}</span></div>
    <h3>${esc(stage.headline)}</h3>
    <div class="case-points">${stage.points.map((point, i) => `<div class="case-point"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(point)}</span></div>`).join('')}</div>
    <div class="case-boundary">${esc(data.caseStudy.processNote)}</div>
  </div>`;
}

function renderCase() {
  return `<section class="case-panel" aria-label="369真实脱敏方案案例演示">
    <div class="case-head"><div><div class="case-eyebrow">REAL PLAN × AI ASSISTED WORKFLOW</div><h2>一个方案怎样形成</h2></div><button type="button" data-detail="case">真实脱敏资料节选 ↗</button></div>
    <div class="case-rail" style="--stage-progress:${caseStage / (data.caseStudy.stages.length - 1) * 86}%">${data.caseStudy.stages.map((stage, i) => `<div class="case-rail-step ${i === caseStage ? 'active' : i < caseStage ? 'done' : ''}"><i></i><span>${esc(stage.kicker.split('/')[1].trim())}</span></div>`).join('')}</div>
    <div id="case-frame-host">${renderCaseFrame()}</div>
    <div class="case-bottom"><span>369 健康管理方案 · 首月四周 · 50秒循环</span><span id="case-time">00:00 / ${clockTime(data.caseStudy.exhibitPlayback.cycleSeconds)}</span></div>
    <div class="case-progress"><span id="case-progress-fill"></span></div>
  </section>`;
}

function renderAudit() {
  return `<section class="panel audit-panel ${caseStage === 4 ? 'audit-focus' : ''}" aria-label="专业审核示意">
    <div class="panel-head"><h2>专业审核示意</h2><span>发布前核对</span></div>
    <div class="audit-intro">专业判断把住个体适配与安全边界</div>
    <div class="audit-list">${data.caseStudy.auditChecks.map((item, i) => `<div class="audit-item"><b>${String(i + 1).padStart(2, '0')}</b><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></div>`).join('')}</div>
    <div class="audit-foot">依据真实方案风险边界整理<br>非原始专家签批记录</div>
  </section>`;
}

function renderRight() {
  return `<div class="right-column">
    <section class="panel resource-panel"><div class="panel-head"><h2>专业知识与合作资源</h2><span>公司资料口径</span></div>
      <div class="resource-highlight"><button type="button" data-detail="resource:0"><strong>140+</strong><span>减脂代谢健康IP</span></button><button type="button" data-detail="metric:experts"><strong>近200</strong><span>合作医疗专家</span></button></div>
      <div class="resource-band">6—8 个专科合作方向</div>
      <div class="knowledge-inline"><span>临床医学</span><span>生活方式</span><span>个案经验</span></div>
    </section>
    <div id="audit-host">${renderAudit()}</div>
  </div>`;
}

function trendSvg() {
  const items = data.operations.trend;
  const x = i => 32 + i * 58;
  const actionMax = Math.max(...items.map(x => x.actions)) * 1.15;
  const draftMax = Math.max(...items.map(x => x.drafts)) * 1.15;
  const y = value => 117 - value / actionMax * 100;
  const yd = value => 117 - value / draftMax * 100;
  const line = (key,fn) => items.map((item,i) => `${i ? 'L' : 'M'}${x(i)} ${fn(item[key]).toFixed(1)}`).join(' ');
  const actionLine = line('actions',y);
  return `<svg class="trend-chart" viewBox="0 0 405 145" aria-label="七日行动记录与方案草案趋势" role="img">
    <defs><linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#95deb0" stop-opacity=".34"/><stop offset="1" stop-color="#95deb0" stop-opacity="0"/></linearGradient></defs>
    <path class="chart-grid" d="M31 24H395 M31 70H395 M31 117H395"/>
    <path class="chart-area" d="${actionLine} L380 117 L32 117 Z"/>
    <path class="chart-line" d="${actionLine}"/>
    <path class="chart-line-alt" d="${line('drafts',yd)}"/>
    ${items.map((item,i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(item.actions).toFixed(1)}" r="3.7"><title>${item.day} 行动${item.actions}条</title></circle><text class="axis-label" x="${x(i)-15}" y="139">${esc(item.day)}</text>`).join('')}
  </svg>`;
}
function renderBottom() {
  return `<div class="bottom">
    <section class="service-panel"><div class="bottom-head"><h2>两类实际服务交付</h2><span>服务方案真实 · 人数为模拟队列</span></div><div class="program-grid">${data.programs.map((program, i) => `<button class="program-card" type="button" data-detail="program:${i}"><span class="program-index">0${i + 1} / SERVICE</span><strong>${esc(program.name)}</strong><span class="program-cycle">${esc(program.cycle)}</span><span class="program-count" id="program-count-${i}">模拟在管 ${fmt(program.activeUsers)} 人 ↗</span></button>`).join('')}</div></section>
    <section class="trend-panel"><div class="bottom-head"><h2>模拟运营事件与趋势</h2><span>近七日 · 点击查看口径</span></div><div class="trend-body" data-detail="trend" role="button" tabindex="0"><div id="trend-svg-host">${trendSvg()}</div><div class="trend-side"><div><i class="trend-key"></i>行动记录<strong id="action-count">${fmt(data.operations.actionRecords)}</strong></div><div><i class="trend-key alt"></i>当日新增草案<strong id="draft-trend">${fmt(data.operations.trend.at(-1).drafts)}</strong></div><div>待专家审核 <strong id="pending-count">${fmt(data.operations.pendingReview)}</strong></div><div>阶段反馈 <strong id="feedback-count">${fmt(data.operations.feedbackRecords)}</strong></div></div></div></section>
  </div>`;
}

function render() {
  screen.innerHTML = `
    <header class="topbar"><div class="brand"><img src="assets/brand-icon.jpg" alt="AI青荷康康图标"><div><div class="brand-name">AI青荷康康</div><div class="brand-sub">温柔陪伴 · 健康管理</div></div></div>
      <div class="title-wrap"><h1>${esc(data.brand.company)} · ${esc(data.brand.headline)}</h1><p>${esc(data.brand.subline)}</p></div>
      <div class="top-actions"><span class="clock" id="clock"></span><button class="playback-control" id="playback-control" type="button">Ⅱ 暂停演示</button><a class="video-link" href="film/" target="_blank" rel="noopener">▶ 观看品牌影片</a></div>
    </header>
    ${renderMetrics()}
    <div class="middle">${renderProfile()}<div class="center-panel">${renderCase()}${renderMiniMap()}</div>${renderRight()}</div>
    ${renderBottom()}
    <footer class="footer"><span><strong>康徕科技</strong>　生活方式医学 × 专家服务 × AI辅助方案</span><span class="footer-right"><span>${esc(data.reporting.publicDisplayNote)}</span><button type="button" data-detail="sources">口径与来源</button></span></footer>
    <div class="replay-overlay" id="replay-overlay">演示回放 · 从样机基线重新开始</div>`;
  updateClock();
}

function updateClock() {
  const now = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  const node = document.querySelector('#clock');
  if (node) node.textContent = now;
}

function selectRegion(name) {
  selectedRegion = name;
  document.querySelector('#map-svg-host').innerHTML = renderMapSvg();
  document.querySelector('#map-info-host').innerHTML = renderMapInfo();
  document.querySelectorAll('.region-row').forEach(button => button.classList.toggle('active', button.dataset.region === name));
}

function pulse(selector) {
  const node = document.querySelector(selector);
  node.classList.remove('data-flash');
  void node.offsetWidth;
  node.classList.add('data-flash');
  setTimeout(() => node.classList.remove('data-flash'), 1300);
}

function updateNumbers(event) {
  prepareData(data);
  document.querySelector('#action-count').textContent = fmt(data.operations.actionRecords);
  document.querySelector('#draft-trend').textContent = fmt(data.operations.trend.at(-1).drafts);
  document.querySelector('#pending-count').textContent = fmt(data.operations.pendingReview);
  document.querySelector('#feedback-count').textContent = fmt(data.operations.feedbackRecords);
  document.querySelector('#trend-svg-host').innerHTML = trendSvg();
  document.querySelector('#metric-aiDrafts').innerHTML = `${fmt(data.operations.aiDrafts)}<span class="metric-unit">份</span>`;
  document.querySelector('#demo-event').textContent = `模拟运营事件 · ${currentEvent.region.replace(/省|市$/, '')}：${currentEvent.summary}`;
  if (event.type === 'enrollment') {
    document.querySelector('#metric-managed').innerHTML = `${fmt(data.cohort.total)}<span class="metric-unit">人</span>`;
    document.querySelector('.left-column').outerHTML = renderProfile();
    data.programs.forEach((program, i) => {
      document.querySelector(`#program-count-${i}`).textContent = `模拟在管 ${fmt(program.activeUsers)} 人 ↗`;
    });
    pulse('[data-detail="metric:managed"]');
    pulse(`[data-detail="program:${data.programs.findIndex(row => row.name === event.service)}"]`);
    document.querySelectorAll('.left-column .panel').forEach(node => node.classList.add('data-flash'));
  } else if (event.type === 'draft-submitted') {
    pulse('[data-detail="metric:aiDrafts"]');
    pulse('.trend-panel');
  } else {
    pulse('.trend-panel');
  }
  pulse('#demo-event');
}

function updateCase() {
  document.querySelector('#case-frame-host').innerHTML = renderCaseFrame();
  document.querySelector('.case-rail').style.setProperty('--stage-progress', `${caseStage / (data.caseStudy.stages.length - 1) * 86}%`);
  document.querySelectorAll('.case-rail-step').forEach((item, index) => {
    item.classList.toggle('active', index === caseStage);
    item.classList.toggle('done', index < caseStage);
  });
  document.querySelector('#audit-host').innerHTML = renderAudit();
}

function updateProgress() {
  const cycleSeconds = data.caseStudy.exhibitPlayback.cycleSeconds;
  const caseElapsed = elapsed % cycleSeconds;
  document.querySelector('#case-time').textContent = `${clockTime(caseElapsed)} / ${clockTime(cycleSeconds)}`;
  document.querySelector('#case-progress-fill').style.width = `${caseElapsed / cycleSeconds * 100}%`;
}

function setPaused(value) {
  paused = value;
  lastTick = performance.now();
  const control = document.querySelector('#playback-control');
  if (control) control.textContent = paused ? '▶ 继续演示' : 'Ⅱ 暂停演示';
}

function restartCycle() {
  data = structuredClone(baseline);
  prepareData(data);
  selectedRegion = '浙江省';
  currentEvent = null;
  eventCursor = 0;
  caseStage = 0;
  elapsed = 0;
  render();
  const overlay = document.querySelector('#replay-overlay');
  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 1300);
}

function tick() {
  const now = performance.now();
  const delta = Math.min((now - lastTick) / 1000, 1);
  lastTick = now;
  if (paused) return;
  elapsed += delta;
  if (elapsed >= data.reporting.cycleSeconds) { restartCycle(); return; }
  while (eventCursor < data.demoEvents.length && elapsed >= data.demoEvents[eventCursor].at) {
    currentEvent = data.demoEvents[eventCursor++];
    applyDemoEvent(data, currentEvent);
    selectedRegion = currentEvent.region;
    selectRegion(selectedRegion);
    updateNumbers(currentEvent);
  }
  const playback = data.caseStudy.exhibitPlayback;
  const nextStage = caseStageIndex(data.caseStudy.stages, elapsed % playback.cycleSeconds, playback.stageStarts);
  if (nextStage !== caseStage) { caseStage = nextStage; updateCase(); }
  updateProgress();
}

function rows(items) { return items.map(([label,value]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join(''); }
function showDetail(key) {
  const [type,id] = key.split(':');
  let title = '';
  let content = '';
  const cohort = data.cohort;
  if (type === 'metric') {
    const m = data.metrics.find(item => item.id === id);
    title = m.label;
    const unverified = m.status === '样机数值';
    const display = m.id === 'aiDrafts' ? fmt(data.operations.aiDrafts) : m.id === 'managed' ? fmt(cohort.total) : m.display;
    const programRows = m.id === 'managed' ? rows(data.programs.map(x => [x.name,fmt(x.activeUsers)+' 人'])) : '';
    content = `<p>${esc(m.definition)}</p>${programRows}${rows([['展示值',display + ' ' + m.unit],['统计期',unverified ? '本轮演示当前值' : m.period],['来源',unverified ? '配置数据与模拟事件；待真实业务凭据核对' : m.source],['核对状态',unverified ? '待核对' : m.status]])}`;
  } else if (type === 'age') {
    const item = cohort.age.find(x => x.label === id); title = id + ' · 年龄结构';
    content = rows([['该年龄段',fmt(item.value)+' 人'],['队列占比',(item.value / cohort.total * 100).toFixed(1)+'%'],['分母',fmt(cohort.total)+' 位健康管理用户']]);
  } else if (type === 'gender') {
    title = '性别分布'; content = rows(cohort.gender.map(x => [x.label,fmt(x.value)+' 人 · '+(x.value/cohort.total*100).toFixed(1)+'%']));
  } else if (type === 'need') {
    const item = cohort.needs.find(x => x.label === id); title = item.label;
    content = rows([['当前关注人数',fmt(item.value)+' 人'],['同一队列',fmt(cohort.total)+' 人']]) + '<p>健康需求可多选，人数不可直接相加。</p>';
  } else if (type === 'tags') {
    title = '用户标签分层';
    content = rows([['人群特征','年龄、性别、区域等'],['健康需求','体重、血糖、血脂、女性健康等'],['六项服务重点','饮食、运动、睡眠、情绪、关系、避害'],['执行条件','时间、能力、环境与日常阻碍'],['服务阶段','建档、方案、执行、复访']]) + '<p class="detail-foot">页面仅展示匿名配置和汇总数据，不包含客户身份映射。</p>';
  } else if (type === 'lifestyle') {
    const item = cohort.lifestyle.find(x => x.label === id); title = id + ' · 调理重点';
    content = rows([['关注人数',fmt(item.value)+' 人'],['当前占比',lifestylePercent(item.value)+'%'],['队列分母',fmt(cohort.total)+' 人']]) + `<p>${esc(cohort.lifestyleDefinition)}</p>`;
  } else if (type === 'resource') {
    const item = data.ecosystem.resources[Number(id)]; title = item.label;
    content = rows([['规模口径',item.value],['说明',item.note]]) + `<p>${esc(data.ecosystem.clinical)}</p><p class="detail-foot">${esc(data.ecosystem.source)}</p>`;
  } else if (type === 'program') {
    const item = data.programs[Number(id)]; title = item.name;
    content = rows([['服务周期',item.cycle],['模拟在管队列',fmt(item.activeUsers)+' 人']]) + '<p class="detail-foot">两类服务均有真实脱敏交付方案；人数来自样机配置，不代表真实在管业绩。</p>';
  } else if (type === 'case') {
    title = '369 首月方案 · 案例来源';
    content = rows([['资料性质','用户提供的真实脱敏方案节选'],['展示范围','健康资料、行动优先级、首月四周安排与风险边界'],['流程性质','依据方案内容复原；非原始模型日志'],['审核性质','审核项示意；非原始专家签批记录']]) + '<p class="detail-foot">当前为内部效果预览，原方案页公开展示授权待核对。案例播放不计入模拟运营人数或事件。</p>';
  } else if (type === 'trend') {
    title = '近七日服务行动';
    content = rows(data.operations.trend.map(x => [x.day,`行动 ${fmt(x.actions)} 条 · 草案 ${fmt(x.drafts)} 份`])) + `<p class="detail-foot">行动记录合计 ${fmt(data.operations.actionRecords)} 条。方案草案趋势是当日新增，不代表已通过专家审核。</p>`;
  } else if (type === 'map') {
    title = '演示队列地域分布';
    content = rows(cohort.regions.map(x => [x.name,fmt(x.value)+' 人'])) + `<p class="detail-foot">34 个省级区域合计 ${fmt(cohort.total)} 人；当前均为本地样机配置。模拟新入管事件会增加对应地区人数，其余事件仅标出发生地。</p>`;
  } else if (type === 'sources') {
    title = '口径与来源';
    content = '<p>健康IP与合作专家数字来自公司提供资料，合作关系与最终口径待业务核对。健康管理用户、AI草案及事件趋势来自本地样机配置，不能作为已核验业绩。</p>' + rows([['真实服务资料','369 与 TLC 21天脱敏交付方案'],['案例演示','369 首月方案内容节选；AI处理和审核节点为流程复原'],['地图底图','当前仅供本地效果预览，正式展出前核验标准地图与审图号']]);
  }
  if (!title) return;
  detailTitle.textContent = title;
  detailContent.innerHTML = content;
  dialog.showModal();
}

screen.addEventListener('click', event => {
  if (event.target.closest('#playback-control')) { setPaused(!paused); return; }
  setPaused(true);
  const region = event.target.closest('[data-region]');
  if (region) { selectRegion(region.dataset.region); return; }
  const detail = event.target.closest('[data-detail]');
  if (detail) showDetail(detail.dataset.detail);
});
screen.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest('[data-detail],[data-region]');
  if (!target || target.tagName === 'BUTTON') return;
  event.preventDefault();
  setPaused(true);
  if (target.dataset.region) selectRegion(target.dataset.region);
  else showDetail(target.dataset.detail);
});
document.querySelector('.close-detail').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

try {
  [data,geometry] = await Promise.all([readDashboard(),readProvinceGeometry()]);
  assertData(data,geometry);
  baseline = structuredClone(data);
  prepareData(data);
  render();
  setInterval(updateClock,30_000);
  lastTick = performance.now();
  setInterval(tick,200);
} catch (error) {
  screen.innerHTML = `<div class="loading">数据加载失败：${esc(error.message)}</div>`;
  console.error(error);
}
