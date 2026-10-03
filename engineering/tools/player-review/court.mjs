import {courtLandmarks,fitHomography,invertHomography} from './court-geometry.mjs';
// NBA template in metres. Origin: left baseline / far sideline in the plan view.
export const COURT={length:28.6512,width:15.24,template:'NBA',units:'metres',origin:'left_baseline_far_sideline'};
export const LANDMARK_NAMES=['A · 底线 × 远侧禁区线','B · 罚球线 × 远侧禁区线','C · 罚球线 × 近侧禁区线','D · 底线 × 近侧禁区线'];
export function landmarks(side='left'){
  return [[0,5.1816],[5.7912,5.1816],[5.7912,10.0584],[0,10.0584]].map(([x,y])=>[side==='right'?COURT.length-x:x,y]);
}
export function project(h,x,y){
  if(!h||!Number.isFinite(x)||!Number.isFinite(y))return null;
  const w=h[6]*x+h[7]*y+h[8];
  if(Math.abs(w)<1e-9)return null;
  const p={x:(h[0]*x+h[1]*y+h[2])/w,y:(h[3]*x+h[4]*y+h[5])/w};
  return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
}
export function validQuad(points){
  if(points?.length!==4||points.some(p=>p?.length!==2||p.some(v=>!Number.isFinite(v))))return false;
  const crosses=points.map((a,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);});
  return crosses.every(v=>v>1e-5)||crosses.every(v=>v< -1e-5);
}
export function homography(from,to){
  if(!validQuad(from)||!validQuad(to))return null;
  // Scale coordinates before elimination to avoid image-pixel conditioning.
  const sx=Math.max(...from.flat().map(Math.abs),1),sy=Math.max(...to.flat().map(Math.abs),1);
  const rows=[];
  from.forEach(([xx,yy],i)=>{const x=xx/sx,y=yy/sx,u=to[i][0]/sy,v=to[i][1]/sy;rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);});
  for(let c=0;c<8;c++){
    let pivot=c;for(let r=c+1;r<8;r++)if(Math.abs(rows[r][c])>Math.abs(rows[pivot][c]))pivot=r;
    if(Math.abs(rows[pivot][c])<1e-10)return null;
    [rows[c],rows[pivot]]=[rows[pivot],rows[c]];
    const d=rows[c][c];for(let k=c;k<=8;k++)rows[c][k]/=d;
    for(let r=0;r<8;r++)if(r!==c){const f=rows[r][c];for(let k=c;k<=8;k++)rows[r][k]-=f*rows[c][k];}
  }
  const a=rows.map(row=>row[8]);return [a[0]*sy/sx,a[1]*sy/sx,a[2]*sy,a[3]*sy/sx,a[4]*sy/sx,a[5]*sy,a[6]/sx,a[7]/sx,1];
}
export function keyframePoints(key){
  return key.points||((key.image||[]).map((image,i)=>({id:'ABCD'[i],image,source:key.source||'reference'})));
}
export function fitKeyframe(key){
  const catalog=courtLandmarks(key.side),all=keyframePoints(key).filter(p=>p.enabled!==false&&catalog.some(c=>c.id===p.id)&&p.image?.length===2);
  if(new Set(all.map(p=>p.id)).size!==all.length)return null;
  const points=all.filter(p=>p.role!=='check'),checks=all.filter(p=>p.role==='check');
  const floor=points.map(p=>{const c=catalog.find(c=>c.id===p.id);return [c.x,c.y];}),image=points.map(p=>p.image);
  const toImage=fitHomography(floor,image),toCourt=toImage&&invertHomography(toImage);if(!toCourt)return null;
  const predicted=floor.map(p=>project(toImage,...p));if(predicted.some(p=>!p))return null;
  const residuals=points.map((p,i)=>({id:p.id,pixels:Math.hypot(predicted[i].x-p.image[0],predicted[i].y-p.image[1])}));
  const checkResiduals=checks.map(p=>{const c=catalog.find(c=>c.id===p.id),q=project(toImage,c.x,c.y),back=project(toCourt,...p.image);return {id:p.id,pixels:q?Math.hypot(q.x-p.image[0],q.y-p.image[1]):null,metres:back?Math.hypot(back.x-c.x,back.y-c.y):null};});
  return {toImage,toCourt,points,residuals,checkResiduals,supportHull:convexHull(floor),fitRmsePixels:Math.sqrt(residuals.reduce((n,r)=>n+r.pixels**2,0)/points.length)};
}
export function calibrationAt(calibration,frame,frames,cuts=[]){
  const keys=[...(calibration?.keyframes||[])].filter(k=>Number.isInteger(k.frame)&&frames[k.frame]).sort((a,b)=>a.frame-b.frame);
  let left=null,right=null;
  for(const key of keys){if(key.frame===frame){left=right=key;break;}if(key.frame<frame)left=key;else{right=key;break;}}
  if(!left||!right||left.side!==right.side||cuts.some(c=>c>left.frame&&c<=right.frame))return null;
  if([left,right].some(key=>['needs_review','invalid','failed'].includes(key.status)||key.valid===false))return null;
  for(const key of [left,right]){
    const propagated=key.source==='camera_propagation'||keyframePoints(key).some(p=>p.enabled!==false&&p.role!=='check'&&p.source==='camera_propagation');
    if(!propagated)continue;
    const support=key.cameraSupportFrame??key.quality?.cameraSupportFrame??key.quality?.referenceFrame;
    if(!Number.isInteger(support)||support<0||support>=frames.length||cuts.some(c=>c>Math.min(support,key.frame)&&c<=Math.max(support,key.frame)))return null;
  }
  const span=frames[right.frame].time-frames[left.frame].time;
  if(span>(calibration.maxKeyframeGapSeconds??1.2))return null;
  const a=fitKeyframe(left),b=left===right?a:fitKeyframe(right);if(!a||!b)return null;
  const t=span?(frames[frame].time-frames[left.frame].time)/span:0,floor=landmarks(left.side);
  const pa=floor.map(p=>project(a.toImage,...p)),pb=floor.map(p=>project(b.toImage,...p));if([...pa,...pb].some(p=>!p))return null;
  const image=pa.map((x,i)=>{const y=pb[i];return [x.x+(y.x-x.x)*t,x.y+(y.y-x.y)*t];});
  const toImage=left===right?a.toImage:homography(floor,image),toCourt=toImage&&invertHomography(toImage);
  if(!toCourt||!validQuad(image))return null;
  return {toCourt,toImage,image,side:left.side,supportFrames:[left.frame,right.frame],
    method:left.frame===right.frame?(left.source==='human'?'manual_keyframe':'reference_keyframe'):'interpolated_landmarks',
    quality:left===right?left.quality||null:{left:left.quality||null,right:right.quality||null},
    referenceOnly:[...a.points,...b.points].some(p=>p.source!=='human'),reviewRequired:true,
    fitRmsePixels:left===right?a.fitRmsePixels:null,residuals:left===right?a.residuals:[],
    controlCount:left===right?a.points.length:Math.min(a.points.length,b.points.length),
    checkResiduals:left===right?a.checkResiduals:[],supportHulls:left===right?[a.supportHull]:[a.supportHull,b.supportHull]};
}
export function convexHull(points){
  const sorted=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=list=>{const h=[];for(const p of list){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h.slice(0,-1);};
  return sorted.length<3?sorted:[...half(sorted),...half([...sorted].reverse())];
}
export function insideHull(hull,x,y){
  if(hull.length<3||![x,y].every(Number.isFinite))return false;
  return hull.every((a,i)=>{const b=hull[(i+1)%hull.length];return (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-8;});
}
export function footPointSensitivity(h,x,y,pixelRadius=5){
  if(!h||![x,y,pixelRadius].every(Number.isFinite)||pixelRadius<0)return null;
  const d=h[6]*x+h[7]*y+h[8],p=project(h,x,y);if(!p)return null;
  const a=(h[0]-p.x*h[6])/d,b=(h[1]-p.x*h[7])/d,c=(h[3]-p.y*h[6])/d,e=(h[4]-p.y*h[7])/d;
  const trace=a*a+b*b+c*c+e*e,det=(a*e-b*c)**2,maxEigen=(trace+Math.sqrt(Math.max(0,trace*trace-4*det)))/2;
  const approxMaxMetres=pixelRadius*Math.sqrt(maxEigen);return Number.isFinite(approxMaxMetres)?{assumedPixelError:pixelRadius,approxMaxMetres,method:'local_linear_sensitivity',excludesCalibrationError:true}:null;
}
export function buildCourtTrajectories(session,frames,imageTrajectories){
  const maps=frames.map((_,i)=>calibrationAt(session.courtCalibration,i,frames,session.cuts));
  const result={};
  for(const entity of session.entities){
    result[entity.id]=imageTrajectories[entity.id].map((p,i)=>{
      const base={frame:i,time:p.time,x:null,y:null,imageSource:p.source};
      if(p.reviewExcluded)return {...base,source:'missing',reviewExcluded:true,
        identitySource:p.identitySource,identityStartFrame:p.identityStartFrame,identityEndFrame:p.identityEndFrame,
        identityOrder:p.identityOrder,identityExclusive:p.identityExclusive,identityOrigin:p.identityOrigin};
      if(['conflict','out_of_view'].includes(p.source))return {...base,source:p.source};
      const anchor=(entity.courtAnchors||[]).find(a=>a.frame===i);
      if(anchor)return {...base,x:anchor.x,y:anchor.y,source:'court_manual',footMethod:'human_court_anchor',reviewRequired:true};
      if(p.x===null)return {...base,source:'missing'};
      const mapping=maps[i],point=mapping&&project(mapping.toCourt,p.x,p.y);
      if(!point)return {...base,source:'uncalibrated'};
      return {...base,...point,source:['interpolated','manual_path'].includes(p.source)?'court_estimated':'projected',
        mappingMethod:mapping.method,calibrationFrames:mapping.supportFrames,referenceCalibration:mapping.referenceOnly,
        calibrationQuality:mapping.quality,
        footMethod:p.footMethod||(p.source==='interpolated'?'interpolated_image_point':p.source==='manual'&&!p.box?'human_image_anchor':'bbox_bottom_center'),reviewRequired:true,
        ...(p.footCandidate?{footCandidate:p.footCandidate}:{}),
        ...(p.groundContactConfirmed===false?{groundContactConfirmed:false}:{}),
        calibrationSupport:mapping.supportHulls.every(hull=>insideHull(hull,point.x,point.y))?'inside_controls':'outside_controls',
        sensitivity:footPointSensitivity(mapping.toCourt,p.x,p.y),
        outsideCourt:point.x<0||point.x>COURT.length||point.y<0||point.y>COURT.width};
    });
  }
  return result;
}
export function courtGaps(points){
  const ranges=[];let current=null;
  points.forEach((p,i)=>{
    const reason=['missing','conflict','uncalibrated'].includes(p.source)?p.source:null;
    if(reason!==current?.reason){if(current)ranges.push(current);current=reason?{start:i,end:i,reason}:null;}
    if(current)current.end=i;
  });
  if(current)ranges.push(current);return ranges;
}
export function pathSegments(points,cuts=[]){
  const result=[];let segment=[];
  for(const p of points){
    if(p.x===null||cuts.includes(p.frame)){if(segment.length)result.push(segment);segment=[];}
    if(p.x!==null)segment.push(p);
  }
  if(segment.length)result.push(segment);return result;
}
export function smoothCourtTrajectory(points,cuts=[],radius=2){
  const result=points.map(point=>({...point})),cutSet=new Set(cuts),median=values=>{
    const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
  };
  for(let frame=radius;frame<points.length-radius;frame++){
    const current=points[frame];
    if(current?.source!=='projected'||!Number.isFinite(current.x)||!Number.isFinite(current.y))continue;
    const window=points.slice(frame-radius,frame+radius+1);
    if(window.some((point,index)=>point?.source!=='projected'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||
      (index>0&&cutSet.has(frame-radius+index))))continue;
    const x=median(window.map(point=>point.x)),y=median(window.map(point=>point.y)),deviation=Math.hypot(current.x-x,current.y-y);
    if(deviation<=1.15){result[frame]={...current,x:current.x*.45+x*.55,y:current.y*.45+y*.55,displaySmoothed:true};continue;}
    const shoulders=Math.hypot(points[frame-radius].x-points[frame+radius].x,points[frame-radius].y-points[frame+radius].y);
    if(shoulders<1.3)result[frame]={...current,x,y,displaySmoothed:true};
  }
  return result;
}
export function addCourtAnchor(entity,frame,x,y){
  if(!Number.isInteger(frame)||frame<0||![x,y].every(Number.isFinite)||x<0||x>COURT.length||y<0||y>COURT.width)throw new Error('补点必须在球场范围内');
  entity.courtAnchors=(entity.courtAnchors||[]).filter(a=>a.frame!==frame);
  entity.courtAnchors.push({frame,x,y,source:'human_court',reviewRequired:true});
}
export function addEvent(entity,frame,type,note,frames){
  if(!frames[frame]||!['接球','传球','投篮','掩护','切入','篮板','其他'].includes(type))throw new Error('事件时间或类型不正确');
  const event={id:globalThis.crypto.randomUUID(),frame,time:frames[frame].time,type,note:String(note||'').trim().slice(0,240),source:'human'};
  entity.events||=[];entity.events.push(event);return event;
}
export function exportCourtData(session,frames,trajectories){
  const court=buildCourtTrajectories(session,frames,trajectories);
  return {court:{...COURT,calibration:session.courtCalibration||null,metricAccuracyValidated:false},courtTrajectories:court};
}
