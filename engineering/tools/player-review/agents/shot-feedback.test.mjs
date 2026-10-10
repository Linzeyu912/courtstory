import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommentaryTools,validateCommentaryPlan} from './commentary-tools.mjs';

const fixture=()=>{
  const frames=Array.from({length:13},(_,frame)=>({frame,time:frame/10,sourceTime:7+frame/10,pts:70+frame,timeBase:'1/10'}));
  const readFrames=new Set(frames.map(f=>f.frame));readFrames.detailRead=true;readFrames.detailFrames=new Set([10]);
  const plan={summary:'投篮前的防守。',events:[{eventId:'shot',kind:'shot',shotStatus:'confirmed',startTime:0,endTime:1.2,description:'可见球离手。',participants:['匿名投手'],evidenceFrames:[9,10,11],uncertainties:[]}],
    participants:[{participantId:'shooter',entityId:null,nameRecordRef:null,identityStatus:'unknown',displayName:null,validRange:{startFrame:0,endFrame:12}}],
    cues:[{cueId:'c',eventId:'shot',suggestedStartTime:1,suggestedEndTime:1.2,text:'机会不错，但扑防的压力很大。',focus:'投篮防守',delivery:'pause',evidenceFrames:[10]}],uncertainties:[],
    nodes:[{nodeId:'release',kind:'shot_release',eventId:'shot',cueIds:['c'],anchorAssetFrame:10,evidenceWindow:{startFrame:0,endFrame:12},participantRefs:['shooter'],focus:'出手',uncertainties:[],
      shotFeedback:{shooterRef:'shooter',defenderRefs:[],opportunity:{grade:'good',reason:'进攻获得空位。'},pressure:{grade:'high',reason:'扑防迫近。'},evidenceFrames:Array.from({length:11},(_,i)=>i),ratingsRefs:[]}}]};
  return {plan,frames,options:{duration:1.3,readFrames,frameTimes:new Map(frames.map(f=>[f.frame,f])),requireContract:true}};
};
test('confirmed releases require shooter and pause while opportunity and pressure remain independent',()=>{
  const {plan,options}=fixture();assert.deepEqual(validateCommentaryPlan(plan,options),[]);
  assert.equal(plan.nodes[0].shotFeedback.defenseWindow.coverage,'complete');
  assert.deepEqual([plan.nodes[0].shotFeedback.opportunity.grade,plan.nodes[0].shotFeedback.pressure.grade],['good','high']);
  for(const modify of [p=>p.nodes=[],p=>p.nodes[0].shotFeedback.shooterRef=null,p=>p.cues[0].delivery='during_play',p=>p.events[0].shotStatus='uncertain',p=>delete p.events[0].kind]){
    const f=fixture();modify(f.plan);assert.ok(validateCommentaryPlan(f.plan,f.options).length);
  }
});
test('missing middle samples demote grades; future and unreturned evidence fail',()=>{
  const {plan,options}=fixture();plan.nodes[0].shotFeedback.evidenceFrames=[0,10];
  assert.deepEqual(validateCommentaryPlan(plan,options),[]);
  assert.equal(plan.nodes[0].shotFeedback.defenseWindow.coverage,'partial');
  assert.equal(plan.nodes[0].shotFeedback.opportunity.grade,'unknown');
  for(const frame of [11,99]){const f=fixture();f.plan.nodes[0].shotFeedback.evidenceFrames.push(frame);assert.ok(validateCommentaryPlan(f.plan,f.options).length);}
});
test('save tool uses locked host rating context and refuses invented values or mismatched participant refs',async()=>{
  const {plan,frames}=fixture();const ratingContext={digest:'host',season:null,records:[{ratingRef:'r',participantId:'shooter',ratings:{block:null},field_provenance:{block:null},status:'unknown'}]};
  const runtime=createCommentaryTools({context:{duration:1.3,videoRef:'v',frames,planContract:true,ratingContext},overview:{details:{frames},content:[]}},{budget:{toolCalls:0,maxToolCalls:4}});
  runtime.state.seenFrames.detailRead=true;runtime.state.seenFrames.detailFrames.add(10);
  const context=JSON.parse((await runtime.tools.find(t=>t.name==='get_video_context').execute('context',{})).content[0].text);
  assert.deepEqual(context.ratingContext.records,[]);
  assert.match(context.ratingContext.note,/no known ratings/);
  const saver=runtime.tools.find(t=>t.name==='save_commentary_plan');await saver.execute('save',{plan,finish:false});
  assert.deepEqual(runtime.state.plan.ratingContext,ratingContext);
  assert.deepEqual(runtime.state.plan.nodes[0].shotFeedback.ratingsRefs,['r']);
  plan.nodes[0].shotFeedback.ratingsRefs=['fake'];await assert.rejects(saver.execute('bad',{plan}),/rating/);
});
