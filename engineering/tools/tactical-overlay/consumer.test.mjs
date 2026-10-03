import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,access,unlink,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {buildTacticalOverlay} from './overlay.mjs';
import {createSourceBinding} from './binding.mjs';
import {makeBoundaryFixture,makePresentationFixture} from './fixtures/synthetic.mjs';
import {makePresentationDemo} from './fixtures/presentation-demo.mjs';
import {makeCandidateFixture} from './fixtures/005-candidate/generate.mjs';
import {renderOverlaySvg} from './render-svg.mjs';
import {buildPreviewHtml} from './preview.mjs';
import {exportPreview} from './export.mjs';
const renderer=()=>renderOverlaySvg,preview=()=>buildPreviewHtml,exporter=()=>exportPreview;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const options={maxSpeedMetresPerSecond:100};
async function manifest(freezeFrame=1,phaseId='S1'){
  const input=await makeBoundaryFixture();return buildTacticalOverlay({...input,freezeFrame,phaseId,options});
}
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'tactical-consumer-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
// Valid tiny JPEG: tests verify bytes/provenance, browser QA uses independently extracted real frames.
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAf/2Q==','base64');
async function realInput(dir){
  const input=await makeBoundaryFixture();input.review.synthetic=false;input.playDefinition.synthetic=false;
  input.review.videoSha256='a'.repeat(64);input.review.sourceVideoSha256='b'.repeat(64);
  input.playDefinition.sourceBinding=await createSourceBinding(input.review);
  const frames={videoSha256:input.review.videoSha256,sourceBinding:input.playDefinition.sourceBinding,frames:[]};
  for(const frame of [1,2]){
    // JPEG COM segment makes the two actual byte assets distinct, without changing image encoding.
    const bytes=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,254,0,3,frame]),jpeg.subarray(2)]);
    const file=`frame-${frame}.jpg`;await writeFile(join(dir,file),bytes);
    frames.frames.push({frame,time:input.review.sourceFrameMapping[frame].time,file,sha256:digest(bytes)});
  }
  return {...input,frames,framesDirectory:dir,options};
}

test('svg_preserves_meaning: complete points, CSS pixel strokes and segment direction survive resize',async()=>{
  const render=renderer(),m=await manifest(),snapshot=JSON.stringify(m);
  for(const [width,height,points,head] of [[1280,720,'20,20 40,20 60,20','60,20 42,29 42,11'],[640,360,'10,10 20,10 30,10','30,10 12,19 12,1']]){
    const svg=render(m,{mode:'video',viewport:{width,height}});
    assert.match(svg,new RegExp(`points="${points}"`));assert.match(svg,new RegExp(`points="${head}"`));
    assert.match(svg,/stroke-width="6"/);assert.match(svg,/stroke-width="2"/);
    assert.match(svg,/data-action-id="A"[^>]*data-temporal-status="active"/);
    assert.match(svg,/data-action-id="B"[^>]*data-temporal-status="pending"/);
    assert.match(svg,/stroke-dasharray="12 10"/);assert.match(svg,/P3/);
  }
  assert.equal(JSON.stringify(m),snapshot);
});

test('svg_preserves_meaning: completed paths fade, warning does not change active line semantics',async()=>{
  const render=renderer(),completed=await manifest(3,'S2');
  assert.match(render(completed,{mode:'video',viewport:{width:640,height:360}}),/data-action-id="A"[^>]*data-temporal-status="completed"[^>]*opacity="0.3"/);
  const input=await makeBoundaryFixture();input.playDefinition.reviewEvidence=input.playDefinition.reviewEvidence.filter(e=>e.domain!=='position');
  const m=await buildTacticalOverlay({...input,freezeFrame:1,phaseId:'S1',options});
  assert.equal(m.actions.find(a=>a.actionId==='A').renderability,'warning');
  const svg=render(m,{mode:'video',viewport:{width:640,height:360}});
  const a=svg.match(/<g data-action-id="A"[\s\S]*?<\/g>/)?.[0];
  assert.ok(a);assert.doesNotMatch(a,/stroke-dasharray/);assert.match(svg,/质量/);
});

test('svg_preserves_meaning: all participants, static roles, screen bar and escaped names remain',async()=>{
  const render=renderer(),input=await makePresentationFixture();input.playDefinition.participants[0].name='<img onerror="x"> & P1';
  const m=await buildTacticalOverlay({...input,phaseId:'setup',freezeFrame:2});
  const svg=render(m,{mode:'video',viewport:{width:1280,height:720}});
  for(const id of ['P1','P2','P3','P4','P5','P6'])assert.match(svg,new RegExp(`data-entity-id="${id}"`));
  assert.match(svg,/data-relation-id="screen-relation"/);assert.match(svg,/data-kind="static_role"/);
  assert.match(svg,/&lt;img onerror=&quot;x&quot;&gt; &amp; P1/);assert.doesNotMatch(svg,/<img onerror/);
  assert.ok(!m.paths.some(p=>['space','hold','defend','screen'].includes(p.actionId)));
  assert.doesNotMatch(svg,/data-action-id="(?:space|hold|defend|screen)" data-temporal-status/);
});

test('svg refuses unavailable video projection, 2D never borrows image pixels or bridges breaks',async()=>{
  const render=renderer(),m=await manifest();m.videoOverlay.available=false;
  assert.throws(()=>render(m,{mode:'video',viewport:{width:640,height:360}}),/video.*unavailable/i);
  const court=render(m,{mode:'court',viewport:{width:1280,height:720}});assert.match(court,/2D/);assert.match(court,/data-mode="court"/);
  const p=m.paths.find(p=>p.actionId==='A');p.segments=[{...p.segments[0],arrow:false,points:[p.segments[0].points[0]]},{...p.segments[0],arrow:false,points:[p.segments[0].points[2]]}];
  const isolated=render(m,{mode:'court',viewport:{width:1280,height:720}}).match(/<g data-action-id="A"[\s\S]*?<\/g>/)?.[0];
  assert.ok(isolated);assert.doesNotMatch(isolated,/<polyline/);
});

test('consumer_source_and_stage: real assets bind exact mapping, bytes and engine manifest; inputs stay untouched',async t=>{
  const run=exporter(),dir=await temporary(t),input=await realInput(dir),before=JSON.stringify(input);
  const outDirectory=join(dir,'out'),result=await run({...input,outDirectory,title:'真实候选测试'});
  assert.equal(result.scenes.length,2);assert.equal(JSON.stringify(input),before);
  for(const [i,frame] of [[0,1],[1,2]]){
    const s=result.scenes[i],saved=JSON.parse(await readFile(join(outDirectory,s.manifestFile),'utf8'));
    const expected=await buildTacticalOverlay({...input,phaseId:['S1','S2'][i],freezeFrame:frame});
    assert.deepEqual(saved,expected);assert.equal(s.background.frame,frame);
    assert.equal(s.background.sha256,digest(await readFile(join(dir,`frame-${frame}.jpg`))));
    assert.match(s.background.dataUrl,/^data:image\/jpeg;base64,/);
    assert.equal(digest(Buffer.from(s.background.dataUrl.split(',')[1],'base64')),s.background.sha256);
  }
  const index=JSON.parse(await readFile(join(outDirectory,'source-index.json'),'utf8'));
  assert.deepEqual(index.sourceBinding,input.playDefinition.sourceBinding);assert.deepEqual(index.scenes.map(s=>s.freezeFrame),[1,2]);
  assert.equal(result.scenes[0].background.dataUrl===result.scenes[1].background.dataUrl,false);
  assert.equal((await readdir(dir)).filter(f=>f.startsWith('frame-')).length,2);
});

test('consumer_source_and_stage: rejects stale hashes, video binding, wrong frame/time and missing stage assets before output',async t=>{
  const run=exporter(),dir=await temporary(t),input=await realInput(dir);
  const mutations=[
    ['sha',f=>{f.frames[0].sha256='0'.repeat(64);}],['video',f=>{f.videoSha256='c'.repeat(64);}],
    ['binding',f=>{f.sourceBinding.reviewDigest='d'.repeat(64);}],['time',f=>{f.frames[0].time+=.01;}],
    ['frame',f=>{f.frames[0].frame=0;}],['missing',f=>{f.frames.pop();}],
    ['source-frame',f=>{f.frames[0].sourceFrame=900;}],['source-time',f=>{f.frames[0].sourceTime=900;}],
    ['missing-file',f=>{f.frames[0].file='gone.jpg';}],['duplicate',f=>{f.frames.push({...f.frames[0]});}]
  ];
  for(const [name,change] of mutations){const frames=structuredClone(input.frames);change(frames);const outDirectory=join(dir,name);
    await assert.rejects(()=>run({...input,frames,outDirectory}),undefined,name);await assert.rejects(()=>access(outDirectory));
  }
  // The review itself must also agree with the engine's binding, even when frame JPEGs have valid hashes.
  const review=structuredClone(input.review);review.confirmedAt='changed';
  await assert.rejects(()=>run({...input,review,outDirectory:join(dir,'stale-review')}),/refused|binding/i);
});

test('consumer_source_and_stage: failed re-export replaces own stale entry page with explicit refusal and no overlay',async t=>{
  const run=exporter(),dir=await temporary(t),input=await realInput(dir),outDirectory=join(dir,'out');
  await run({...input,outDirectory});const frames=structuredClone(input.frames);frames.frames[0].sha256='0'.repeat(64);
  await assert.rejects(()=>run({...input,frames,outDirectory}));
  const html=await readFile(join(outDirectory,'index.html'),'utf8');assert.match(html,/拒绝/);assert.doesNotMatch(html,/<svg|data:image|scene-data/);
});

test('consumer_source_and_stage: no frames exports clearly labelled synthetic or real 2D scenes',async t=>{
  const run=exporter(),dir=await temporary(t),input=await makeBoundaryFixture();
  const synthetic=await run({...input,outDirectory:join(dir,'synthetic'),options});
  assert.ok(synthetic.scenes.every(s=>s.mode==='court'&&s.background===null));
  const html=await readFile(join(dir,'synthetic','index.html'),'utf8');assert.match(html,/合成规则演示/);
  const real=await realInput(dir);const {frames,...withoutFrames}=real;
  const result=await run({...withoutFrames,outDirectory:join(dir,'real-2d')});assert.ok(result.scenes.every(s=>s.mode==='court'));
  assert.match(await readFile(join(dir,'real-2d','index.html'),'utf8'),/仅 2D/);
});

// Execute the emitted consumer script against a small DOM boundary. This checks our stage selection/
// replacement and resize calls; real browser rendering and layout remain a controller QA obligation.
function runtime(html){
  class Node {constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers={};this.style={};this.dataset={};this.clientWidth=1280;this.clientHeight=720;this.innerHTML='';this.textContent='';}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];this.innerHTML='';}
    setAttribute(k,v){this[k]=String(v);}addEventListener(k,fn){this.handlers[k]=fn;}}
  const nodes=Object.fromEntries(['stage','stage-buttons','stage-title','stage-time','quality-note','participants','issue-list','source-details','stage-notice'].map(id=>[id,new Node()]));
  const data=html.match(/<script id="scene-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];assert.ok(data);
  nodes['scene-data']=new Node('script');nodes['scene-data'].textContent=data;
  let resize;const doc={getElementById:id=>nodes[id],createElement:tag=>new Node(tag)};
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m=>!m[0].includes('application/json'));
  assert.equal(scripts.length,1);vm.runInNewContext(scripts[0][1],{document:doc,ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},console});
  return {nodes,resize:()=>resize()};
}

test('visible roster distinguishes performer beneficiary and defender while preserving their own simultaneous actions',async()=>{
  const input=await makePresentationDemo(),m=await buildTacticalOverlay({...input,phaseId:'setup',freezeFrame:12});
  const {nodes}=runtime(buildPreviewHtml({scenes:[{manifest:m,mode:'court',background:null}]}));
  const items=nodes.participants.children.map(n=>n.textContent),person=id=>items.find(text=>text.startsWith(id+' '));
  assert.equal(items.length,6);
  assert.match(person('P2'),/掩护：进行中/);assert.match(person('P2'),/掩护者.*P1/);assert.match(person('P2'),/顺下：后续/);
  assert.match(person('P1'),/受掩护者.*P2/);assert.match(person('P1'),/移动：进行中/);assert.doesNotMatch(person('P1'),/掩护：进行中/);
  assert.match(person('P6'),/相关防守者.*P2.*P1/);assert.match(person('P6'),/原地保持：进行中/);assert.doesNotMatch(person('P6'),/掩护：进行中/);
});

const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const annotationLabels=svg=>[...svg.matchAll(/<g data-kind="annotation-label"([^>]*)>([\s\S]*?)<\/g>/g)].map(m=>({attrs:attributes(m[1]),body:m[2]}));
const visibleText=svg=>[...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(m=>m[1]).join('\n');
function assertReadableText(svg,width,height){
  const boxes=[...svg.matchAll(/<text\b([^>]*)>(.*?)<\/text>/g)].map(m=>{
    const a=attributes(m[1]),size=Number(a['font-size']),x=Number(a.x),y=Number(a.y);
    // Explicit SVG textLength is the painted advance. Legacy text gets a conservative font-size estimate.
    const length=a.textLength===undefined?[...m[2]].reduce((sum,c)=>sum+(c.charCodeAt(0)<128?.65:1)*size,0):Number(a.textLength);
    assert.ok(x>=0&&y-size>=0&&x+length<=width+.01&&y+3<=height,'painted text must not clip at a viewport edge');
    return {x,y:y-size,width:length,height:size+3,text:m[2]};
  });
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`visible text overlaps: ${a.text} / ${b.text}`);
  }
}
function assertLabelLayout(svg,width,height){
  assertReadableText(svg,width,height);
  const labels=annotationLabels(svg);assert.ok(labels.length>0,'drawable labels must expose their actual SVG box geometry');
  const boxes=labels.map(label=>{
    const rect=label.body.match(/<rect\b[^>]*data-kind="label-bounds"[^>]*>/)?.[0];assert.ok(rect,'label has a painted bounds rectangle');
    const a=attributes(rect),b={x:Number(a.x),y:Number(a.y),width:Number(a.width),height:Number(a.height)};
    assert.ok(b.x>=2&&b.y>=2&&b.x+b.width<=width-2+.01&&b.y+b.height<=height-2+.01,'entire label stays in viewport');
    const text=[...label.body.matchAll(/<text\b([^>]*)>(.*?)<\/text>/g)];assert.ok(text.length>0);
    for(const t of text){const a=attributes(t[1]),x=Number(a.x),y=Number(a.y),length=Number(a.textLength),size=Number(a['font-size']);
      assert.ok(Number.isFinite(length)&&length>0,'text has deterministic painted advance');
      assert.ok(x>=b.x+2&&x+length<=b.x+b.width-2+.01&&y-size>=b.y+1&&y+3<=b.y+b.height,'actual text extent fits its label');
    }
    return b;
  });
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`labels ${i} and ${j} cannot overlap`);
  }
  for(const marker of svg.matchAll(/<g data-kind="(?:freeze_position|static_role|future_action_start)"([^>]*)>/g)){
    const a=attributes(marker[1]),label=labels.find(l=>l.attrs['data-label-id']===a['data-label-id']);assert.ok(label,'each retained marker is associated with its visible label');
    assert.equal(label.attrs['data-entity-id'],a['data-entity-id']);
  }
  assert.match(svg,/data-kind="label-leader"/);
  return labels;
}

function assertRoutesUncovered(svg){
  const boxes=annotationLabels(svg).map(label=>{
    const a=attributes(label.body.match(/<rect\b[^>]*data-kind="label-bounds"[^>]*>/)[0]);
    return {id:label.attrs['data-label-id'],left:Number(a.x)-.5,top:Number(a.y)-.5,right:Number(a.x)+Number(a.width)+.5,bottom:Number(a.y)+Number(a.height)+.5};
  });
  const points=text=>text.split(' ').map(pair=>pair.split(',').map(Number));
  const distance=(p,b)=>Math.hypot(Math.max(b.left-p[0],0,p[0]-b.right),Math.max(b.top-p[1],0,p[1]-b.bottom));
  const checkEdge=(a,b,radius,description)=>{
    // Independent subpixel sampling of the actual painted SVG, not the placement algorithm.
    const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5));
    for(let i=0;i<=n;i++){const p=[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n];
      for(const box of boxes)assert.ok(distance(p,box)>radius,`${box.id} hides ${description}`);
    }
  };
  const groups=[...svg.matchAll(/<g data-(?:action|relation)-id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)];assert.ok(groups.length>0);
  for(const [,id,body] of groups){
    for(const polyline of body.matchAll(/<polyline\b([^>]*)\/>/g)){
      const a=attributes(polyline[1]),path=points(a.points),radius=Number(a['stroke-width'])/2;
      for(let i=1;i<path.length;i++)checkEdge(path[i-1],path[i],radius,`${id} route/bar stroke`);
    }
    for(const polygon of body.matchAll(/<polygon\b([^>]*)\/>/g)){
      const a=attributes(polygon[1]),triangle=points(a.points),radius=Number(a['stroke-width'])/2;
      for(let i=0;i<triangle.length;i++)checkEdge(triangle[i],triangle[(i+1)%triangle.length],radius,`${id} arrowhead`);
      const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
      for(const box of boxes)for(const corner of [[box.left,box.top],[box.left,box.bottom],[box.right,box.top],[box.right,box.bottom]]){
        const signs=triangle.map((p,i)=>cross(p,triangle[(i+1)%3],corner));
        assert.ok(!(signs.every(v=>v>=0)||signs.every(v=>v<=0)),`${box.id} hides ${id} arrowhead fill`);
      }
    }
  }
}

test('synthetic 595px labels leave the observed P2 pending-roll head and route fully visible',async()=>{
  const input=await makePresentationDemo(),m=await buildTacticalOverlay({...input,phaseId:'setup',freezeFrame:12}),before=JSON.stringify(m);
  const svg=renderOverlaySvg(m,{mode:'court',viewport:{width:595,height:334.6875}});
  const roll=svg.match(/<g data-action-id="roll"[\s\S]*?<\/g>/)?.[0];assert.ok(roll);
  assert.match(roll,/data-temporal-status="pending"/);assert.match(roll,/stroke-dasharray="12 10"/);
  assert.match(roll,/points="510.626,147.353 493.973,158.653 491.594,140.811"/);
  for(const label of annotationLabels(svg)){
    const rect=attributes(label.body.match(/<rect\b[^>]*data-kind="label-bounds"[^>]*>/)[0]);
    const inside=([x,y])=>x>=Number(rect.x)&&x<=Number(rect.x)+Number(rect.width)&&y>=Number(rect.y)&&y<=Number(rect.y)+Number(rect.height);
    assert.ok(![[510.626,147.353],[493.973,158.653],[491.594,140.811]].every(inside),`${label.attrs['data-label-id']} hides the entire observed P2 roll arrowhead`);
  }
  assertRoutesUncovered(svg);assertLabelLayout(svg,595,334.6875);
  assert.equal(JSON.stringify(m),before);assert.equal(m.roster.length,6);
});

test('resized crowded previews keep all painted routes arrowheads and screen bars outside opaque labels',async()=>{
  for(const dataset of ['real','synthetic']){
    const input=dataset==='real'?await makeCandidateFixture():await makePresentationDemo();
    const m=await buildTacticalOverlay({...input,phaseId:dataset==='real'?'phase2':'setup',freezeFrame:dataset==='real'?40:12});
    const {nodes,resize}=runtime(buildPreviewHtml({scenes:[{manifest:m,mode:'court',background:null}]}));
    for(const width of [933,595,431]){
      nodes.stage.clientWidth=width;resize();const canvas=nodes.stage.children[0],svg=canvas.children[0].innerHTML;
      assertRoutesUncovered(svg);assertLabelLayout(svg,parseFloat(canvas.style.width),parseFloat(canvas.style.height));
      assert.equal([...svg.matchAll(/<g data-action-id=/g)].length,m.paths.filter(p=>p.renderability!=='unavailable').length);
      assert.equal([...svg.matchAll(/<g data-kind="(?:freeze_position|static_role|future_action_start)"/g)].length,m.markers.filter(k=>k.renderability!=='unavailable').length);
      assert.equal(nodes.participants.children.length,6);assert.match(svg,/stroke-width="6"/);assert.match(svg,/stroke-width="2"/);
    }
  }
});

test('static role labels group current later and completed wording at the frozen anchor with future provenance separate',async()=>{
  const input=await makePresentationDemo(),m=await buildTacticalOverlay({...input,phaseId:'setup',freezeFrame:12});
  const screen=m.markers.find(k=>k.kind==='static_role'&&k.entityId==='P2');
  m.markers.push({...structuredClone(screen),actionId:'later-hold',role:'hold',temporalStatus:'pending'},
    {...structuredClone(screen),actionId:'done-space',role:'space',temporalStatus:'completed'});
  const before=JSON.stringify(m),svg=renderOverlaySvg(m,{mode:'video'}),groups=annotationLabels(svg).filter(g=>g.attrs['data-entity-id']==='P2');
  assert.match(visibleText(svg),/当前：掩护/);assert.match(visibleText(svg),/后续：原地保持/);assert.match(visibleText(svg),/已完成：拉开空间/);
  assert.equal(groups.length,1,'same-position frozen, static and future labels are aggregated without losing their meanings');
  const text=visibleText(groups[0].body);
  assert.match(text,/冻结位.*12/);assert.match(text,/当前：掩护/);assert.match(text,/后续：原地保持/);assert.match(text,/已完成：拉开空间/);
  assert.match(text,/后续起点·P2\/帧30/);assert.equal(JSON.stringify(m),before);
});

for(const dataset of ['real','synthetic'])test(`crowded ${dataset} labels avoid overlaps at 1280 and 640 while retaining every marker and route`,async()=>{
  const input=dataset==='real'?await makeCandidateFixture():await makePresentationDemo();
  const m=await buildTacticalOverlay({...input,phaseId:dataset==='real'?'phase2':'setup',freezeFrame:dataset==='real'?40:12});
  assert.notEqual(m.status,'refused');const before=JSON.stringify(m);
  if(dataset==='real'){
    const person=id=>m.roster.find(p=>p.id===id);
    assert.ok(person('P2').actionStates.some(a=>a.actionId==='a5_screen'&&a.temporalStatus==='active'));
    assert.ok(person('P1').actionStates.some(a=>a.actionId==='a1_receive_and_turn'&&a.temporalStatus==='active'));
    for(const id of ['P1','P6'])assert.ok(!person(id).actionStates.some(a=>a.actionId==='a5_screen'));
    assert.equal(person('P1').relationStates[0].role,'beneficiary');assert.equal(person('P6').relationStates[0].role,'defender');
    const {nodes}=runtime(buildPreviewHtml({scenes:[{manifest:m,mode:'court',background:null}]}));
    const items=nodes.participants.children.map(n=>n.textContent);
    assert.match(items.find(s=>s.startsWith('P1 ')),/受掩护者.*P2/);assert.match(items.find(s=>s.startsWith('P6 ')),/相关防守者.*P2.*P1/);
    for(const id of ['P1','P6'])assert.doesNotMatch(items.find(s=>s.startsWith(id+' ')),/掩护：进行中/);
  }
  for(const [width,height] of [[1280,720],[640,360]]){
    const svg=renderOverlaySvg(m,{mode:dataset==='real'?'video':'court',viewport:{width,height}});
    assertLabelLayout(svg,width,height);assert.equal(svg,renderOverlaySvg(m,{mode:dataset==='real'?'video':'court',viewport:{width,height}}));
    assert.equal([...svg.matchAll(/<g data-kind="(?:freeze_position|static_role|future_action_start)"/g)].length,m.markers.filter(k=>k.renderability!=='unavailable').length);
    assert.equal([...svg.matchAll(/<g data-action-id=/g)].length,m.paths.filter(p=>p.renderability!=='unavailable').length);
    assert.match(svg,/stroke-width="6"/);assert.match(svg,/stroke-width="2"/);
    if(dataset==='real'){
      const text=annotationLabels(svg).filter(g=>g.attrs['data-entity-id']==='P1').map(g=>visibleText(g.body)).join('\n');
      assert.match(text,/冻结位.*40/);assert.match(text,/后续：原地保持、拉开空间/);assert.match(text,/后续起点·P1\/帧53/);assert.match(text,/后续起点·P1\/帧64/);
    }
  }
  assert.equal(JSON.stringify(m),before);
});

test('viewport edge labels keep their full bounds inside without shifting original marker coordinates',async()=>{
  const input=await makePresentationDemo(),m=await buildTacticalOverlay({...input,phaseId:'setup',freezeFrame:12});
  m.markers=m.markers.filter(k=>k.kind==='freeze_position');
  const edges=[[0,0],[1280,0],[0,720],[1280,720],[1279,359],[1279,361]];
  m.markers.forEach((k,i)=>{k.position.freezePoint={x:edges[i][0],y:edges[i][1]};});
  for(const [width,height] of [[1280,720],[640,360]]){
    const svg=renderOverlaySvg(m,{mode:'video',viewport:{width,height}});assertLabelLayout(svg,width,height);
    for(const [i,k] of m.markers.entries()){
      const group=svg.match(new RegExp('<g data-kind="freeze_position" data-entity-id="'+k.entityId+'"[\\s\\S]*?<\\/g>'))?.[0];assert.ok(group);
      assert.match(group,new RegExp('cx="'+edges[i][0]*width/1280+'" cy="'+edges[i][1]*height/720+'"'));
    }
  }
});

test('narrow crowded preview publishes a fresh CSS-sized scrollable canvas and can switch stages without stale or blank geometry',async()=>{
  const input=await makeCandidateFixture(),scenes=[];
  for(const [phaseId,freezeFrame] of [['phase2',40],['phase3',90]])scenes.push({manifest:await buildTacticalOverlay({...input,phaseId,freezeFrame}),mode:'court',background:null});
  const {nodes,resize}=runtime(buildPreviewHtml({scenes})),stage=nodes.stage;
  stage.clientWidth=431;stage.clientHeight=242;
  assert.doesNotThrow(()=>resize(),'insufficient label space must not leave a previous larger SVG scaled down');
  const canvas=stage.children[0],svg=canvas.children[0].innerHTML;
  assert.equal(canvas.style.width,'640px');assert.equal(canvas.style.height,'360px');assert.match(svg,/width="640" height="360"/);
  assert.match(nodes['stage-notice'].textContent,/滚动/);assertLabelLayout(svg,640,360);
  const arrow=svg.match(/<polygon data-kind="arrowhead" points="([^"]+)"/);assert.ok(arrow);
  const [tip,left,right]=arrow[1].split(' ').map(s=>s.split(',').map(Number));
  assert.ok(Math.abs(Math.hypot(tip[0]-(left[0]+right[0])/2,tip[1]-(left[1]+right[1])/2)-18)<.01);
  assert.match(svg,/stroke-width="6"/);assert.match(svg,/stroke-width="2"/);assert.equal(nodes.participants.children.length,6);
  assert.doesNotThrow(()=>nodes['stage-buttons'].children[1].handlers.click());
  assert.match(stage.children[0].children[0].innerHTML,/data-freeze-frame="90"/);assert.equal(nodes.participants.children.length,6);
  stage.clientWidth=933;stage.clientHeight=525;resize();
  assert.equal(stage.children[0].style.width,'933px');assert.match(stage.children[0].children[0].innerHTML,/width="933"/);
  assert.equal(nodes['stage-notice'].textContent,'');
});

test('consumer_source_and_stage: emitted self-contained script replaces whole bound scene and rerenders CSS pixel geometry',async t=>{
  const run=exporter(),build=preview(),dir=await temporary(t),input=await realInput(dir);
  const {scenes}=await run({...input,outDirectory:join(dir,'out')});
  scenes[0].title='</script><img src=x onerror="x"> & "阶段"';
  const html=build({title:'<>&" 报告',scenes});assert.doesNotMatch(html,/<img src=x|<script src=|fetch\(|\.seek\(/);
  assert.match(html,/&lt;&gt;&amp;&quot; 报告/);
  const {nodes,resize}=runtime(html),stage=nodes.stage;
  assert.equal(stage.children[0].children[0].src,scenes[0].background.dataUrl);assert.match(stage.children[0].children[1].innerHTML,/data-freeze-frame="1"/);
  nodes['stage-buttons'].children[1].handlers.click();
  assert.equal(stage.children.length,1);assert.equal(stage.children[0].children.length,2);assert.equal(stage.children[0].children[0].src,scenes[1].background.dataUrl);
  assert.match(stage.children[0].children[1].innerHTML,/data-freeze-frame="2"/);assert.doesNotMatch(stage.children[0].children[1].innerHTML,/data-freeze-frame="1"/);
  assert.match(nodes['source-details'].textContent,/"freezeFrame": 2/);assert.ok(nodes.participants.children.some(n=>n.textContent.includes('P3')));
  stage.clientWidth=640;stage.clientHeight=360;resize();
  assert.match(stage.children[0].children[1].innerHTML,/points="10,10 20,10 30,10"/);assert.match(stage.children[0].children[1].innerHTML,/stroke-width="6"/);
});

test('consumer_source_and_stage: HTML refuses scene/background mismatch even for direct API callers',async t=>{
  const run=exporter(),build=preview(),dir=await temporary(t),input=await realInput(dir);
  const {scenes}=await run({...input,outDirectory:join(dir,'out')});
  for(const field of ['frame','time','videoSha256']){const copy=structuredClone(scenes);copy[0].background[field]=field==='videoSha256'?'wrong':999;
    assert.throws(()=>build({title:'bad',scenes:copy}),/background|binding|frame|time/i);}
  const hashMismatch=structuredClone(scenes);hashMismatch[0].background.sha256='0'.repeat(64);
  assert.throws(()=>build({title:'bad',scenes:hashMismatch}),/sha256|hash/i);
  const bytesMismatch=structuredClone(scenes);bytesMismatch[0].background.dataUrl=scenes[1].background.dataUrl;
  assert.throws(()=>build({title:'bad',scenes:bytesMismatch}),/sha256|hash/i);
});

test('static report explicitly shows screen participants and missing orientation without inventing a bar',async()=>{
  const build=preview(),input=await makePresentationFixture();input.playDefinition.relations[0].orientation=null;
  const m=await buildTacticalOverlay({...input,phaseId:'setup',freezeFrame:2});assert.equal(m.relations[0].bar,null);
  const html=build({title:'待核掩护',scenes:[{title:'关系缺朝向',manifest:m,mode:'court',background:null}]});
  const {nodes}=runtime(html),items=nodes['issue-list'].children.map(n=>n.textContent).join('\n');
  assert.match(items,/P3.*P1.*P6/);assert.match(items,/朝向.*未提供|缺少朝向/);
  assert.doesNotMatch(nodes.stage.children[0].children[0].innerHTML,/data-relation-id="screen-relation"/);
});

test('CLI produces the same engine stages, accepts frame paths relative to index and never writes source files',async t=>{
  exporter();const dir=await temporary(t),input=await realInput(dir),reviewFile=join(dir,'review.json'),playFile=join(dir,'play.json'),framesFile=join(dir,'frames.json');
  await writeFile(reviewFile,JSON.stringify(input.review));await writeFile(playFile,JSON.stringify(input.playDefinition));await writeFile(framesFile,JSON.stringify(input.frames));
  const sourceBefore=await Promise.all([reviewFile,playFile,framesFile].map(f=>readFile(f)));
  const cli=resolve('engineering/tools/tactical-overlay/export.mjs'),out=join(dir,'cli');
  const proc=spawnSync(process.execPath,[cli,'--review',reviewFile,'--play',playFile,'--frames',framesFile,'--out',out],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);assert.match(await readFile(join(out,'index.html'),'utf8'),/scene-data/);
  const index=JSON.parse(await readFile(join(out,'source-index.json'),'utf8'));assert.deepEqual(index.scenes.map(s=>s.freezeFrame),[1,2]);
  assert.deepEqual(await Promise.all([reviewFile,playFile,framesFile].map(f=>readFile(f))),sourceBefore);
  const bad=spawnSync(process.execPath,[cli,'--review',reviewFile,'--play',playFile,'--out',dir],{encoding:'utf8'});
  assert.notEqual(bad.status,0);assert.deepEqual(await readFile(reviewFile),sourceBefore[0]);
});

test('CLI malformed JSON refuses an existing report rather than leaving its old video scene visible',async t=>{
  const run=exporter(),dir=await temporary(t),input=await realInput(dir),outDirectory=join(dir,'out');
  await run({...input,outDirectory});
  const reviewFile=join(dir,'bad-review.json'),playFile=join(dir,'play.json');
  await writeFile(reviewFile,'{ invalid JSON');await writeFile(playFile,JSON.stringify(input.playDefinition));
  const proc=spawnSync(process.execPath,[resolve('engineering/tools/tactical-overlay/export.mjs'),'--review',reviewFile,'--play',playFile,'--out',outDirectory],{encoding:'utf8'});
  assert.notEqual(proc.status,0);const html=await readFile(join(outDirectory,'index.html'),'utf8');
  assert.match(html,/拒绝/);assert.doesNotMatch(html,/scene-data|data:image|<svg/);
  assert.equal(await readFile(reviewFile,'utf8'),'{ invalid JSON');
});

test('parsed null frame index entries invalidate an existing owned video report',async t=>{
  const dir=await temporary(t),input=await realInput(dir),outDirectory=join(dir,'out');
  await exportPreview({...input,outDirectory});
  const frames=JSON.parse(JSON.stringify({...input.frames,frames:[null]}));
  await assert.rejects(()=>exportPreview({...input,frames,outDirectory}),/invalid.*entry/i);
  const index=JSON.parse(await readFile(join(outDirectory,'source-index.json'),'utf8'));
  assert.equal(index.status,'refused');assert.deepEqual(index.scenes,[]);
  assert.doesNotMatch(await readFile(join(outDirectory,'index.html'),'utf8'),/scene-data|data:image|<svg/);
});

for(const aliasKind of ['symlink','hardlink'])test(`existing ${aliasKind} stage destination refuses export without changing original review bytes`,async t=>{
  const dir=await temporary(t),input=await realInput(dir),outDirectory=join(dir,'out'),original=join(dir,'original-review.json');
  await writeFile(original,JSON.stringify(input.review));const before=await readFile(original);
  await exportPreview({...input,outDirectory,inputFiles:[original]});
  const destination=join(outDirectory,'stage-001.manifest.json');await unlink(destination);
  try{if(aliasKind==='symlink')await symlink(original,destination,'file');else await link(original,destination);}
  catch(e){if(aliasKind==='symlink'&&['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip(`file symlink unavailable: ${e.code}`);return;}throw e;}
  await assert.rejects(()=>exportPreview({...input,outDirectory,inputFiles:[original]}),/alias|link|destination/i);
  assert.equal(digest(await readFile(original)),digest(before));
  assert.equal(JSON.parse(await readFile(join(outDirectory,'source-index.json'),'utf8')).status,'refused');
  assert.doesNotMatch(await readFile(join(outDirectory,'index.html'),'utf8'),/scene-data|data:image|<svg/);
});

for(const destinationName of ['index.html','source-index.json'])test(`refusal publication replaces a hardlink ${destinationName} entry while preserving its original inode bytes`,async t=>{
  const dir=await temporary(t),input=await realInput(dir),outDirectory=join(dir,'out');await exportPreview({...input,outDirectory});
  const destination=join(outDirectory,destinationName),original=join(dir,`original-${destinationName}`);
  const before=await readFile(destination);await writeFile(original,before);await unlink(destination);await link(original,destination);
  const frames=structuredClone(input.frames);frames.frames[0].sha256='0'.repeat(64);
  await assert.rejects(()=>exportPreview({...input,frames,outDirectory,inputFiles:[original]}));
  assert.equal(digest(await readFile(original)),digest(before));
  assert.equal(JSON.parse(await readFile(join(outDirectory,'source-index.json'),'utf8')).status,'refused');
  assert.doesNotMatch(await readFile(join(outDirectory,'index.html'),'utf8'),/scene-data|data:image|<svg/);
});

test('future action start is visibly labelled with source frame and cannot look like a filled frozen position',async()=>{
  const m=await manifest(),before=JSON.stringify(m);
  for(const [width,height] of [[1280,720],[476,267.75]]){
    const svg=renderOverlaySvg(m,{mode:'video',viewport:{width,height}});
    const future=svg.match(/<g data-kind="future_action_start" data-entity-id="P2"[\s\S]*?<\/g>/)?.[0];
    const frozen=svg.match(/<g data-kind="freeze_position" data-entity-id="P2"[\s\S]*?<\/g>/)?.[0];
    assert.ok(future);assert.ok(frozen);
    const futureLabel=annotationLabels(svg).find(g=>g.attrs['data-label-id']===attributes(future)['data-label-id']);
    const frozenLabel=annotationLabels(svg).find(g=>g.attrs['data-label-id']===attributes(frozen)['data-label-id']);
    assert.ok(futureLabel);assert.ok(frozenLabel);
    assert.match(visibleText(futureLabel.body),/后续起点·P2\/帧2/);assert.match(future,/data-source-frame="2"/);
    assert.doesNotMatch(future,/<circle[^>]*fill="(?!none)[^"]+"/);
    assert.match(frozen,/<circle[^>]*fill="#/);assert.match(visibleText(frozenLabel.body),/P2.*冻结位 F1/);
    assert.notEqual(futureLabel.attrs['data-label-id'],frozenLabel.attrs['data-label-id']);assertLabelLayout(svg,width,height);
  }
  assert.equal(JSON.stringify(m),before);
  const remapped=structuredClone(m);
  remapped.markers.find(marker=>marker.kind==='future_action_start'&&marker.entityId==='P2').position.sourceFrame=202;
  const svg=renderOverlaySvg(remapped,{mode:'video'}),future=svg.match(/<g data-kind="future_action_start" data-entity-id="P2"[\s\S]*?<\/g>/)?.[0];
  assert.match(future,/data-frame="2" data-source-frame="202"/);
  const label=annotationLabels(svg).find(g=>g.attrs['data-label-id']===attributes(future)['data-label-id']);
  assert.ok(label);assert.match(visibleText(label.body),/后续起点·P2\/帧202/);
});
