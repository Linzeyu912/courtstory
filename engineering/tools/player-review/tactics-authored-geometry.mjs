import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {homography,project,validQuad} from './court.mjs';

export const DEFAULT_RIBBON=Object.freeze({bodyWidth:.2,headLength:.67,headWidth:.7,fadeRemaining:.55,edgeColor:'#093444',edgePixels:2.1,opacity:.94});
export const productionPhaseSnapshot=p=>({phaseId:p.phaseId,startFrame:p.startFrame,endFrameExclusive:p.endFrameExclusive,freezeFrame:p.freezeFrame});
export const productionSourceSnapshot=d=>structuredClone(d.playDefinition.sourceBinding);
const finite=n=>typeof n==='number'&&Number.isFinite(n),integer=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(o,keys,optional=[])=>o&&typeof o==='object'&&!Array.isArray(o)&&keys.every(k=>Object.hasOwn(o,k))&&Object.keys(o).every(k=>keys.includes(k)||optional.includes(k));
export const productionEqual=(a,b)=>canonicalJSON(a)===canonicalJSON(b);

/** Synchronous SHA-256 keeps camera editing identical in the browser and render worker. */
export function sha256(text){
  const bytes=new TextEncoder().encode(text),length=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(length);data.set(bytes);data[bytes.length]=128;
  const view=new DataView(data.buffer);view.setUint32(length-4,bytes.length*8>>>0);view.setUint32(length-8,Math.floor(bytes.length/0x20000000));
  const primes=[],initial=[],constants=[];for(let n=2;primes.length<64;n++){if(primes.some(p=>p*p<=n&&n%p===0))continue;primes.push(n);if(initial.length<8)initial.push((Math.sqrt(n)%1*2**32)>>>0);constants.push((Math.cbrt(n)%1*2**32)>>>0);}
  const h=initial,w=new Uint32Array(64),rotate=(n,k)=>(n>>>k)|(n<<(32-k));
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
    let [a,b,c,d,e,f,g,j]=h;
    for(let i=0;i<64;i++){const t1=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    [a,b,c,d,e,f,g,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
  }
  return h.map(v=>v.toString(16).padStart(8,'0')).join('');
}
export function productionCameraDigest(camera){const {digest,origin,...content}=camera;return sha256(canonicalJSON(content));}
export function validateAuthoredPath(a){
  const p=a.authoredPath;if(p===undefined)return true;
  if(a.type!=='route'||a.space!=='video'||a.followEntity||a.points?.length!==4||(a.style?.pattern??'solid')!=='solid'||
    !exact(p,['version','curve','cameraId','cameraDigest','progressFrames','ribbon'])||p.version!==1||p.curve!=='cubic_bezier'||typeof p.cameraId!=='string'||!p.cameraId.length||p.cameraId.length>256||!/^[a-f0-9]{64}$/.test(p.cameraDigest))return false;
  const keys=p.progressFrames,r=p.ribbon;
  if(!Array.isArray(keys)||keys.length<2||keys.length>80||keys.some((k,i)=>!exact(k,['frame','t'])||!integer(k.frame)||k.frame<a.startFrame||k.frame>a.endFrameExclusive||!finite(k.t)||k.t<0||k.t>1||i&&(k.frame<=keys[i-1].frame||k.t<keys[i-1].t))||keys[0].frame!==a.startFrame||keys[0].t!==0||keys.at(-1).frame!==a.endFrameExclusive||keys.at(-1).t!==1)return false;
  return exact(r,Object.keys(DEFAULT_RIBBON))&&['bodyWidth','headLength','headWidth','fadeRemaining'].every(k=>finite(r[k])&&r[k]>0&&r[k]<=5)&&finite(r.edgePixels)&&r.edgePixels>=0&&r.edgePixels<=12&&finite(r.opacity)&&r.opacity>0&&r.opacity<=1&&/^#[a-f0-9]{6}$/i.test(r.edgeColor);
}
export function authoredBindingReason(document,a){
  if(!a.authoredPath)return null;
  const production=document.production,camera=production?.cameras.find(c=>c.id===a.authoredPath.cameraId);
  if(!production||!productionEqual(production.sourceBinding,productionSourceSnapshot(document)))return 'production_source_changed';
  if(!camera||camera.phaseId!==a.phaseId)return 'camera_missing';
  const phase=document.playDefinition.phases.find(p=>p.phaseId===a.phaseId);
  if(!phase||!productionEqual(camera.phaseSnapshot,productionPhaseSnapshot(phase)))return 'camera_changed';
  if(camera.digest!==productionCameraDigest(camera)||camera.digest!==a.authoredPath.cameraDigest)return 'camera_changed';
  return null;
}
export function productionCameraAt(camera,frame,cuts=[]){
  const keys=camera?.keyframes;if(!keys?.length||frame<keys[0].frame||frame>keys.at(-1).frame)return null;
  let right=keys.findIndex(k=>k.frame>=frame),left=keys[right].frame===frame?right:right-1;
  const a=keys[left],b=keys[right];if(cuts.some(c=>c>a.frame&&c<=b.frame))return null;
  const t=a===b?0:(frame-a.frame)/(b.frame-a.frame),quad=a.quad.map((p,i)=>p.map((n,j)=>n+(b.quad[i][j]-n)*t));
  if(!validQuad(quad))return null;
  const toImage=homography(camera.groundQuad,quad),toGround=homography(quad,camera.groundQuad);
  return toImage&&toGround?{quad,toImage,toGround}:null;
}
export function progressAt(keys,frame){
  if(frame<=keys[0].frame)return keys[0].t;
  for(let i=1;i<keys.length;i++)if(frame<=keys[i].frame){const a=keys[i-1],b=keys[i];return a.t+(b.t-a.t)*(frame-a.frame)/(b.frame-a.frame);}
  return keys.at(-1).t;
}
export function cubicBezier(points,t){const u=1-t;return {x:u**3*points[0].x+3*u*u*t*points[1].x+3*u*t*t*points[2].x+t**3*points[3].x,y:u**3*points[0].y+3*u*u*t*points[1].y+3*u*t*t*points[2].y+t**3*points[3].y};}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
/** Width and arrowhead are constructed on the illustrative ground plane before projection. */
export function authoredRouteGeometry(document,a,frame,{reveal=1,editing=false}={}){
  const camera=document.production.cameras.find(c=>c.id===a.authoredPath.cameraId),cuts=document.review.settings?.cuts??[],ref=productionCameraAt(camera,a.anchorFrame,cuts),now=productionCameraAt(camera,frame,cuts);
  if(!ref||!now||cuts.some(c=>c>Math.min(frame,a.anchorFrame)&&c<=Math.max(frame,a.anchorFrame)))return {reason:'production_camera_unavailable'};
  const controls=a.points.map(p=>project(ref.toGround,p.x,p.y));if(controls.some(p=>!p))return {reason:'projection_unavailable'};
  const p=a.authoredPath,r={...p.ribbon};for(const key of ['bodyWidth','headLength','headWidth','fadeRemaining','edgePixels'])r[key]*=a.style.size;
  const t=editing?0:progressAt(p.progressFrames,frame),limit=Math.max(0,Math.min(1,reveal));
  if(limit<=0||t>=limit)return {reason:'completed'};
  const curve=Array.from({length:601},(_,i)=>cubicBezier(controls,limit*i/600)),cum=[0];for(let i=1;i<curve.length;i++)cum.push(cum.at(-1)+distance(curve[i-1],curve[i]));
  const baseDistance=cum.at(-1)-r.headLength;if(baseDistance<=0)return {reason:'completed'};
  const sample=(values,index)=>{const i=Math.min(values.length-2,Math.floor(index)),f=index-i;return typeof values[0]==='number'?values[i]+(values[i+1]-values[i])*f:lerp(values[i],values[i+1],f);};
  const walked=sample(cum,t/limit*600);if(walked>=baseDistance)return {reason:'completed'};
  let b=cum.findIndex(n=>n>=baseDistance);const base=lerp(curve[b-1],curve[b],(baseDistance-cum[b-1])/(cum[b]-cum[b-1]));
  const body=[sample(curve,t/limit*600),...curve.filter((_,i)=>limit*i/600>t&&cum[i]<baseDistance),base];
  const normals=body.map((p,i)=>{const before=body[Math.max(0,i-1)],after=body[Math.min(body.length-1,i+1)],length=distance(before,after)||1;return {x:-(after.y-before.y)/length,y:(after.x-before.x)/length};});
  const side=sign=>body.map((p,i)=>({x:p.x+normals[i].x*r.bodyWidth/2*sign,y:p.y+normals[i].y*r.bodyWidth/2*sign}));
  const tip=curve.at(-1),length=distance(base,tip)||1,headNormal={x:-(tip.y-base.y)/length,y:(tip.x-base.x)/length};
  const polygon=[...side(1),{x:base.x+headNormal.x*r.headWidth/2,y:base.y+headNormal.y*r.headWidth/2},tip,{x:base.x-headNormal.x*r.headWidth/2,y:base.y-headNormal.y*r.headWidth/2},...side(-1).reverse()];
  const mapped=polygon.map(p=>project(now.toImage,p.x,p.y));if(mapped.some(p=>!p))return {reason:'projection_unavailable'};
  return {geometry:{ribbon:mapped,tip:project(now.toImage,tip.x,tip.y),curve:body.map(p=>project(now.toImage,p.x,p.y)),strokeWidth:r.edgePixels,edgeColor:r.edgeColor,opacity:r.opacity*Math.min(1,(baseDistance-walked)/r.fadeRemaining)}};
}
