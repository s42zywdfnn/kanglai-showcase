export function tweenValue(from,to,progress){
  const t=Math.max(0,Math.min(1,progress));
  return from+(to-from)*(1-(1-t)**3);
}

export function trendGeometry(values,max,min=0){
  const points=values.map((value,index)=>[32+index*58,118-(value-min)/(max-min)*100]);
  const line=points.map(([x,y],index)=>`${index?'L':'M'}${x} ${y.toFixed(2)}`).join(' ');
  return {line,area:`${line} L380 117 L32 117 Z`,lastY:points.at(-1)[1]};
}
