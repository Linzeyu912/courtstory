import {COURT} from './court.mjs';
import {createAnnotation,updateAnnotation,validateAnnotations} from './tactics-annotations.mjs';
import {validateFrameRange} from './tactics-time-range.mjs';
export function courtCanvasPoint(viewBox,pointer){
  if(![viewBox?.left,viewBox?.top,viewBox?.width,viewBox?.height,pointer?.clientX,pointer?.clientY].every(Number.isFinite)||viewBox.width<=0||viewBox.height<=0)throw new Error('2D 画布尺寸无效。');
  const x=(pointer.clientX-viewBox.left)/viewBox.width*COURT.length,y=(pointer.clientY-viewBox.top)/viewBox.height*COURT.width;
  if(x<0||y<0||x>COURT.length||y>COURT.width)throw new Error('请在球场内绘制。');return {x,y};
}
export function createCourtAnnotation(document,input){
  if(document.schemaVersion!==2)throw new Error('请显式迁移旧稿后使用秒级 2D 编辑。');
  const range=validateFrameRange(document.review.sourceFrameMapping,input.range);
  if((document.review.settings?.cuts??[]).some(c=>c>range.startFrame&&c<range.endFrameExclusive))throw new Error('选区跨切镜，请分段绘制。');
  let points=structuredClone(input.points);
  if(input.type==='route'&&(input.pattern??'solid')==='solid'&&points.length===2){const [a,b]=points;points=[a,{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},{x:a.x+2*(b.x-a.x)/3,y:a.y+2*(b.y-a.y)/3},b];}
  return createAnnotation(document,{...input,...range,frame:range.startFrame,space:'court',points,style:{...(input.type==='route'?{pattern:input.pattern??'solid'}:{}),...input.style},
    ...(input.type==='spotlight'&&input.entityId?{anchorMode:'court_player_foot',followEntity:true}:{}),
    actionRange:range,cueFrame:range.startFrame,displayMode:'remaining',curve:input.type==='route'&&(input.pattern??'solid')==='solid'?'cubic_bezier':'polyline',
    progressFrames:[{frame:range.startFrame,t:0},{frame:range.endFrameExclusive,t:1}],meaning:input.meaning??({screen:'screen',spotlight:'focus'}[input.type]??(input.pattern==='dots'?'pass':input.pattern==='dashed'?'later_observed_action':'current_action'))});
}
export function setAnnotationRange(document,id,range,{scope='linked',moveCue=false}={}){
  validateFrameRange(document.review.sourceFrameMapping,range);
  if(!['linked','action','visibility'].includes(scope))throw new Error('范围修改类型无效。');
  const next=structuredClone(document),a=next.annotations?.items.find(a=>a.id===id);if(!a)throw new Error('未找到图形。');
  if((document.review.settings?.cuts??[]).some(c=>c>range.startFrame&&c<range.endFrameExclusive))throw new Error('选区跨切镜，请分段绘制。');
  if(scope!=='action'){
    const cues=(next.tacticKeyframes?.items??[]).filter(k=>k.annotationIds.includes(id)&&(k.frame<range.startFrame||k.frame>=range.endFrameExclusive));
    if((a.anchorFrame<range.startFrame||a.anchorFrame>=range.endFrameExclusive||cues.length)&&!moveCue)throw new Error('讲解点超出新区间；请选择将讲解点移到新区间起点。');
    Object.assign(a,range);if(moveCue){a.anchorFrame=range.startFrame;a.cueFrame=range.startFrame;for(const k of cues)k.frame=range.startFrame;}
  }
  if(scope!=='visibility'){
    const old=a.actionRange??{startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive};
    a.progressFrames=(a.progressFrames??[{frame:old.startFrame,t:0},{frame:old.endFrameExclusive,t:1}]).map(p=>({...p,frame:Math.round(range.startFrame+(p.frame-old.startFrame)/(old.endFrameExclusive-old.startFrame)*(range.endFrameExclusive-range.startFrame))}));
    a.actionRange={...range};
  }
  const issues=validateAnnotations(next.annotations,next);if(issues.length)throw new Error('图形区间无效：'+issues.map(i=>i.details.field).join('、'));return next;
}
