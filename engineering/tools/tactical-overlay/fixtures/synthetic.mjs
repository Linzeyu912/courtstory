import {createSourceBinding} from '../binding.mjs';
import {courtLandmarks} from '../../player-review/court-geometry.mjs';

const evidence=(domain,endFrameExclusive,ids={})=>({domain,entityId:null,actionId:null,relationId:null,...ids,
  startFrame:0,endFrameExclusive,sourceFrames:Array.from({length:endFrameExclusive},(_,i)=>i),
  reviewer:'synthetic fixture',method:'analytically constructed synthetic observations',conclusion:'reviewed'});
function reviewFor(count,participants,pointFor,step=0.04) {
  return {schemaVersion:2,synthetic:true,videoSha256:'synthetic-video',sourceVideoSha256:'synthetic-root',
    trackingFingerprint:'synthetic-tracks',trackingRevision:'synthetic-v1',confirmedAt:'synthetic',
    width:640,height:360,allFramesManuallyVerified:false,
    sourceFrameMapping:Array.from({length:count},(_,frame)=>({frame,time:frame*step,sourceFrame:frame,sourceTime:frame*step})),
    settings:{cuts:[],sourceCuts:[]},court:{template:'NBA',units:'metres',length:28.6512,width:15.24,
      referenceId:'synthetic-common-floor',metricAccuracyValidated:false,
      calibration:{maxKeyframeGapSeconds:0,keyframes:Array.from({length:count},(_,frame)=>({frame,side:'left',source:'human',status:'accepted_reference',
        points:courtLandmarks().slice(0,4).map(p=>({id:p.id,image:[p.x*10,p.y*10],source:'human'}))}))}},
    entities:participants.map((id,index)=>({id,identityConfirmed:true,anchors:[],trajectory:Array.from({length:count},(_,frame)=>{
      const p=pointFor(index,frame);return {frame,time:frame*step,x:p.x*10,y:p.y*10,source:'manual',trackId:index+1,
        footMethod:'human_image_anchor',identitySource:'manual_range',identityStartFrame:0,identityOrder:1,identityExclusive:true};
    })}))};
}
function proof(ids,actions,relations,count) {
  return [evidence('calibration',count),...ids.flatMap(entityId=>['identity','position','continuity'].map(domain=>evidence(domain,count,{entityId}))),
    ...actions.map(actionId=>evidence('tactic',count,{actionId})),...relations.map(relationId=>evidence('tactic',count,{relationId}))];
}
export async function makeBoundaryFixture() {
  const review=reviewFor(4,['P1','P2'],(i,f)=>({x:f+1,y:i+1}));
  const actions=[{actionId:'A',actorId:'P1',participantIds:['P1'],kind:'move',startFrame:0,endFrameExclusive:3,source:'human_video_review',reviewStatus:'reviewed'},
    {actionId:'B',actorId:'P2',participantIds:['P2'],kind:'cut',startFrame:2,endFrameExclusive:4,source:'human_video_review',reviewStatus:'reviewed'}];
  const playDefinition={schemaVersion:1,synthetic:true,playId:'four-frame-boundary',revision:1,startFrame:0,endFrameExclusive:4,
    sourceBinding:await createSourceBinding(review),participants:[{id:'P1',name:'P1'},{id:'P2',name:'P2'},{id:'P3',name:'P3',role:'space'}],
    phases:[{phaseId:'S1',order:0,title:'阶段 1',startFrame:0,endFrameExclusive:2,freezeFrame:1,actionIds:['A'],participantIds:['P1','P3'],relationIds:[]},
      {phaseId:'S2',order:1,title:'阶段 2',startFrame:2,endFrameExclusive:4,freezeFrame:2,actionIds:['A','B'],participantIds:['P1','P2','P3'],relationIds:[]}],
    actions,relations:[],reviewEvidence:proof(['P1','P2'],['A','B'],[],4)};
  return {review,playDefinition};
}
export async function makePresentationFixture() {
  const ids=['P1','P2','P3','P4','P5','P6'],count=12;
  const review=reviewFor(count,ids,(i,f)=>({x:3+i*2+(i<3?f*.06:0),y:3+i+(i===2?f*.03:0)}),.04);
  const action=(actionId,actorId,kind,startFrame,endFrameExclusive)=>({actionId,actorId,kind,startFrame,endFrameExclusive,participantIds:[actorId],source:'human_video_review',reviewStatus:'reviewed'});
  const actions=[action('carry','P1','move',0,8),action('cut','P2','cut',0,6),action('screen','P3','screen',0,6),action('space','P4','space',0,12),
    action('hold','P5','hold',0,12),action('defend','P6','hold',0,12),action('roll','P3','roll',6,12),action('pop','P2','pop',6,12)];
  const relations=[{id:'screen-relation',actionId:'screen',screenerId:'P3',beneficiaryId:'P1',defenderId:'P6',startFrame:0,endFrameExclusive:6,
    position:{x:7.12,y:5.06,frame:2},orientation:{x:0,y:1},source:'human_video_review',reviewStatus:'reviewed'}];
  const playDefinition={schemaVersion:1,synthetic:true,playId:'synthetic-screen-and-space',revision:1,startFrame:0,endFrameExclusive:count,
    sourceBinding:await createSourceBinding(review),participants:ids.map((id,i)=>({id,name:`合成人物 ${i+1}`,role:i===5?'defender':'offense'})),
    phases:[{phaseId:'setup',order:0,title:'持球、切入与掩护',startFrame:0,endFrameExclusive:6,freezeFrame:2,participantIds:ids,actionIds:actions.slice(0,6).map(a=>a.actionId),relationIds:['screen-relation']},
      {phaseId:'finish',order:1,title:'顺下与外弹',startFrame:6,endFrameExclusive:12,freezeFrame:8,participantIds:ids,actionIds:['carry','space','hold','defend','roll','pop'],relationIds:[]}],
    actions,relations,reviewEvidence:proof(ids,actions.map(a=>a.actionId),relations.map(r=>r.id),count)};
  return {review,playDefinition};
}
