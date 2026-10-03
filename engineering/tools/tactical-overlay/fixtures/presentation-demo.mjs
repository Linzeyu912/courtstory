import {createSourceBinding} from '../binding.mjs';
import {courtLandmarks} from '../../player-review/court-geometry.mjs';

/** Clearly synthetic movement, deliberately spaced for a readable multi-player arrow demo. */
export async function makePresentationDemo() {
  const count=61,step=.1,ids=['P1','P2','P3','P4','P5','P6'];
  const lerp=(a,b,t)=>a+(b-a)*Math.max(0,Math.min(1,t));
  const pos=(id,f)=>{
    if(id==='P1')return {x:lerp(17,21.2,f/35),y:lerp(10.8,8.8,f/35)};
    if(id==='P2')return f<30?{x:20.7,y:7.2}:{x:lerp(20.7,25.2,(f-30)/30),y:lerp(7.2,6.6,(f-30)/30)};
    if(id==='P3')return f<30?{x:lerp(17.8,21.5,f/29),y:3}:{x:lerp(21.5,17.8,(f-30)/30),y:lerp(3,1.8,(f-30)/30)};
    if(id==='P4')return {x:26.2,y:13.4};
    if(id==='P5')return {x:26.1,y:1.5};
    return {x:19.7,y:10.3};
  };
  const review={schemaVersion:2,synthetic:true,videoSha256:'synthetic-presentation-demo',sourceVideoSha256:'synthetic-presentation-root',
    trackingFingerprint:'synthetic-presentation-tracks',trackingRevision:'visual-v1',confirmedAt:'synthetic',
    width:1280,height:720,allFramesManuallyVerified:false,
    sourceFrameMapping:Array.from({length:count},(_,frame)=>({frame,time:frame*step,sourceFrame:frame,sourceTime:frame*step})),
    settings:{cuts:[],sourceCuts:[]},court:{template:'NBA',units:'metres',length:28.6512,width:15.24,
      referenceId:'synthetic-presentation-floor',metricAccuracyValidated:false,
      calibration:{maxKeyframeGapSeconds:0,keyframes:Array.from({length:count},(_,frame)=>({frame,side:'left',source:'human',status:'accepted_reference',
        points:courtLandmarks().slice(0,4).map(p=>({id:p.id,image:[p.x*40,p.y*40],source:'human'}))}))}},
    entities:ids.map((id,index)=>({id,identityConfirmed:true,anchors:[],trajectory:Array.from({length:count},(_,frame)=>{
      const p=pos(id,frame);return {frame,time:frame*step,x:p.x*40,y:p.y*40,source:'manual',trackId:index+1,
        footMethod:'synthetic_ground_point',identitySource:'manual_range',identityStartFrame:0,identityOrder:1,identityExclusive:true};
    })}))};
  const action=(actionId,actorId,kind,startFrame,endFrameExclusive)=>({actionId,actorId,kind,startFrame,endFrameExclusive,
    participantIds:[actorId],source:'human_video_review',reviewStatus:'reviewed'});
  const actions=[action('carry','P1','move',0,36),action('screen','P2','screen',0,30),action('cut','P3','cut',0,30),
    action('roll','P2','roll',30,count),action('pop','P3','pop',30,count),action('space','P4','space',0,count),
    action('hold','P5','hold',0,count),action('defend','P6','hold',0,count)];
  actions.find(a=>a.actionId==='screen').participantIds=['P2','P1','P6'];
  const relations=[{id:'screen-relation',actionId:'screen',screenerId:'P2',beneficiaryId:'P1',defenderId:'P6',
    startFrame:0,endFrameExclusive:30,position:{x:20.7,y:7.2,frame:12},orientation:{x:0,y:1},source:'human_video_review',reviewStatus:'reviewed'}];
  const proof=(domain,refs={})=>({domain,entityId:null,actionId:null,relationId:null,...refs,startFrame:0,endFrameExclusive:count,
    sourceFrames:Array.from({length:count},(_,i)=>i),reviewer:'synthetic fixture',method:'analytically constructed synthetic observations',conclusion:'reviewed'});
  const names=['持球推进','掩护后顺下','无球切入与外弹','底角拉开','远侧接应','相关防守者'];
  const playDefinition={schemaVersion:1,synthetic:true,playId:'synthetic-tactical-presentation',revision:1,startFrame:0,endFrameExclusive:count,
    sourceBinding:await createSourceBinding(review),participants:ids.map((id,i)=>({id,name:names[i],role:i===5?'defender':'offense'})),
    phases:[{phaseId:'setup',order:0,title:'多人发动：推进、切入与掩护',startFrame:0,endFrameExclusive:30,freezeFrame:12,
      participantIds:ids,actionIds:['carry','screen','cut','space','hold','defend'],relationIds:['screen-relation']},
      {phaseId:'finish',order:1,title:'下一阶段：顺下与外弹',startFrame:30,endFrameExclusive:count,freezeFrame:42,
        participantIds:ids,actionIds:['carry','screen','cut','roll','pop','space','hold','defend'],relationIds:['screen-relation']}],
    actions,relations,reviewEvidence:[proof('calibration'),...ids.flatMap(entityId=>['identity','position','continuity'].map(domain=>proof(domain,{entityId}))),
      ...actions.map(a=>proof('tactic',{actionId:a.actionId})),...relations.map(r=>proof('tactic',{relationId:r.id}))]};
  return {review,playDefinition};
}
