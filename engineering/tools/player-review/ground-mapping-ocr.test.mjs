import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,exportReview} from './trajectory.mjs';
import {fitKeyframe,project,calibrationAt,buildCourtTrajectories} from './court.mjs';
import {courtLandmarks} from './court-geometry.mjs';
import {selectGroundComparison,groundImagePoint} from './ground-position.mjs';
import {adoptJerseyReading,bindTeamReading,ocrObservations} from './identity-ocr.mjs';
import {buildBallCourtTrajectory,mountBallCourt} from './ball-court.mjs';

const frames=Array.from({length:10},(_,frame)=>({frame,time:frame/30,tracks:[[10,10,50,110,1,.9,0]],objects:[{kind:'basketball',box:[27,52,33,58],score:.9,source:'model'}]}));
const image=[[0,0],[57.912,0],[57.912,48.768],[0,48.768]];
const session=()=>{const s=blankSession('v');s.courtCalibration={keyframes:[{frame:0,side:'left',source:'human',image},{frame:9,side:'left',source:'human',image}]};return s;};
const playerPoints=()=>Object.fromEntries(Array.from({length:10},(_,i)=>[`P${i+1}`,frames.map((r)=>({frame:r.frame,time:r.time,x:i===0?30:null,y:i===0?110:null,source:i===0?'tracked':'missing',trackId:i===0?1:null,box:i===0?[10,10,50,110]:null}))]));

test('ball state selection follows saved frame and undo without losing an unsaved same-frame choice',()=>{
 const node=()=>({children:[],value:'',setAttribute(){},append(...items){this.children.push(...items);}}),host=node(),previous=globalThis.document;
 globalThis.document={getElementById:()=>host,createElement:node};
 try{
  const s={frame:0,session:blankSession('v')};let panel;
  panel=mountBallCourt({state:()=>s,change:fn=>{fn();panel.render();}});
  const select=host.children[3],save=host.children[4];panel.render();assert.equal(select.value,'unknown');
  select.value='P1';panel.render();assert.equal(select.value,'P1');save.onclick();assert.equal(s.session.ballStateEdits[0].entityId,'P1');
  s.frame=1;panel.render();assert.equal(select.value,'unknown');
  s.frame=0;panel.render();assert.equal(select.value,'P1');
  s.session.ballStateEdits=[];panel.render();assert.equal(select.value,'unknown');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('robust automatic controls reject an outlier, retain observations and respect human points',()=>{
 const h=[30,2,100,1,25,80,.001,.002,1];
 const points=courtLandmarks().slice(0,10).map(c=>{const p=project(h,c.x,c.y);return {id:c.id,image:[p.x,p.y],source:'model'};});
 points[4].image[0]+=100;const snapshot=JSON.stringify(points);
 const fitted=fitKeyframe({side:'left',source:'model',points});assert.deepEqual(fitted.excludedControlIds,[points[4].id]);assert.equal(JSON.stringify(points),snapshot);
 const p=project(fitted.toImage,5,8),q=project(h,5,8);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<1e-5);
 assert.deepEqual(fitKeyframe({side:'left',source:'human',points}).excludedControlIds,[]);
});
test('pose changes derived coordinates only; missing feet fall back, manual points prevail',()=>{
 const s=session(),input=playerPoints(),original=JSON.stringify(input),clip={video_sha256:'v',tracking_fingerprint:'f',frames};
 selectGroundComparison(s,clip,{videoHash:'v',trackingFingerprint:'f',model:'rtmw-l',frames:[{frame:0,time:0,people:[{trackId:1,anchor:[32,105],anchorMethod:'feet'}]}]});
 const mapped=buildCourtTrajectories(s,frames,input).P1;assert.deepEqual(mapped[0].rawImagePoint,[30,110]);assert.deepEqual(mapped[0].imagePoint,[32,105]);assert.equal(mapped[0].groundContactConfirmed,false);
 assert.equal(mapped[1].groundCandidateMissing,true);assert.equal(JSON.stringify(input),original);
 assert.equal(groundImagePoint(s,{...input.P1[0],source:'manual'},0).y,110);
 assert.throws(()=>selectGroundComparison(s,clip,{videoHash:'other',trackingFingerprint:'f',frames:[]}));
 assert.throws(()=>selectGroundComparison(s,clip,{videoHash:'v',trackingFingerprint:'f',frames:[{frame:0,time:0,people:[{trackId:1,anchor:[1]}]}]}));
 selectGroundComparison(s,clip,null);assert.equal(groundImagePoint(s,input.P1[0],0).y,110);
});
test('OCR persists on P across track changes, distinguishes 0 and 00 and protects confirmed profiles',()=>{
 const s=session();s.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:2},{kind:'track',trackId:3,start:3,end:9}];
 const candidate={value:'00',evidence:[{frame:1,trackId:1}]},response={mode:'jersey',videoSha256:'v',engine:'test',candidates:[candidate]};
 const original=JSON.stringify(s.entities[0].bindings);adoptJerseyReading(s,'P1',candidate,response);assert.equal(s.entities[0].jersey,'00');assert.equal(JSON.stringify(s.entities[0].bindings),original);
 s.entities[0].playerProfile={status:'confirmed',jersey_number:'0'};assert.throws(()=>adoptJerseyReading(s,'P1',candidate,response));
 assert.throws(()=>adoptJerseyReading(s,'P1',candidate,{...response,videoSha256:'other'}));
});
test('team OCR binds the selected color group and protects conflicting real identities',()=>{
 const s=session();bindTeamReading(s,'red','SAS',{videoSha256:'v'});assert.ok(s.entities.slice(0,5).every(p=>p.team==='SAS'));assert.ok(s.entities.slice(5).every(p=>!p.team));
 assert.throws(()=>bindTeamReading(s,'blue','SAS',{videoSha256:'v'}));
 s.entities[5].playerProfile={status:'confirmed',team_abbreviation:'BOS'};assert.throws(()=>bindTeamReading(s,'blue','MIA',{videoSha256:'v'}));
});
test('OCR scan samples unique real boxes and excludes estimates and conflicts',()=>{
 const p=playerPoints().P1;p[1].source='conflict';p[2].source='interpolated';p[3].reviewExcluded=true;
 assert.deepEqual(ocrObservations(p,1),[]);const o=ocrObservations(p,5,true);assert.ok(o.some(r=>r.frame===5));assert.ok(!o.some(r=>[1,2,3].includes(r.frame)));assert.equal(new Set(o.map(r=>r.frame)).size,o.length);
});
test('possession proxy never becomes measured ball coordinate; free flight stays unknown',()=>{
 const s=session(),people=playerPoints(),court=buildCourtTrajectories(s,frames,people),source=JSON.stringify(frames);
 s.ballStateEdits=[{frame:0,state:'controlled',entityId:'P1'},{frame:1,state:'free_flight'}];
 const b=buildBallCourtTrajectory(s,frames,people,court,{width:200,height:200});assert.equal(b[0].positionKind,'possession_proxy');assert.equal(b[0].x,null);assert.equal(b[0].metricPositionAvailable,false);assert.equal(b[0].displayX,court.P1[0].x);assert.equal(b[1].displayX,null);
 assert.equal(b[9].state,'likely_controlled');assert.equal(b[9].x,null);assert.equal(JSON.stringify(frames),source);
});
test('possession evidence resets at cuts and manual non-possession',()=>{
 const s=session();s.cuts=[6];const people=playerPoints(),court=buildCourtTrajectories(s,frames,people);
 let b=buildBallCourtTrajectory(s,frames,people,court,{width:200,height:200});assert.equal(b[5].state,'likely_controlled');assert.equal(b[6].state,'possession_candidate');assert.equal(b[9].owner,null);
 s.cuts=[];s.ballStateEdits=[{frame:6,state:'free_flight'}];const missing=structuredClone(frames);missing[7].objects=[];
 b=buildBallCourtTrajectory(s,missing,people,court,{width:200,height:200});assert.equal(b[7].owner,null);
});
test('manual ball ground projection requires calibration and export retains per-frame matrices',()=>{
 const s=session(),people=playerPoints(),court=buildCourtTrajectories(s,frames,people);s.ballGroundAnchors=[{frame:0,image:[30,20]}];
 const b=buildBallCourtTrajectory(s,frames,people,court,{width:200,height:200});assert.equal(b[0].metricPositionAvailable,true);assert.ok(Math.abs(b[0].x-3)<1e-6);
 const map=calibrationAt(s.courtCalibration,0,frames);assert.ok(map.toCourt);
 s.entities[0].anchors=[{frame:0,x:30,y:110,trackId:1}];const out=exportReview(s,{frames,video_sha256:'v',width:200,height:200},null);
 assert.equal(out.courtMappings.length,10);assert.equal(out.coordinatePolicy.displaySmoothingApplied,false);assert.equal(out.ballCourtTrajectory[0].metricPositionAvailable,true);
 s.courtCalibration=null;assert.equal(buildBallCourtTrajectory(s,frames,people,court,{width:200,height:200})[0].x,null);
});
