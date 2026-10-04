import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createAnnotation,updateAnnotation,projectAnnotations} from './tactics-annotations.mjs';
import * as documents from './tactics-document.mjs';

const fixture=async()=>({schemaVersion:1,title:'Follow',notes:'',...await makePresentationDemo()});
const circle={id:'foot',type:'spotlight',entityId:'P1',phaseId:'setup',frame:12,space:'video',points:[{x:40,y:40}],anchorMode:'player_foot'};

test('foot anchored circle uses the selected player current foot even on the creation frame and without calibration',async()=>{
  let doc=await fixture();doc.review.court.calibration={keyframes:[]};
  doc=createAnnotation(doc,circle);
  assert.equal(doc.annotations.items[0].anchorMode,'player_foot');
  for(const frame of [12,19]){
    const point=doc.review.entities[0].trajectory[frame],item=projectAnnotations(doc,{phaseId:'setup',frame}).items[0];
    assert.deepEqual(item.video.center,{x:point.x,y:point.y});
  }
  doc=updateAnnotation(doc,'foot',{entityId:'P2'});
  const next=doc.review.entities[1].trajectory[19];
  assert.deepEqual(projectAnnotations(doc,{phaseId:'setup',frame:19}).items[0].video.center,{x:next.x,y:next.y});
});

test('foot circles hide missing observations and never use the clicked point as a false player location',async()=>{
  let doc=await fixture();doc.review.entities[0].trajectory[12]={frame:12,time:1.2,x:null,y:null,source:'missing'};
  doc=createAnnotation(doc,circle);
  assert.equal(projectAnnotations(doc,{phaseId:'setup',frame:12}).items[0].video,null);
  assert.ok(projectAnnotations(doc,{phaseId:'setup',frame:19}).items[0].video);
});

test('foot circles accept audited manual_range positions only when based on observed tracked or manual points',async()=>{
  let doc=await fixture();const p=doc.review.entities[0].trajectory[12];p.source='manual_range';p.rangeCorrection={operationId:'test',method:'relative_keyframe_interpolation',supportFrames:[12],keyframe:true,originalSource:'manual',originalTrackId:1};
  doc=createAnnotation(doc,circle);assert.ok(projectAnnotations(doc,{phaseId:'setup',frame:12}).items[0].video);
  doc=structuredClone(doc);doc.review.entities[0].trajectory[12].rangeCorrection.originalSource='manual_path';
  assert.equal(projectAnnotations(doc,{phaseId:'setup',frame:12}).items[0].video,null);
});

test('source refresh rebinds new foot circles, retains old offsets as stale, adds participants and archives removed identities recoverably',async()=>{
  let doc=await fixture();doc=createAnnotation(doc,circle);
  doc=createAnnotation(doc,{...circle,id:'old',anchorMode:'manual_offset'});
  const old=structuredClone(doc.annotations.items[1]),review=structuredClone(doc.review);
  review.entities[0].trajectory[19].x+=20;
  review.entities.push({...structuredClone(review.entities[0]),id:'P9',name:'New person'});
  doc=await documents.refreshSnapshot(doc,review);
  assert.ok(doc.playDefinition.participants.some(p=>p.id==='P9'));
  assert.deepEqual(doc.annotations.items.find(a=>a.id==='old'),old);
  const scene=projectAnnotations(doc,{phaseId:'setup',frame:19});
  assert.ok(scene.items.find(a=>a.id==='foot').video);
  assert.equal(scene.stale.find(a=>a.id==='old').reason,'source_changed');
  review.entities=review.entities.filter(e=>e.id!=='P1');
  doc=await documents.refreshSnapshot(doc,review);
  assert.equal(doc.annotations.items.length,0);
  assert.equal(doc.archivedTactics.annotations.length,2);
  assert.equal(doc.archivedTactics.participants[0].id,'P1');
  await documents.validateDocument(doc);
  assert.equal(typeof documents.restoreArchivedAnnotation,'function');
  doc=documents.restoreArchivedAnnotation(doc,'foot',{entityId:'P2',phaseId:'setup',frame:12});
  assert.equal(doc.annotations.items[0].entityId,'P2');
  assert.equal(doc.archivedTactics.annotations.length,1);
  await documents.validateDocument(doc);
});
