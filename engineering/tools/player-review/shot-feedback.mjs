import {canonicalJSON} from '../tactical-overlay/binding.mjs';

export const SHOT_RELEASE_HOLD_SECONDS=2.5;
export const SHOT_FEEDBACK_COLORS=Object.freeze({green:'#75d9a4',yellow:'#ffe052',red:'#f0837e',unknown:'#a9b6c0'});
const opportunity=Object.freeze({good:{label:'好',tone:'green'},fair:{label:'一般',tone:'yellow'},poor:{label:'不佳',tone:'red'},unknown:{label:'未知',tone:'unknown'}});
const pressure=Object.freeze({low:{label:'低',tone:'green'},medium:{label:'中度',tone:'yellow'},high:{label:'高',tone:'red'},unknown:{label:'未知',tone:'unknown'}});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const frame=value=>Number.isSafeInteger(value)&&value>=0;
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const n=value=>Number(value.toFixed(5));
const metric=(value,grades)=>exact(value,['grade','reason'])&&Object.hasOwn(grades,value.grade)&&typeof value.reason==='string'&&value.reason.length<=2000;

/** Invalid links remain editable stale data. Only malformed persisted data fails validation. */
export function validateShotFeedback(document){
  const value=document.shotFeedback;if(value===undefined)return;
  if(!exact(value,['schemaVersion','items'])||value.schemaVersion!==1||!Array.isArray(value.items)||value.items.length>256)throw new Error('投篮反馈格式无效。');
  const ids=new Set(),nodes=new Set(),frames=new Set();
  for(const item of value.items){
    const ref=item?.commentaryPlanRef;
    if(!exact(item,['id','nodeId','eventId','frame','spotlightAnnotationId','shooterRef','opportunity','pressure','commentaryPlanRef'])||
       !['id','nodeId','eventId','spotlightAnnotationId','shooterRef'].every(key=>text(item[key]))||ids.has(item.id)||nodes.has(item.nodeId)||frames.has(item.frame)||
       !frame(item.frame)||item.frame>=document.review.sourceFrameMapping.length||!metric(item.opportunity,opportunity)||!metric(item.pressure,pressure)||
       !exact(ref,['planId','revision','digest'])||!text(ref.planId)||!Number.isSafeInteger(ref.revision)||ref.revision<1||!/^[a-f0-9]{64}$/.test(ref.digest??''))throw new Error('投篮反馈内容无效。');
    ids.add(item.id);nodes.add(item.nodeId);frames.add(item.frame);
  }
}

export function shotFeedbackStatus(document){
  validateShotFeedback(document);
  const active=[],stale=[];
  for(const item of document.shotFeedback?.items??[]){
    const annotation=document.annotations?.items.find(a=>a.id===item.spotlightAnnotationId);
    let reason=null;
    if(!annotation||annotation.type!=='spotlight')reason='spotlight_missing';
    else if(annotation.anchorFrame!==item.frame||item.frame<annotation.startFrame||item.frame>=annotation.endFrameExclusive)reason='release_frame_changed';
    else{
      const run=document.agentRuns?.find(run=>run.jobId===annotation.origin?.jobId)||document.agentRuns?.find(run=>
        run.manualConfirmations?.some(record=>record.annotationId===annotation.id)&&run.annotationNodeRefs?.[annotation.id]===item.nodeId);
      if((annotation.origin||run)&&(!run?.commentaryPlanRef||!equal(run.commentaryPlanRef,item.commentaryPlanRef)||!run.nodeIds?.includes(item.nodeId)||
         run.annotationNodeRefs?.[annotation.id]!==item.nodeId))reason='commentary_link_changed';
      else{
        const shooters=run?.shotParticipantSnapshot?.filter(person=>person.participantId===item.shooterRef)??[];
        // Anonymous manual feedback has no Agent snapshot. Named Agent feedback
        // must keep the saved shooter's identity even after editable rebindings.
        if(run&&(shooters.length!==1||!Object.hasOwn(shooters[0],'entityId')||shooters[0].entityId!==annotation.entityId)||
           !run&&annotation.entityId!==null)reason='shooter_identity_changed';
        else if(!document.tacticKeyframes?.items.some(cue=>cue.frame===item.frame&&cue.freeze&&cue.holdSeconds>=SHOT_RELEASE_HOLD_SECONDS&&cue.annotationIds.includes(annotation.id)))reason='release_hold_missing';
      }
    }
    if(reason)stale.push({...structuredClone(item),reason});else active.push(structuredClone(item));
  }
  return {active,stale};
}

/** Visibility is determined after ordinary annotation geometry and source checks. */
export function projectShotFeedback(document,{frame:currentFrame,freeze,items,width,height}){
  if(!freeze)return [];
  const visible=new Set(items.filter(item=>{
    const g=item.video;if(item.type!=='spotlight'||!g||(g.opacity??1)<=0||!Array.isArray(g.ring))return false;
    const xs=g.ring.map(p=>p.x),ys=g.ring.map(p=>p.y);
    return Math.max(...xs)>0&&Math.min(...xs)<width&&Math.max(...ys)>0&&Math.min(...ys)<height;
  }).map(item=>item.id));
  return shotFeedbackStatus(document).active.filter(item=>item.frame===currentFrame&&visible.has(item.spotlightAnnotationId));
}

/** Browser SVG and Sharp rasterization share the approved v4 HUD geometry. */
export function renderShotFeedbackSVG(scene){
  if(!scene.shotFeedback?.length)return '';
  const width=scene.width,height=scene.height,scale=width/1600,x=n(width*.34),y=n(height*.05),boxWidth=n(width*.189),boxHeight=n(width*.0645);
  const id=`shot-feedback-${scene.frame}`,parts=[`<defs><linearGradient id="${id}-background" x1="0" y1="0" x2="100%" y2="70%"><stop offset="0" stop-color="#142b3a" stop-opacity="${238/255}"/><stop offset="1" stop-color="#1b303d" stop-opacity="${220/255}"/></linearGradient></defs>`];
  for(const item of scene.shotFeedback){
    parts.push(`<g data-part="shot-feedback" data-node-id="${escape(item.nodeId)}" data-opportunity-grade="${item.opportunity.grade}" data-pressure-grade="${item.pressure.grade}" transform="translate(${x},${y})" pointer-events="none" font-family="Microsoft YaHei UI,Microsoft YaHei,Noto Sans SC,sans-serif">`);
    parts.push(`<rect data-part="shot-feedback-box" width="${boxWidth}" height="${boxHeight}" rx="${n(8.064*scale)}" fill="url(#${id}-background)" stroke="#dbe7eb" stroke-opacity="${41/255}" stroke-width="${n(1.2*scale)}"/>`);
    for(const [index,key,title,gradeMap] of [[0,'opportunity','投篮机会',opportunity],[1,'pressure','防守压力',pressure]]){
      const value=gradeMap[item[key].grade],color=SHOT_FEEDBACK_COLORS[value.tone],cy=n((index?69.072:34.128)*scale);
      parts.push(`<g data-metric="${key}" data-color="${color}"><text x="${n(18.048*scale)}" y="${n(cy+5.304*scale)}" fill="#b7c8d0" font-size="${n(15.6*scale)}" letter-spacing="${n(.384*scale)}">${title}</text>`);
      parts.push(`<text x="${n(215.808*scale)}" y="${n(cy+6.528*scale)}" text-anchor="end" fill="${color}" font-size="${n(19.2*scale)}" font-weight="650" letter-spacing="${n(1.056*scale)}">${value.label}</text>`);
      for(const [signal,tone] of ['green','yellow','red'].entries()){
        const active=value.tone===tone,paint=value.tone==='unknown'?SHOT_FEEDBACK_COLORS.unknown:SHOT_FEEDBACK_COLORS[tone];
        parts.push(`<rect data-signal="${tone}" data-active="${active}" x="${n((230.592+19.392*signal)*scale)}" y="${n(cy-3.744*scale)}" width="${n(14.976*scale)}" height="${n(7.488*scale)}" rx="${n(1.92*scale)}" fill="${paint}" opacity="${active?1:value.tone==='unknown'?.25:.23}"${active?` stroke="${paint}" stroke-width="${n(.96*scale)}"`:''}/>`);
      }
      parts.push('</g>');
    }
    parts.push('</g>');
  }
  return parts.join('');
}
