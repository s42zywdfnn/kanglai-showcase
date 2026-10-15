export const DEMO_EVENTS = [
  {id:'e01',type:'profile',userId:'xiaoqing',stage:0,title:'汇集小青的健康资料',detail:'手表、小程序与日常记录，连同自检、体检和面诊资料，进入个人健康档案。',tag:'资料输入'},
  {id:'e02',type:'analysis',userId:'xiaoqing',stage:1,title:'AI 构建个性画像并匹配依据',detail:'整合自填资料、日常打卡、微信沟通及面诊信息，关联知识库和安全规则，生成待核对标签。',tag:'AI 辅助整理'},
  {id:'e03',type:'plan',userId:'xiaoqing',versionId:'P-001',stage:2,title:'AI 辅助形成 369 方案 V1',detail:'围绕关系边界与身心安定，组合运动、睡眠和营养行动；草案尚未交付。',tag:'方案草案'},
  {id:'e04',type:'review',userId:'xiaoqing',versionId:'P-001',stage:3,title:'专家核对同一份 V1 方案',detail:'核对阶段目标、多维任务、既有医嘱和不适暂停边界，确认后交付执行。',tag:'专业确认'},
  {id:'e05',type:'action',userId:'xiaoqing',stage:4,title:'多维行动持续回流健康档案',detail:'关系边界、循序活动、睡眠节奏及规律进食分别记录行动与感受。',tag:'每日行动'},
  {id:'e06',type:'comment',userId:'xiaoqing',stage:5,title:'专业人员结合 V1 分维点评',detail:'对关系、运动和睡眠记录分别回应，并保留既有医嘱与不适反馈边界。',tag:'专业点评'},
  {id:'e07',type:'feedback',userId:'xiaoqing',stage:6,title:'第 1 周执行反馈进入阶段复盘',detail:'识别关系练习、活动强度与夜醒观察的执行情况，形成下一轮调整依据。',tag:'阶段复盘'},
  {id:'e08',type:'plan',userId:'xiaoqing',versionId:'P-002',stage:7,title:'形成 V2 执行强度调整草案',detail:'保留调理主线和多维记录，把状态差时的运动改为最低执行版，并将关系任务拆成一件事；草案待专业核对。',tag:'调整草案'},
  {id:'e09',type:'review',userId:'xiaoqing',versionId:'P-002',stage:7,title:'专业确认 V2 调整',detail:'核对最低执行版、关系任务及观察边界后交付；同一人仍只计一次。',tag:'调整确认'}
];

const clone = value => structuredClone(value);

export function createState(baseline) {
  return {data:clone(baseline),cursor:0,paused:false,current:null,recent:[],versions:{},completed:false};
}

export function setPaused(state,paused) {return {...state,paused};}
export function resetState(baseline) {return createState(baseline);}

export function applyNext(state,event=DEMO_EVENTS[state.cursor]) {
  if (state.paused || state.completed || !event) return state;
  if (DEMO_EVENTS[state.cursor]?.id !== event.id) throw new Error('演示事件顺序不一致');
  const next=clone(state);
  if(event.type === 'plan') {
    if(next.versions[event.versionId]) throw new Error('重复方案版本');
    next.versions[event.versionId]='待核对';
  } else if(event.type === 'review') {
    if(next.versions[event.versionId] !== '待核对') throw new Error('方案状态不可确认');
    next.versions[event.versionId]='已确认';
  }
  next.cursor++;
  next.current=event;
  next.recent=[event,...next.recent].slice(0,3);
  next.completed=next.cursor === DEMO_EVENTS.length;
  return next;
}
