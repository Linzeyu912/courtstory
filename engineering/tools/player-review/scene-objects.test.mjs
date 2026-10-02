import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneObjectsAt,updateSceneObject,exportSceneObjects} from './scene-objects.mjs';
import {blankSession,exportReview} from './trajectory.mjs';
const record={frame:0,time:0,tracks:[],objects:[{kind:'basketball',box:[10,20,20,30],score:.8,source:'model',groundPoint:false},{kind:'hoop',box:[50,20,70,30],score:.9,source:'model',groundPoint:false}]};
test('object edits stay on their frame, preserve detector evidence, and never create player identities',()=>{
 const session=blankSession('v'),source=structuredClone(record),object=sceneObjectsAt(session,source,0)[0];
 updateSceneObject(session,0,object,{point:[18,28]},100,100);
 assert.deepEqual(sceneObjectsAt(session,source,0)[0].point,[18,28]);assert.deepEqual(sceneObjectsAt(session,source,1)[0].point,[15,25]);
 const exported=exportSceneObjects(session,[source]);assert.equal(exported.groundProjection,false);assert.equal(exported.continuousTracking,false);assert.equal(exported.frames[0].objects[0].source,'human');assert.deepEqual(exported.frames[0].objects[0].detectorBox,[10,20,20,30]);assert.deepEqual(source,record);assert.ok(session.entities.every(e=>e.anchors.length===0));
});
test('excluding and supplementing objects preserves an audit record without extrapolation',()=>{
 const session=blankSession('v');updateSceneObject(session,0,sceneObjectsAt(session,record,0)[1],{action:'exclude'},100,100);
 updateSceneObject(session,0,{id:'manual:1',kind:'hoop',box:null,point:[65,25]},{point:[65,25]},100,100);
 assert.deepEqual(sceneObjectsAt(session,record,0).map(o=>o.id),['model:0','manual:1']);
 const out=exportSceneObjects(session,[record,{frame:1,time:.1,tracks:[],objects:[]}]);assert.equal(out.frames[0].objects[1].groundPoint,false);assert.equal(out.frames[1].objects.length,0);assert.equal(out.manualEdits[0].action,'exclude');
 const before=JSON.stringify(session);assert.throws(()=>updateSceneObject(session,0,{id:'bad',kind:'basketball'},{box:[1,2,0,3]},100,100));assert.equal(JSON.stringify(session),before);
});
