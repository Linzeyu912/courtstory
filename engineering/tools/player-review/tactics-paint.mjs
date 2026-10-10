// Presentation only: shared SVG paint for the canvas and the production rasterizer.
// Geometry, tracking, hit targets, annotation semantics and timing stay upstream.
const coordinates=points=>points.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
const pale=(color,amount=.86)=>'#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*(1-amount)+255*amount).toString(16).padStart(2,'0')).join('');
function glow(id,points,width){
  const pad=width*5,x=Math.min(...points.map(p=>p.x))-pad,y=Math.min(...points.map(p=>p.y))-pad;
  const w=Math.max(...points.map(p=>p.x))-x+pad,h=Math.max(...points.map(p=>p.y))-y+pad;
  return `<filter id="${id}-glow" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${width*.55}"/></filter>`;
}
function gradient(id,points,color,width){
  const a=points[0],b=points.at(-1),same=Math.hypot(a.x-b.x,a.y-b.y)<1e-6;
  return `<linearGradient id="${id}-ink" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${same?b.x+width:b.x}" y2="${b.y}"><stop offset="0" stop-color="${color}" stop-opacity=".6"/><stop offset=".32" stop-color="${pale(color,.55)}"/><stop offset="1" stop-color="${pale(color,.94)}"/></linearGradient>`;
}
function shorten(points,amount){
  const result=points.map(p=>({...p}));
  while(result.length>1){
    const b=result.at(-1),a=result.at(-2),length=Math.hypot(b.x-a.x,b.y-a.y);
    if(length>amount){const t=(length-amount)/length;result[result.length-1]={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};break;}
    amount-=length;result.pop();
  }
  return result;
}
export function renderRoutePaint(g,color,id){
  const width=g.strokeWidth*1.6,points=g.ribbon??g.curve;
  const defs=`<defs>${glow(id,points,width)}${gradient(id,g.curve??points,color,width)}</defs>`;
  if(g.ribbon){
    const polygon=coordinates(g.ribbon);
    return `${defs}<g data-part="authored-ribbon" opacity="${g.opacity}"><polygon points="${polygon}" fill="${color}" opacity=".45" filter="url(#${id}-glow)"/><polygon points="${polygon}" fill="none" stroke="${g.edgeColor}" stroke-width="${g.strokeWidth}" stroke-opacity=".18"/><polygon points="${polygon}" fill="url(#${id}-ink)" stroke="none"/></g>`;
  }
  if(g.pattern==='dots')return `${defs}<g fill="${color}" opacity=".4" filter="url(#${id}-glow)">`+g.dots.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${g.dotRadius*1.3}"/>`).join('')+'</g>'+g.dots.map(p=>`<circle data-part="route-dot" cx="${p.x}" cy="${p.y}" r="${g.dotRadius}" fill="${pale(color,.8)}"/>`).join('');
  const tip=g.arrow[1],base={x:(g.arrow[0].x+g.arrow[2].x)/2,y:(g.arrow[0].y+g.arrow[2].y)/2};
  const oldLength=Math.hypot(tip.x-base.x,tip.y-base.y),ux=(tip.x-base.x)/oldLength,uy=(tip.y-base.y)/oldLength;
  const head=Math.min(oldLength,width*2.5),half=Math.min(Math.hypot(g.arrow[0].x-base.x,g.arrow[0].y-base.y),width*1.1);
  const arrow=coordinates([{x:tip.x-ux*head-uy*half,y:tip.y-uy*head+ux*half},tip,{x:tip.x-ux*head+uy*half,y:tip.y-uy*head-ux*half}]);
  const line=coordinates(shorten(g.curve,head*.7)),dash=g.pattern==='dashed'?` stroke-dasharray="${g.dashArray.join(' ')}"`:'';
  return `${defs}<g data-part="route-glow" opacity=".55" filter="url(#${id}-glow)"><polyline points="${line}" stroke="${color}" stroke-width="${width*1.65}"${dash}/><polygon points="${arrow}" fill="${color}"/></g><polyline points="${line}" stroke="${color}" stroke-opacity=".65" stroke-width="${width*1.25}"${dash}/><polyline data-part="route" points="${line}" stroke="url(#${id}-ink)" stroke-width="${width}"${dash}/><polyline data-part="route-core" points="${line}" stroke="${pale(color,.94)}" stroke-opacity=".85" stroke-width="${width*.42}"${dash}/><polygon data-part="arrow" points="${arrow}" fill="${pale(color,.94)}"/>`;
}

export function renderFootRingPaint(g,color,id,{focus=false}={}){
  const ring=coordinates(g.ring),width=g.strokeWidth*(focus?1.8:1),tint=focus?'#8feaff':color;
  const center=g.center,rx=Math.max(width,...g.ring.map(p=>Math.abs(p.x-center.x))),ry=Math.max(width,...g.ring.map(p=>Math.abs(p.y-center.y)));
  return `<defs>${glow(id,g.ring,width)}<radialGradient id="${id}-pool"><stop offset="0" stop-color="${tint}" stop-opacity="${focus?.26:.1}"/><stop offset=".62" stop-color="${tint}" stop-opacity="${focus?.14:.05}"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient></defs><ellipse data-part="${focus?'focus':'position'}-halo" cx="${center.x}" cy="${center.y}" rx="${rx*1.45}" ry="${ry*1.7}" fill="url(#${id}-pool)"/><polygon points="${ring}" fill="none" stroke="${tint}" stroke-width="${width*3}" opacity="${focus?.75:.4}" filter="url(#${id}-glow)"/><polygon data-part="${focus?'focus-ring':'position-mark'}" points="${ring}" fill="${tint}" fill-opacity="${focus?.07:.025}" stroke="${tint}" stroke-width="${width*1.65}" stroke-opacity=".55"/><polygon data-part="${focus?'focus-ring-core':'position-ring'}" points="${ring}" stroke="${focus?'#ffffff':pale(color,.88)}" stroke-width="${width}"/>`;
}

export function renderScreenPaint(g,color,id){
  const points=g.paths.flat(),width=g.strokeWidth*.8;
  return `<defs>${glow(id,points,width)}</defs>`+g.paths.map((path,i)=>{
    const line=coordinates(path),stroke=width*(i?.55:1);
    return `<polyline data-part="screen-glow" points="${line}" stroke="${color}" stroke-width="${stroke*2}" opacity=".5" filter="url(#${id}-glow)"/><polyline data-part="screen-bar" points="${line}" stroke="${pale(color,.85)}" stroke-width="${stroke}"/>`;
  }).join('');
}
