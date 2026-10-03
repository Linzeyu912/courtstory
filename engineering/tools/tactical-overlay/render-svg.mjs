/** Manifest-only renderer. Self-contained so the same function runs in the offline HTML. */
export function renderOverlaySvg(manifest,{mode='court',viewport={width:1280,height:720}}={}) {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value.toFixed(3));
  const {width,height}=viewport;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new TypeError('viewport requires positive CSS pixel dimensions');
  if(!['video','court'].includes(mode))throw new TypeError('mode must be video or court');
  if(!manifest||manifest.schemaVersion!==1)throw new TypeError('Manifest v1 required');
  const root=body=>`<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}" role="img" data-mode="${mode}" data-phase-id="${escape(manifest.phaseId)}" data-freeze-frame="${escape(manifest.freezeFrame)}"><title>${escape(manifest.synthetic?'合成规则演示':'战术冻结帧')} · ${escape(manifest.phaseId)}</title>${body}</svg>`;
  if(manifest.status==='refused')return root('<text x="24" y="42" fill="#f8fafc" font-size="20">拒绝叠加：来源或输入未通过校验</text>');
  if(mode==='video'&&!manifest.videoOverlay?.available)throw new Error('video overlay unavailable: use explicit court 2D');
  const dimensions=mode==='video'?manifest.videoOverlay:manifest.court2d;
  const sourceWidth=mode==='video'?dimensions.width:dimensions.length,sourceHeight=mode==='video'?dimensions.height:dimensions.width;
  if(!Number.isFinite(sourceWidth)||!Number.isFinite(sourceHeight)||sourceWidth<=0||sourceHeight<=0)throw new TypeError('manifest coordinate dimensions unavailable');
  const padding=mode==='court'?Math.min(30,width*.035,height*.05):0;
  const scale=Math.min((width-padding*2)/sourceWidth,(height-padding*2)/sourceHeight);
  const offsetX=(width-sourceWidth*scale)/2,offsetY=(height-sourceHeight*scale)/2;
  const coordinate=point=>{
    const p=mode==='video'?point?.freezePoint:point?.courtPoint;
    return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:number(offsetX+p.x*scale),y:number(offsetY+p.y*scale)}:null;
  };
  const pair=p=>`${number(p.x)},${number(p.y)}`;
  const positive=(v,fallback)=>Number.isFinite(v)&&v>0?v:fallback;
  const lineWidth=positive(manifest.styleHints?.lineWidth,6),head=positive(manifest.styleHints?.arrowHeadSize,18),outline=positive(manifest.styleHints?.outlineWidth,2);
  const palette=['#59dfff','#ffd45a','#ff8ec7','#9feb78','#c7a4ff','#ff9b60','#f5f5f5','#77e0c5'];
  const roster=manifest.roster??[],colour=id=>palette[Math.max(0,roster.findIndex(p=>p.id===id))%palette.length];
  const labels={hold:'原地保持',space:'拉开空间',screen:'掩护',move:'移动',cut:'切入',roll:'顺下',pop:'外弹',offense:'进攻',defender:'防守',active:'进行中',pending:'后续',completed:'已完成'};
  const temporal=(item)=>`data-temporal-status="${escape(item.temporalStatus)}" opacity="${Number.isFinite(item.opacity)?item.opacity:item.temporalStatus==='completed'?(manifest.styleHints?.completedOpacity??.3):1}"`;
  const routeObstacles=[];
  const reserveStroke=(points,strokeWidth,squareCaps=false)=>{
    // Include the painted outline/caps plus a small clearance from the label's own border.
    const padding=strokeWidth/2*(squareCaps?Math.SQRT2:1)+2;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];routeObstacles.push({a,b,padding,
        left:Math.min(a.x,b.x)-padding,right:Math.max(a.x,b.x)+padding,top:Math.min(a.y,b.y)-padding,bottom:Math.max(a.y,b.y)+padding});
    }
  };
  const reserveHead=points=>{
    const padding=outline/2+2;
    routeObstacles.push({left:Math.min(...points.map(p=>p.x))-padding,right:Math.max(...points.map(p=>p.x))+padding,
      top:Math.min(...points.map(p=>p.y))-padding,bottom:Math.max(...points.map(p=>p.y))+padding});
  };
  let body=`<desc>${escape(roster.map(p=>`${p.id} ${p.name??p.id}：${p.positionState}；${(p.roles??[]).map(r=>labels[r]??r).join('、')}`).join('\n'))}</desc>`;
  body+=`<metadata>${escape(JSON.stringify({sourceBinding:manifest.sourceBinding,phaseId:manifest.phaseId,freezeFrame:manifest.freezeFrame,sourceFrame:manifest.sourceFrame,sourceTime:manifest.sourceTime}))}</metadata>`;
  if(mode==='court'){
    const x=number(offsetX),y=number(offsetY),w=number(sourceWidth*scale),h=number(sourceHeight*scale);
    body+=`<rect width="${number(width)}" height="${number(height)}" fill="#102a30"/><g stroke="#47737a" stroke-width="2" fill="none"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${number(width/2)}" y1="${y}" x2="${number(width/2)}" y2="${number(y+h)}"/><circle cx="${number(width/2)}" cy="${number(height/2)}" r="${number(Math.min(w,h)*.12)}"/></g><text x="16" y="24" fill="#b6d4d7" font-size="14">${manifest.synthetic?'合成规则演示 · ':''}仅 2D 球场示意</text>`;
  }
  for(const path of manifest.paths??[]){
    if(path.renderability==='unavailable')continue;
    const stroke=colour(path.entityId),dash=path.lineStyle==='dashed'?' stroke-dasharray="12 10"':'';
    body+=`<g data-action-id="${escape(path.actionId)}" data-entity-id="${escape(path.entityId)}" ${temporal(path)}>`;
    for(const segment of path.segments??[]){
      // A missing coordinate ends a subpath. It is never filtered out to join its neighbours.
      const runs=[];let run=[];
      for(const point of segment.points??[]){const p=coordinate(point);if(p)run.push(p);else{if(run.length)runs.push(run);run=[];}}
      if(run.length)runs.push(run);
      body+=`<desc>${escape(JSON.stringify({breakBefore:segment.breakBefore,breakAfter:segment.breakAfter,points:segment.points}))}</desc>`;
      for(const points of runs){
        if(points.length<2)continue;
        const list=points.map(pair).join(' ');
        body+=`<polyline points="${list}" fill="none" stroke="#102029" stroke-width="${lineWidth+outline*2}" stroke-linejoin="round" stroke-linecap="round"${dash}/><polyline points="${list}" fill="none" stroke="${stroke}" stroke-width="${lineWidth}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
        reserveStroke(points,lineWidth+outline*2);
      }
      // The engine decides whether this valid segment has direction. Never extend its route.
      if(segment.arrow&&runs.length===1&&runs[0].length===(segment.points??[]).length){
        const points=runs[0],tip=points.at(-1),previous=points.slice(0,-1).reverse().find(p=>p.x!==tip.x||p.y!==tip.y);
        if(previous){const dx=tip.x-previous.x,dy=tip.y-previous.y,d=Math.hypot(dx,dy),ux=dx/d,uy=dy/d;
          const left={x:tip.x-head*ux-head*.5*uy,y:tip.y-head*uy+head*.5*ux},right={x:tip.x-head*ux+head*.5*uy,y:tip.y-head*uy-head*.5*ux};
          body+=`<polygon data-kind="arrowhead" points="${pair(tip)} ${pair(left)} ${pair(right)}" fill="${stroke}" stroke="#102029" stroke-width="${outline}" stroke-linejoin="round"/>`;
          reserveHead([tip,left,right]);
        }
      }
    }
    body+='</g>';
  }
  for(const relation of manifest.relations??[]){
    if(relation.renderability==='unavailable'||!relation.bar)continue;
    const raw=mode==='video'?relation.bar.freeze:relation.bar.court;
    if(!Array.isArray(raw)||raw.length!==2)continue;
    const points=raw.map(p=>coordinate(mode==='video'?{freezePoint:p}:{courtPoint:p}));if(points.some(p=>!p))continue;
    const list=points.map(pair).join(' '),stroke=colour(relation.screenerId);
    body+=`<g data-relation-id="${escape(relation.relationId??relation.id)}" ${temporal(relation)}><desc>${escape(JSON.stringify(relation.bar))}</desc><polyline points="${list}" fill="none" stroke="#102029" stroke-width="${lineWidth+outline*2}" stroke-linecap="square"/><polyline points="${list}" fill="none" stroke="${stroke}" stroke-width="${lineWidth}" stroke-linecap="square"/></g>`;
    reserveStroke(points,lineWidth+outline*2,true);
  }
  // Labels share the viewport's CSS-pixel space. Data points stay untouched; only text boxes move.
  // A fixed text advance makes bounds deterministic in Node and browser font environments alike.
  const fontSize=12,lineHeight=18,labelPadding=6,margin=8;
  const textWidth=text=>number([...text].reduce((sum,c)=>sum+(c.codePointAt(0)<=255?.65:1.02)*fontSize,0));
  const wrap=text=>{
    const lines=[],limit=Math.max(fontSize,Math.min(184,width-margin*2)-labelPadding*2);let line='';
    for(const c of text){if(line&&textWidth(line+c)>limit){lines.push(line);line='';}line+=c;}
    if(line)lines.push(line);return lines;
  };
  const grouped=new Map(),markerLabels=new Map(),drawable=[];
  for(const marker of manifest.markers??[]){
    if(marker.renderability==='unavailable')continue;
    const p=coordinate(marker.position);if(!p)continue;
    const key=`${marker.entityId}|${p.x}|${p.y}`;
    if(!grouped.has(key))grouped.set(key,{id:`label-${grouped.size}`,entityId:marker.entityId,anchor:p,markers:[],lines:[]});
    const group=grouped.get(key);group.markers.push(marker);markerLabels.set(marker,group);drawable.push({marker,p,key});
  }
  const absent=roster.filter(p=>!coordinate(p.position)).map(p=>`${p.id}：${p.positionState==='offscreen'?'画面外':'位置不可用'}`);
  const groups=[...grouped.values()];
  for(const group of groups){
    const add=(text,status=null)=>group.lines.push(...wrap(text).map(text=>({text,status})));
    const current=group.markers.some(m=>m.kind!=='future_action_start');
    if(current)add(`${group.entityId} · 冻结位 F${manifest.freezeFrame}`);
    for(const [status,prefix] of [['active','当前'],['pending','后续'],['completed','已完成']]){
      const roles=[...new Set(group.markers.filter(m=>m.kind==='static_role'&&m.temporalStatus===status).map(m=>labels[m.role]??m.role??'静态站位'))];
      if(roles.length)add(`${prefix}：${roles.join('、')}`,status);
    }
    const future=new Map();
    for(const marker of group.markers.filter(m=>m.kind==='future_action_start')){
      const source=marker.position.sourceFrame??'未知';if(!future.has(source))future.set(source,new Set());
      if(marker.role)future.get(source).add(labels[marker.role]??marker.role);
    }
    for(const [source,roles] of future){add(`后续起点·${group.entityId}/帧${source}`,'pending');if(roles.size)add([...roles].join('、'),'pending');}
    group.width=Math.ceil(Math.max(...group.lines.map(l=>textWidth(l.text)))+labelPadding*2);
    group.height=group.lines.length*lineHeight+10;
  }
  const top=mode==='court'?((manifest.issues??[]).length?54:34):(manifest.issues??[]).length?34:margin;
  const bottom=absent.length?34:margin,placed=[];
  const overlaps=(a,b,gap=5)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
  const anchors=groups.map(g=>({x:g.anchor.x-12,y:g.anchor.y-12,width:24,height:24}));
  const coversRoute=box=>routeObstacles.some(obstacle=>{
    if(box.x>obstacle.right||box.x+box.width<obstacle.left||box.y>obstacle.bottom||box.y+box.height<obstacle.top)return false;
    if(!obstacle.a)return true; // Entire painted arrowhead bounds, including outline.
    // Clip the actual straight stroke segment against the label expanded by its painted radius.
    // Testing each segment avoids reserving an entire curved route's large bounding rectangle.
    const {a,b,padding}=obstacle;let enter=0,exit=1;
    for(const [start,delta,min,max] of [[a.x,b.x-a.x,box.x-padding,box.x+box.width+padding],[a.y,b.y-a.y,box.y-padding,box.y+box.height+padding]]){
      if(delta===0){if(start<min||start>max)return false;}
      else {const t1=(min-start)/delta,t2=(max-start)/delta;enter=Math.max(enter,Math.min(t1,t2));exit=Math.min(exit,Math.max(t1,t2));if(enter>exit)return false;}
    }
    return true;
  });
  // Taller groups go first. Exhaustive bounded candidate positions provide deterministic collision
  // avoidance in crowded scenes; distance chooses the closest free label, never a new data point.
  for(const group of [...groups].sort((a,b)=>b.height-a.height||groups.indexOf(a)-groups.indexOf(b))){
    const maxX=width-margin-group.width,maxY=height-bottom-group.height;
    const xs=new Set([margin,maxX]),ys=new Set([top,maxY]);
    for(const x of [group.anchor.x+16,group.anchor.x-group.width-16,group.anchor.x-group.width/2])xs.add(Math.max(margin,Math.min(maxX,x)));
    for(const y of [group.anchor.y-group.height-16,group.anchor.y+16,group.anchor.y-group.height/2])ys.add(Math.max(top,Math.min(maxY,y)));
    for(let x=margin;x<=maxX;x+=8)xs.add(x);for(let y=top;y<=maxY;y+=8)ys.add(y);
    for(const box of placed){xs.add(box.x+box.width+6);xs.add(box.x-group.width-6);ys.add(box.y+box.height+6);ys.add(box.y-group.height-6);}
    let best=null,bestScore=Infinity;
    for(const y of ys)for(const x of xs){
      if(x<margin||x>maxX||y<top||y>maxY)continue;
      const box={x,y,width:group.width,height:group.height};
      if(placed.some(other=>overlaps(box,other))||anchors.some(other=>overlaps(box,other,1))||coversRoute(box))continue;
      const dx=Math.max(x-group.anchor.x,0,group.anchor.x-x-group.width),dy=Math.max(y-group.anchor.y,0,group.anchor.y-y-group.height);
      const score=dx*dx+dy*dy+Math.hypot(x+group.width/2-group.anchor.x,y+group.height/2-group.anchor.y)*.01;
      if(score<bestScore){bestScore=score;best=box;}
    }
    if(!best)throw new RangeError('viewport has insufficient space for all annotation labels');
    group.box=best;placed.push(best);
  }
  for(const group of groups){
    const {x,y,width:w,height:h}=group.box,p=group.anchor;
    const end={x:Math.max(x,Math.min(x+w,p.x)),y:Math.max(y,Math.min(y+h,p.y))};
    body+=`<line data-kind="label-leader" data-label-id="${group.id}" data-entity-id="${escape(group.entityId)}" x1="${p.x}" y1="${p.y}" x2="${number(end.x)}" y2="${number(end.y)}" stroke="${colour(group.entityId)}" stroke-width="1.5"${group.markers.every(m=>m.kind==='future_action_start')?' stroke-dasharray="3 3"':''}/>`;
  }
  const shown=new Set();
  for(const {marker,p,key} of drawable){
    const stroke=colour(marker.entityId),group=markerLabels.get(marker);
    body+=`<g data-kind="${escape(marker.kind)}" data-entity-id="${escape(marker.entityId)}" data-frame="${escape(marker.position.frame)}" data-source-frame="${escape(marker.position.sourceFrame)}" data-label-id="${group.id}" aria-describedby="${group.id}" ${temporal(marker)}><desc>${escape(JSON.stringify(marker.position))}</desc>`;
    if(marker.kind==='future_action_start')body+=`<circle cx="${p.x}" cy="${p.y}" r="10" fill="none" stroke="${stroke}" stroke-width="${outline}" stroke-dasharray="4 4"/>`;
    else if(!shown.has(key)){shown.add(key);body+=`<circle cx="${p.x}" cy="${p.y}" r="8" fill="${stroke}" stroke="#102029" stroke-width="${outline}"/>`;}
    body+='</g>';
  }
  for(const group of groups){
    const {x,y,width:w,height:h}=group.box;
    body+=`<g data-kind="annotation-label" data-label-id="${group.id}" data-entity-id="${escape(group.entityId)}" data-anchor-x="${group.anchor.x}" data-anchor-y="${group.anchor.y}" id="${group.id}"><rect data-kind="label-bounds" x="${number(x)}" y="${number(y)}" width="${w}" height="${h}" rx="4" fill="#091c27" fill-opacity="0.94" stroke="${colour(group.entityId)}" stroke-width="1"/>`;
    group.lines.forEach((line,i)=>{body+=`<text x="${number(x+labelPadding)}" y="${number(y+17+i*lineHeight)}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${fontSize}" font-weight="600" textLength="${textWidth(line.text)}" lengthAdjust="spacingAndGlyphs" fill="${line.status==='completed'?'#b7c8d3':'#f4f8fb'}"${line.status?` data-temporal-status="${line.status}"`:''}>${escape(line.text)}</text>`;});
    body+='</g>';
  }
  if(absent.length)body+=`<text x="16" y="${number(height-18)}" fill="#ffdf9e" stroke="#102029" stroke-width="3" paint-order="stroke" font-family="system-ui, sans-serif" font-size="13">${escape(absent.join(' · '))}</text>`;
  if((manifest.issues??[]).length)body+=`<text x="16" y="${mode==='court'?44:24}" fill="#ffdf9e" stroke="#102029" stroke-width="3" paint-order="stroke" font-family="system-ui, sans-serif" font-size="13">质量提醒：${manifest.issues.length} 项待核或缺口，详见画面外清单</text>`;
  return root(body);
}
