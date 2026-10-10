import {readDashboard, readProvinceGeometry} from './data-adapter.js';
import {applyDemoEvent, caseStageIndex} from './demo-playback.js';

const screen = document.querySelector('#screen');
const dialog = document.querySelector('#source-dialog');
const fmt = n => new Intl.NumberFormat('zh-CN').format(n);
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const lifestyle = ['饮食','运动','睡眠','情绪','关系','避害'];
const flow = ['健康资料','AI 辅助整理','专业把关','个性化行动','反馈复评'];
const flowByStage = [0,0,1,1,2,3,4];
const coreCopy = ['理解一个人','汇集真实资料','分清已知与待核对','找到本月重点','守住专业边界','交付可执行行动','让反馈进入下一轮'];
let data;
let baseline;
let geometry;
let elapsed = 0;
let eventCursor = 0;
let stageIndex = 0;
let currentEvent = null;
let paused = false;
let lastTick = 0;

function scale() {
  const ratio = Math.min(innerWidth / 1920, innerHeight / 1080);
  screen.style.transform = `translate(-50%, -50%) scale(${ratio})`;
}
addEventListener('resize', scale);
scale();

function assertData(d, map) {
  if (d.programs.reduce((total, row) => total + row.activeUsers, 0) !== d.cohort.total) throw new Error('服务人数与在管队列不一致');
  for (const key of ['age','gender','regions']) {
    if (d.cohort[key].reduce((total, row) => total + row.value, 0) !== d.cohort.total) throw new Error(`${key} 人数与在管队列不一致`);
  }
  if (new Set(map.features.filter(row => row.properties.name).map(row => row.properties.name)).size !== d.cohort.regions.length) throw new Error('地图与省级人数不一致');
  if (d.demoEvents.some((event, i) => i && event.at <= d.demoEvents[i - 1].at)) throw new Error('演示事件时间顺序错误');
}

const project = (lon, lat) => [32 + (lon - 73) * 12.25, 40 + (54 - lat) * 11.6];
const projectInset = (lon, lat) => [688 + (lon - 105) * 6.3, 318 + (23 - lat) * 9.2];
function pathOf(coordinates, inset = false) {
  const fn = inset ? projectInset : project;
  return coordinates.map(polygon => polygon.map(ring => ring.map(([lon,lat], index) => {
    const [x,y] = fn(lon,lat);
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z').join(' ')).join(' ');
}

function mapSvg() {
  const active = currentEvent?.region || '浙江省';
  const provinces = geometry.features.filter(row => row.properties.name).map(row => {
    const parts = row.geometry.type === 'MultiPolygon' ? row.geometry.coordinates : [row.geometry.coordinates];
    return `<path class="map-province ${row.properties.name === active ? 'active' : ''}" d="${pathOf(parts)}" fill-rule="evenodd"/>`;
  }).join('');
  const islands = geometry.features.find(row => !row.properties.name);
  const inset = islands ? `<path class="map-islands" d="${pathOf(islands.geometry.coordinates, true)}" fill-rule="evenodd"/>` : '';
  const feature = geometry.features.find(row => row.properties.name === active);
  const [x,y] = project(...(feature.properties.centroid || feature.properties.center));
  return `<svg viewBox="0 0 860 540" role="img" aria-label="模拟事件地区：${esc(active)}"><g>${provinces}${inset}</g><circle class="map-marker" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8"/><circle class="map-marker-center" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/></svg>`;
}

function caseContent() {
  const stage = data.caseStudy.stages[stageIndex];
  return `<div class="case-step-count">${String(stageIndex + 1).padStart(2,'0')} <span>/ 07</span><small>${esc(stage.label)}</small></div>
    <div class="case-stage"><div class="case-stage-kicker">${esc(stage.kicker)}</div><h3>${esc(stage.headline)}</h3><div class="case-lines">${stage.points.map((point, index) => `<div class="case-line"><b>${String(index + 1).padStart(2,'0')}</b><span>${esc(point)}</span></div>`).join('')}</div></div>`;
}

function render() {
  const program0 = data.programs[0];
  const program1 = data.programs[1];
  screen.innerHTML = `<div class="screen-noise"></div>
    <header class="header">
      <div class="brand"><img src="assets/brand-icon.jpg" alt="AI青荷康康图标"><div><strong>AI青荷康康</strong><span>KANGLAI · HEALTH INTELLIGENCE</span></div></div>
      <div class="headline"><div class="eyebrow"><i></i> LIFE SCIENCE × ARTIFICIAL INTELLIGENCE <i></i></div><h1>把健康资料，变成真正可执行的行动<span>。</span></h1></div>
      <div class="header-right"><div class="live-status"><i></i> EXHIBITION / 演示运行中</div><div class="header-controls"><span id="clock"></span><button id="playback" type="button">Ⅱ 暂停</button></div></div>
    </header>
    <div class="main-layout">
      <section class="case-side" aria-label="真实脱敏案例">
        <div class="section-label"><span>01 / REAL CASE</span><em>一位用户 · 一份方案</em></div>
        <h2>从一个人，<br>走向一个方案<span> /</span></h2>
        <p class="case-lead">真实脱敏 369 首月方案，呈现资料如何经过整理、专业核对，形成可执行的生活方式安排。</p>
        <div id="case-content">${caseContent()}</div>
        <div class="case-timeline">${data.caseStudy.stages.map((stage,index) => `<span class="case-dot ${index === stageIndex ? 'active' : ''}" title="${esc(stage.kicker)}"></span>`).join('')}</div>
        <button id="source-button" type="button">查看资料与演示边界 <span>↗</span></button>
      </section>
      <section class="engine" aria-label="AI辅助健康服务链路">
        <div class="engine-top"><div><span class="section-label">02 / INTELLIGENCE ENGINE</span><h2>AI 健康行动引擎</h2></div><div class="engine-tag"><i></i> AI 辅助 · 专业把关</div></div>
        <div class="orbital">
          <div class="orbit-halo"></div><div class="orbit-ring orbit-ring-a"></div><div class="orbit-ring orbit-ring-b"></div><div class="orbit-sweep"></div>
          <div class="orbit-axis axis-one"></div><div class="orbit-axis axis-two"></div><div class="orbit-axis axis-three"></div>
          ${lifestyle.map((label,index) => `<div class="orbit-node orbit-node-${index}"><span class="node-index">0${index + 1}</span><strong>${label}</strong><i></i></div>`).join('')}
          <div class="core-disc"><div class="core-disc-inner"><span class="core-topline">PERSONALIZED / 人因识别</span><svg class="heartbeat" viewBox="0 0 340 80" aria-hidden="true"><path d="M0 41 H85 L101 41 L113 26 L126 56 L143 11 L160 68 L176 39 H340"/></svg><span class="core-small">从真实资料出发</span><strong id="core-copy">${esc(coreCopy[stageIndex])}</strong><span class="core-caption">生活方式医学 × AI辅助</span></div></div>
          <div class="orbit-caption orbit-caption-left">DATA / 资料</div><div class="orbit-caption orbit-caption-right">ACTION / 行动</div>
        </div>
        <div class="flow" aria-label="服务流程">${flow.map((label,index) => `<div class="flow-step ${index === flowByStage[stageIndex] ? 'active' : ''}"><b>0${index + 1}</b><span>${label}</span></div>`).join('')}</div>
        <div class="event-ribbon"><span class="event-live"><i></i> LIVE SIMULATION</span><strong id="event-text">模拟运营事件将沿服务链路出现</strong><span id="time-readout">00:00 / 02:00</span></div>
      </section>
      <aside class="right-side">
        <section class="safety" aria-label="专业安全边界"><div class="section-label">03 / HUMAN IN THE LOOP</div><h2>专业判断<br><span>是最后一道关口。</span></h2><div class="safety-list">${data.caseStudy.auditChecks.map((item,index) => `<div class="safety-row" title="${esc(item.detail)}"><b>${String(index + 1).padStart(2,'0')}</b><div><strong>${esc(item.title)}</strong><span>${esc(item.brief)}</span></div></div>`).join('')}</div><div class="safety-foot">审核项示意 · 非原始专家签批记录</div></section>
        <section class="resources" aria-label="专业资源"><div class="section-label">04 / KNOWLEDGE & NETWORK</div><div class="resource-numbers"><div><strong>140<span>+</span></strong><p>减脂代谢健康 IP</p></div><div><strong>近200</strong><p>合作医疗专家</p></div></div><small>公司资料口径 · 合作关系待核</small></section>
        <section class="map-side" aria-label="模拟队列地域分布"><div class="map-head"><div><span class="section-label">05 / SERVICE FOOTPRINT</span><h3>模拟服务分布</h3></div><strong id="map-region">浙江</strong></div><div id="map-host">${mapSvg()}</div><div class="map-foot">亮点随模拟事件移动 · 人数来自同一在管队列</div></section>
      </aside>
    </div>
    <section class="bottom-layout" aria-label="两类服务与模拟运营数据">
      <div class="bottom-intro"><span class="section-label">THE SYSTEM IN MOTION</span><h2>两条服务路径，<br>同一套专业底座<span>。</span></h2><p>资料建档 → 专业核对 → 行动执行 → 反馈复评</p></div>
      <div class="programs"><div class="program" id="program-card-0"><span class="program-code">369 / FOUR WEEKS</span><strong>${esc(program0.name)}</strong><p>${esc(program0.cycle)}</p><div class="program-number">模拟在管 <b id="program-0">${fmt(program0.activeUsers)}</b> 人 <i>↗</i></div></div><div class="program" id="program-card-1"><span class="program-code">TLC / 21 DAYS</span><strong>${esc(program1.name)}</strong><p>${esc(program1.cycle)}</p><div class="program-number">模拟在管 <b id="program-1">${fmt(program1.activeUsers)}</b> 人 <i>↗</i></div></div></div>
      <div class="numbers"><div class="number" id="number-managed"><span>当前模拟在管</span><strong id="managed">${fmt(data.cohort.total)}</strong><small>人 / 同一去重队列</small></div><div class="number" id="number-drafts"><span>AI 辅助草案</span><strong id="drafts">${fmt(data.operations.aiDrafts)}</strong><small>份 / 非已审核方案</small></div><div class="number" id="number-actions"><span>行动记录</span><strong id="actions">${fmt(data.operations.actionRecords)}</strong><small>条 / 模拟趋势</small></div><div class="number" id="number-feedback"><span>阶段反馈</span><strong id="feedback">${fmt(data.operations.feedbackRecords)}</strong><small>条 / 执行回路</small></div></div>
    </section>
    <footer><span>康徕科技　生活方式医学 × 专家服务 × AI辅助方案</span><span>运营数字为逻辑样机 · 案例内容来自真实脱敏方案节选 · 流程与审核分别标注</span><span><a href="film/" target="_blank" rel="noopener">品牌片 ↗</a></span></footer>
    <div class="replay" id="replay">演示回放 <span>/ 从样机基线重新开始</span></div>`;
  updateClock();
  updateTime();
}

function updateClock() {
  const now = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  const node = document.querySelector('#clock');
  if (node) node.textContent = now;
}

function updateTime() {
  const seconds = Math.floor(elapsed);
  document.querySelector('#time-readout').textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')} / 02:00`;
}

function pulse(selector) {
  const node = document.querySelector(selector);
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1400);
}

function updateStage() {
  document.querySelector('#case-content').innerHTML = caseContent();
  document.querySelector('#core-copy').textContent = coreCopy[stageIndex];
  document.querySelectorAll('.case-dot').forEach((node,index) => node.classList.toggle('active',index === stageIndex));
  document.querySelectorAll('.flow-step').forEach((node,index) => node.classList.toggle('active',index === flowByStage[stageIndex]));
  pulse('.core-disc');
}

function updateEvent(event) {
  document.querySelector('#managed').textContent = fmt(data.cohort.total);
  document.querySelector('#drafts').textContent = fmt(data.operations.aiDrafts);
  document.querySelector('#actions').textContent = fmt(data.operations.actionRecords);
  document.querySelector('#feedback').textContent = fmt(data.operations.feedbackRecords);
  data.programs.forEach((program,index) => { document.querySelector(`#program-${index}`).textContent = fmt(program.activeUsers); });
  document.querySelector('#event-text').textContent = `${event.region.replace(/省|市$/, '')} · ${event.summary}`;
  document.querySelector('#map-region').textContent = event.region.replace(/省|市$/, '');
  document.querySelector('#map-host').innerHTML = mapSvg();
  pulse('.event-ribbon');
  pulse('.map-side');
  if (event.type === 'enrollment') {
    pulse('#number-managed');
    pulse(`#program-card-${data.programs.findIndex(program => program.name === event.service)}`);
  } else if (event.type === 'draft-submitted') pulse('#number-drafts');
  else if (event.type === 'action') pulse('#number-actions');
  else pulse('#number-feedback');
}

function setPaused(value) {
  paused = value;
  lastTick = performance.now();
  document.querySelector('#playback').textContent = paused ? '▶ 继续' : 'Ⅱ 暂停';
  document.querySelector('.live-status').classList.toggle('is-paused',paused);
  document.querySelector('.live-status').innerHTML = paused ? '<i></i> EXHIBITION / 演示已暂停' : '<i></i> EXHIBITION / 演示运行中';
}

function restart() {
  data = structuredClone(baseline);
  elapsed = 0;
  eventCursor = 0;
  stageIndex = 0;
  currentEvent = null;
  render();
  const overlay = document.querySelector('#replay');
  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 1500);
}

function tick() {
  const now = performance.now();
  const delta = Math.min((now - lastTick) / 1000,1);
  lastTick = now;
  if (paused) return;
  elapsed += delta;
  if (elapsed >= data.reporting.cycleSeconds) { restart(); return; }
  while (eventCursor < data.demoEvents.length && elapsed >= data.demoEvents[eventCursor].at) {
    currentEvent = data.demoEvents[eventCursor++];
    applyDemoEvent(data,currentEvent);
    updateEvent(currentEvent);
  }
  const nextStage = caseStageIndex(data.caseStudy.stages,elapsed);
  if (nextStage !== stageIndex) { stageIndex = nextStage; updateStage(); }
  updateTime();
}

screen.addEventListener('click', event => {
  if (event.target.closest('#playback')) { setPaused(!paused); return; }
  if (event.target.closest('#source-button')) {
    setPaused(true);
    document.querySelector('#source-content').innerHTML = `<p>中央案例来自用户提供的 369 首月真实脱敏方案。AI 处理画面为依据内容整理的流程复原，专业审核是核对项示意，均不代表原始模型日志或专家签批记录。</p><p>369 与 TLC 21 天是两类已有服务，周期和安排不同。${esc(data.reporting.publicDisplayNote)}；合作资源规模来自公司资料，正式展示前仍需核对对外使用授权和统计凭据。</p><p>地图当前为本地效果预览素材；公开展出前须核验适用的标准地图和审图号。</p>`;
    dialog.showModal();
  }
});
document.querySelector('#close-source').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

try {
  [data,geometry] = await Promise.all([readDashboard(),readProvinceGeometry()]);
  assertData(data,geometry);
  baseline = structuredClone(data);
  render();
  lastTick = performance.now();
  setInterval(tick,200);
  setInterval(updateClock,30_000);
} catch (error) {
  screen.innerHTML = `<div class="loading">大屏数据加载失败：${esc(error.message)}</div>`;
  console.error(error);
}
