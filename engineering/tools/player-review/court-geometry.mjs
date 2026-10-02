const L=28.6512,W=15.24;
export function courtLandmarks(side='left'){
  const data=[['A','禁区：底线 × 远禁区线',0,5.1816],['B','禁区：罚球线 × 远禁区线',5.7912,5.1816],['C','禁区：罚球线 × 近禁区线',5.7912,10.0584],['D','禁区：底线 × 近禁区线',0,10.0584],['E','外边界：底线 × 远边线',0,0],['F','中线 × 远边线',L/2,0],['G','外边界：底线 × 近边线',0,W],['H','中线 × 近边线',L/2,W],['I','底线 × 远侧三分直线',0,.9144],['J','底线 × 近侧三分直线',0,W-.9144]];
  return data.map(([id,name,x,y])=>({id,name,x:side==='right'?L-x:x,y}));
}
export function courtMarkings(){
  const lines=[{id:'far_sideline',name:'远边线',color:'#00a8a0',points:[[0,0],[L,0]]},{id:'near_sideline',name:'近边线',color:'#00a8a0',points:[[0,W],[L,W]]},{id:'midline',name:'中线',color:'#d064e4',points:[[L/2,0],[L/2,W]]}];
  for(const side of ['left','right']){
    const x=v=>side==='left'?v:L-v,prefix=side==='left'?'左':'右';
    lines.push({id:`${side}_baseline`,name:`${prefix}底线`,color:'#ffae31',points:[[x(0),0],[x(0),W]]});
    lines.push({id:`${side}_key`,name:`${prefix}禁区`,color:'#3c9fff',points:[[x(0),5.1816],[x(5.7912),5.1816],[x(5.7912),10.0584],[x(0),10.0584]]});
    const theta=Math.asin((7.62-.9144)/7.239),arc=Array.from({length:65},(_,i)=>{const a=-theta+i*theta*2/64;return [x(1.6002+7.239*Math.cos(a)),7.62+7.239*Math.sin(a)];});
    lines.push({id:`${side}_three`,name:`${prefix}三分线`,color:'#f15a4d',points:[[x(0),.9144],...arc,[x(0),W-.9144]]});
  }
  return lines;
}
export function invertHomography(h){
  const[a,b,c,d,e,f,g,i,j]=h,det=a*(e*j-f*i)-b*(d*j-f*g)+c*(d*i-e*g);
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  return [e*j-f*i,c*i-b*j,b*f-c*e,f*g-d*j,a*j-c*g,c*d-a*f,d*i-e*g,b*g-a*i,a*e-b*d].map(v=>v/det);
}
export function fitHomography(from,to){
  if(from.length<4||from.length!==to.length||[...from,...to].some(p=>p.length!==2||p.some(x=>!Number.isFinite(x))))return null;
  const sx=Math.max(1,...from.flat().map(Math.abs)),sy=Math.max(1,...to.flat().map(Math.abs));
  const rows=[];from.forEach(([xx,yy],i)=>{const x=xx/sx,y=yy/sx,u=to[i][0]/sy,v=to[i][1]/sy;rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);});
  const a=Array.from({length:8},(_,i)=>Array.from({length:9},(_,j)=>rows.reduce((sum,r)=>sum+r[i]*r[j],0)));
  for(let c=0;c<8;c++){
    let pivot=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
    if(Math.abs(a[pivot][c])<1e-11)return null;
    [a[c],a[pivot]]=[a[pivot],a[c]];const d=a[c][c];for(let k=c;k<9;k++)a[c][k]/=d;
    for(let r=0;r<8;r++)if(r!==c){const f=a[r][c];for(let k=c;k<9;k++)a[r][k]-=f*a[c][k];}
  }
  const v=a.map(r=>r[8]);return [v[0]*sy/sx,v[1]*sy/sx,v[2]*sy,v[3]*sy/sx,v[4]*sy/sx,v[5]*sy,v[6]/sx,v[7]/sx,1];
}
