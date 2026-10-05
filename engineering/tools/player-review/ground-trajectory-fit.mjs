// Fritsch–Carlson/PCHIP slopes use decoded frame times, never nominal FPS.
export const GROUND_FIT_METHOD='shape_preserving_hermite_v1';
function slopes(knots,key){
  if(knots.length===1)return [0];
  const h=knots.slice(1).map((k,i)=>k.time-knots[i].time),d=h.map((v,i)=>(knots[i+1][key]-knots[i][key])/v);
  if(h.some(v=>!(v>0)))throw new Error('地面锚点时间必须严格递增。');
  if(knots.length===2)return [d[0],d[0]];
  const endpoint=(a,b,da,db)=>{let m=((2*a+b)*da-a*db)/(a+b);if(Math.sign(m)!==Math.sign(da))return 0;if(Math.sign(da)!==Math.sign(db)&&Math.abs(m)>3*Math.abs(da))m=3*da;return m;};
  const m=[endpoint(h[0],h[1],d[0],d[1])];
  for(let i=1;i<knots.length-1;i++){
    if(d[i-1]===0||d[i]===0||Math.sign(d[i-1])!==Math.sign(d[i]))m.push(0);
    else {const a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];m.push((a+b)/(a/d[i-1]+b/d[i]));}
  }
  m.push(endpoint(h.at(-1),h.at(-2),d.at(-1),d.at(-2)));
  return m;
}
export function fitGroundSegment(knots,samples){
  if(!Array.isArray(knots)||!knots.length||knots.some(k=>![k.time,k.x,k.y].every(Number.isFinite)))throw new Error('地面轨迹锚点无效。');
  const mx=slopes(knots,'x'),my=slopes(knots,'y');
  // Two-point spans remain linear; with more evidence, explicit turns/stops
  // may stop the derivative without moving the anchor itself.
  if(knots.length>2)knots.forEach((k,i)=>{if(k.turn===true){mx[i]=0;my[i]=0;}});
  let index=0;
  return samples.map(sample=>{
    if(sample.time<knots[0].time||sample.time>knots.at(-1).time)return null;
    while(index+1<knots.length-1&&sample.time>knots[index+1].time)index++;
    const a=knots[index],b=knots[index+1];
    if(!b)return {x:a.x,y:a.y,supportFrames:[a.frame]};
    const dt=b.time-a.time,t=(sample.time-a.time)/dt,t2=t*t,t3=t2*t;
    const hermite=(key,m)=>(2*t3-3*t2+1)*a[key]+(t3-2*t2+t)*dt*m[index]+(-2*t3+3*t2)*b[key]+(t3-t2)*dt*m[index+1];
    return {x:hermite('x',mx),y:hermite('y',my),supportFrames:[a.frame,b.frame]};
  });
}
