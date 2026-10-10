import {nameDisplaySelected,nameIdentityLabel,layoutNameLabels} from './team-overlay.mjs';
import {COURT} from './court.mjs';

const finite=Number.isFinite;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const observationCache=new WeakMap();
function observationIndex(overlay){
  let index=observationCache.get(overlay);
  if(!index){index=new Map((overlay.playerNameIdentities||[]).map(entity=>[entity.id,new Map((entity.observations||[]).map(point=>[point.frame,point]))]));observationCache.set(overlay,index);}
  return index;
}
function sameSource(review,overlay){
  const source=overlay?.nameIdentitySource;
  return !!source&&['videoSha256','trackingFingerprint','trackingRevision','width','height'].every(key=>(source[key]??null)===(review[key]??null));
}
function boundedIdentity(observation,frame){
  const identity=observation?.nameIdentity;
  if(!identity||!Number.isInteger(identity.start)||!Number.isInteger(identity.end)||frame<identity.start||frame>identity.end||
    identity.trackId!==observation.trackId||typeof identity.name!=='string'||!identity.name.trim())return null;
  return identity;
}

/** Shared preview/export policy. A visible linked spotlight always identifies its subject. */
export function tacticsNameLabels({document,nameOverlay,frame,annotationScene,space='video',showNames}={}){
  const review=document.review,settings={...(nameOverlay?.nameDisplay||{}),
    enabled:showNames??nameOverlay?.nameDisplay?.enabled??false};
  const sourceMatches=sameSource(review,nameOverlay),index=sourceMatches?observationIndex(nameOverlay):null,forced=new Map();
  for(const item of annotationScene?.items||[]){
    const id=item.entityId??item.original?.entityId,geometry=item[space];
    if(item.type==='spotlight'&&id&&geometry?.center&&!item.hiddenReason&&geometry.opacity!==0)forced.set(id,geometry.center);
  }
  const rows=[];
  for(const entity of review.entities||[]){
    if(entity.role!=='player'&&!/^P(?:[1-9]|10)$/.test(entity.id))continue;
    const force=forced.has(entity.id);
    if(!force&&!nameDisplaySelected({...entity,role:'player'},settings))continue;
    const observation=index?.get(entity.id)?.get(frame);
    const observed=observation&&finite(observation.x)&&finite(observation.y);
    const court=review.courtPreparation?.preparedByPlayer?.[entity.id]?.[frame]??entity.courtTrajectory?.find?.(point=>point.frame===frame);
    const point=force?forced.get(entity.id):space==='video'?observed?observation:null:court;
    if(!point||!finite(point.x)||!finite(point.y))continue;
    // Even a manually positioned circle cannot extend name evidence beyond its T/frame.
    const identity=observed?boundedIdentity(observation,frame):null;
    const label=nameIdentityLabel(identity,entity,force?{...settings,showName:true}:settings);
    if(!label)continue;
    rows.push({id:entity.id,x:point.x,y:point.y,label,forced:force,identity,
      ring:!force&&settings.showAnkleRing!==false});
  }
  return rows;
}

/** SVG inner markup in source coordinates, safe to reuse in the raster worker. */
export function renderTacticsNameSVG(options){
  const space=options.space||'video',review=options.document.review;
  const width=space==='video'?review.width:COURT.length,height=space==='video'?review.height:COURT.width;
  const scale=height/720,font=14*scale;
  const rows=tacticsNameLabels(options).map(row=>({...row,height:font,width:Math.min(width-12*scale,
    [...row.label].reduce((sum,char)=>sum+(char.charCodeAt(0)>255?.95:.57)*font,0))}));
  return `<g data-tactics-names="true" pointer-events="none">${layoutNameLabels(rows,width,height,scale).map(row=>{
    const accepted=row.identity?.identityVerified===true||row.identity?.nameStatus==='machine_accepted';
    const color=accepted?'#ffffff':'#ffe09a';
    const ring=row.ring?`<ellipse cx="${row.x}" cy="${row.y}" rx="${20*scale}" ry="${6*scale}" fill="none" stroke="${color}" stroke-width="${2*scale}"/>`:'';
    const connector=Math.abs(row.textX+row.width/2-row.x)>10*scale||row.textY-row.height-row.y>25*scale?
      `<path d="M ${row.x} ${row.y} L ${Math.max(row.textX,Math.min(row.textX+row.width,row.x))} ${row.textY-row.height-4*scale}" fill="none" stroke="#aab4be" stroke-width="${scale}"/>`:'';
    return `<g data-player-name="${escape(row.id)}" data-forced-name="${row.forced}">${ring}${connector}<rect x="${row.textX-5*scale}" y="${row.textY-row.height-4*scale}" width="${row.width+10*scale}" height="${row.height+8*scale}" rx="${3*scale}" fill="#101922" fill-opacity=".92"/><text x="${row.textX}" y="${row.textY-1*scale}" fill="${color}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${font}" font-weight="600">${escape(row.label)}</text></g>`;
  }).join('')}</g>`;
}
