// 与中央小青个案并行的全站运营批次演示；各包均为预置模拟事件。
const packets={
  e01:{summary:'数据基线已载入 · 等待服务事件'},
  e02:{summary:'同类服务批次：新增 32 位在管用户，人群与地区同步',focus:'浙江省',
    people:{age:[3,7,10,8,4],gender:[21,11],regions:[12,7,5,5,3],primaryServices:[13,19],needs:[18,10,9,7]}},
  e03:{summary:'同类服务批次：生成 23 份待审核方案，版本与趋势同步',planDrafts:23},
  e04:{summary:'同类服务批次：23 份草案完成审核，版本总量不重复增加',planReviews:23},
  e05:{summary:'同类服务批次：新增 24 位用户、136 条行动记录',focus:'江苏省',
    people:{age:[2,5,8,6,3],gender:[15,9],regions:[8,5,4,4,3],primaryServices:[9,15],needs:[13,8,7,5]},actions:[52,31,23,14,8,8]},
  e06:{summary:'同类服务批次：新增 58 条行动记录，六维与趋势同步',actions:[23,12,10,6,3,4]},
  e07:{summary:'同类服务批次：新增 18 位用户、95 条行动、19 条反馈',focus:'广东省',
    people:{age:[1,4,6,5,2],gender:[12,6],regions:[5,4,3,3,3],primaryServices:[7,11],needs:[10,6,5,4]},actions:[30,24,18,12,5,6],feedback:19},
  e08:{summary:'同类服务批次：调整生成 11 份待审核版本，人数不重复增加',planDrafts:11},
  e09:{summary:'同类服务批次：11 份调整版本完成审核，等待下一轮回放',planReviews:11}
};

const sum=values=>values.reduce((total,value)=>total+value,0);
const addRows=(rows,values)=>values.forEach((value,index)=>{rows[index].value+=value;});
const status=(data,name)=>data.plans.versionStatus.find(row=>row.name===name);

export function incrementShare(part,baselinePart,total,baselineTotal){
  const added=total-baselineTotal;
  return added>0?(part-baselinePart)/added*100:null;
}

export function applyOperation(source,eventId){
  const packet=packets[eventId];
  if(!packet) throw new Error('未知运营事件');
  if(source.replayEvents?.includes(eventId)) throw new Error('重复运营事件');
  const data=structuredClone(source);
  data.replayEvents=[...(data.replayEvents||[]),eventId];
  if(packet.people){
    const p=packet.people;
    const users=sum(p.age);
    for(const key of ['gender','regions','primaryServices']) if(sum(p[key])!==users) throw new Error(`${key} 事件人数不守恒`);
    data.totals.users+=users;
    for(const key of ['age','gender','primaryServices','needs']) addRows(data.people[key],p[key]);
    addRows(data.people.regions.slice(0,5),p.regions);
  }
  if(packet.planDrafts){
    data.totals.planVersions+=packet.planDrafts;
    status(data,'待审核').value+=packet.planDrafts;
    data.trend.at(-1).plans+=packet.planDrafts;
  }
  if(packet.planReviews){
    status(data,'待审核').value-=packet.planReviews;
    status(data,'已审核').value+=packet.planReviews;
  }
  if(packet.actions){
    const count=sum(packet.actions);
    data.totals.actionRecords+=count;
    addRows(data.actions.pillars,packet.actions);
    data.trend.at(-1).actions+=count;
  }
  if(packet.feedback){
    data.totals.stageFeedback+=packet.feedback;
    data.trend.at(-1).feedback+=packet.feedback;
  }
  return {data,summary:packet.summary,focus:packet.focus};
}
