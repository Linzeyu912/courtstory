import test from 'node:test';
import assert from 'node:assert/strict';
import {mountIdentityOCR,scoreboardRegionForPreset} from './identity-ocr.mjs';
import {blankSession} from './trajectory.mjs';

const all=node=>[node,...node.children.flatMap(all)];
function setup(t,{response=null,pending=false}={}){
  const make=tag=>({tagName:tag,children:[],value:'',textContent:'',disabled:false,attributes:{},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(key,value){this.attributes[key]=value;}});
  const host=make('div'),previousDocument=globalThis.document,previousFetch=globalThis.fetch,requests=[],commits=[],seeks=[];
  const state={session:blankSession('video'),active:'P1',frame:2,clip:{video_sha256:'video',tracking_fingerprint:'tracking',width:1280,height:720},sample:'pacers',variant:'team-stable',point:null};
  state.session.entities[0].bindings=[{kind:'track',trackId:7,start:0,end:4}];state.session.entities[0].jersey='00';
  let reply,paused=0,teamChanges=0;
  globalThis.document={getElementById:()=>host,createElement:make};
  globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});const data=pending?await new Promise(resolve=>reply=resolve):response;
    return {ok:true,json:async()=>data};};
  const panel=mountIdentityOCR({getState:()=>state,pause:()=>paused++,seek:frame=>seeks.push(frame),onTeam:()=>teamChanges++,commit:session=>{commits.push(structuredClone(session));state.session=session;panel.render();}});
  let restored=false;const restore=()=>{if(restored)return;restored=true;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;globalThis.fetch=previousFetch;};t.after(restore);
  return {host,state,panel,requests,commits,seeks,restore,reply:data=>reply(data),paused:()=>paused,teamChanges:()=>teamChanges,
    button:text=>all(host).find(node=>node.tagName==='button'&&node.textContent===text),
    select:()=>all(host).find(node=>node.attributes['aria-label']==='主比分卡位置'),
    text:()=>all(host).map(node=>node.textContent).join(' ')};
}
const visualResponse=()=>({mode:'scoreboard_vision',engine:'codex-vision',videoSha256:'video',trackingFingerprint:'tracking',scannedFrames:1,scoreboardRegion:[0,633,704,720],candidates:[
  {value:'IND',score:.92,distinctFrames:1,evidence:[{frame:2,time:.067,crop:[0,633,704,720],reason:'主比分卡左侧步行者队标',engine:'codex-vision'}]},
  {value:'BKN',score:.89,distinctFrames:1,evidence:[{frame:2,time:.067,crop:[0,633,704,720],reason:'主比分卡右侧篮网队标',engine:'codex-vision'}]}
]});

test('visual team reading uses one current frame and explicit ROI; candidates need group adoption and retain provenance',async t=>{
  const s=setup(t,{pending:true}),before=structuredClone(s.state.session),job=s.button('Agent 识别队标 / 球队').onclick();
  assert.deepEqual(s.requests,[{url:'/api/identity-ocr',body:{sample:'pacers',variant:'team-stable',videoSha256:'video',mode:'scoreboard_vision',observations:[{frame:2}],scoreboardRegion:[0,633,704,720]}}]);
  assert.equal(s.paused(),1);assert.equal(s.select().disabled,true);assert.equal(s.button('读取记分牌文字队伍').disabled,true);assert.match(s.text(),/正在分析主比分卡队标与球队/);
  const data=visualResponse();s.reply(data);await job;
  assert.deepEqual(s.state.session,before);assert.equal(s.commits.length,0);assert.equal(s.select().disabled,false);
  assert.match(s.text(),/Codex 视觉模型建议/);assert.match(s.text(),/视觉模型估计 92%（非正确率）/);assert.match(s.text(),/步行者队标/);
  s.button('查看第 3 帧').onclick();assert.deepEqual(s.seeks,[2]);
  s.button('绑定红组为 IND').onclick();assert.equal(s.commits.length,1);assert.equal(s.teamChanges(),1);
  assert.equal(s.state.session.teamIdentities.red.method,'scoreboard_vision_human_adopted');
  assert.equal(s.state.session.teamIdentities.red.evidence.engine,'codex-vision');
  assert.deepEqual(s.state.session.teamIdentities.red.evidence.scoreboardRegion,[0,633,704,720]);
  for(let index=0;index<10;index++){const person=s.state.session.entities[index];assert.equal(person.team,index<5?'IND':undefined);assert.deepEqual(person.bindings,before.entities[index].bindings);assert.equal(person.jersey,before.entities[index].jersey);assert.equal(person.playerProfile,undefined);}
  data.candidates[0].evidence[0].reason='changed';assert.match(s.state.session.teamIdentities.red.evidence.evidence[0].reason,/步行者队标/);
  s.button('绑定蓝组为 BKN').onclick();assert.equal(s.state.session.teamIdentities.blue.team,'BKN');
});

test('team text reading shares region selection but keeps its separate OCR source',async t=>{
  const data={...visualResponse(),mode:'scoreboard',engine:'rapidocr',scoreboardRegion:[576,633,1280,720],candidates:[{value:'IND',score:.9,distinctFrames:1,evidence:[{frame:2}]}]};
  const s=setup(t,{response:data});s.select().value='right';await s.button('读取记分牌文字队伍').onclick();
  assert.deepEqual(s.requests[0].body.scoreboardRegion,[576,633,1280,720]);assert.equal(s.requests[0].body.mode,'scoreboard');
  assert.match(s.text(),/文字 OCR 候选/);s.button('绑定红组为 IND').onclick();
  assert.equal(s.state.session.teamIdentities.red.method,'scoreboard_ocr_human_adopted');assert.equal(s.state.session.teamIdentities.red.evidence.engine,'rapidocr');
});

test('visual no-reading, wrong source and confirmed-team conflicts never silently edit identities',async t=>{
  const empty=setup(t,{response:{...visualResponse(),status:'no_reading',candidates:[]}});await empty.button('Agent 识别队标 / 球队').onclick();
  assert.equal(empty.commits.length,0);assert.match(empty.text(),/没有辨认出主比分卡队伍/);assert.equal(empty.button('绑定红组为 IND'),undefined);
  empty.restore();
  const wrong=setup(t,{response:{...visualResponse(),engine:'rapidocr'}});await wrong.button('Agent 识别队标 / 球队').onclick();
  assert.match(wrong.text(),/返回的识别来源不匹配/);assert.equal(wrong.commits.length,0);
  wrong.restore();
  const conflict=setup(t,{response:visualResponse()});conflict.state.session.entities[0].playerProfile={status:'confirmed',team_abbreviation:'BOS'};
  const before=structuredClone(conflict.state.session);await conflict.button('Agent 识别队标 / 球队').onclick();conflict.button('绑定红组为 IND').onclick();
  assert.deepEqual(conflict.state.session,before);assert.equal(conflict.commits.length,0);assert.match(conflict.text(),/已确认的其他球队球员/);
});

test('changing the selected P discards a delayed visual response while the new player controls stay usable',async t=>{
  const s=setup(t,{pending:true}),before=structuredClone(s.state.session),job=s.button('Agent 识别队标 / 球队').onclick();
  s.state.active='P2';s.panel.render();s.reply(visualResponse());await job;
  assert.equal(s.button('绑定红组为 IND'),undefined);assert.equal(s.button('Agent 识别队标 / 球队').disabled,false);assert.deepEqual(s.state.session,before);
});

test('a retained team button from an older request cannot bind after a new recognition task starts',async t=>{
  const s=setup(t,{pending:true}),first=s.button('Agent 识别队标 / 球队').onclick();s.reply(visualResponse());await first;
  const oldButton=s.button('绑定红组为 IND'),second=s.button('Agent 识别队标 / 球队').onclick();
  oldButton.onclick();assert.equal(s.commits.length,0);assert.match(s.text(),/识别任务已变化/);
  s.reply(visualResponse());await second;s.button('绑定红组为 IND').onclick();assert.equal(s.commits.length,1);
});

test('team adoption rejects changed source, variant and tracking fingerprint even when the old button remains present',async t=>{
  const s=setup(t,{response:visualResponse()});await s.button('Agent 识别队标 / 球队').onclick();const old=s.button('绑定红组为 IND'),before=structuredClone(s.state.session);
  for(const [target,key,value] of [[s.state,'sample','other-video'],[s.state,'variant','other-tracker'],[s.state.clip,'video_sha256','new-hash'],[s.state.clip,'tracking_fingerprint','new-tracking']]){
    const previous=target[key];target[key]=value;old.onclick();assert.equal(s.commits.length,0);assert.deepEqual(s.state.session,before);assert.match(s.text(),/视频或跟踪来源已变化/);target[key]=previous;
  }
});

test('a late response is rejected against the live source and a mismatched response fingerprint has no candidates',async t=>{
  const s=setup(t,{pending:true}),job=s.button('Agent 识别队标 / 球队').onclick();s.state.variant='other';s.reply(visualResponse());await job;
  assert.equal(s.button('绑定红组为 IND'),undefined);assert.equal(s.commits.length,0);assert.match(s.text(),/视频或跟踪来源已变化/);
  s.state.variant='team-stable';const next=s.button('Agent 识别队标 / 球队').onclick();s.reply({...visualResponse(),trackingFingerprint:'other'});await next;
  assert.equal(s.button('绑定红组为 IND'),undefined);assert.equal(s.commits.length,0);
});

test('jersey adoption rejects stale request buttons and changed identity bindings as well as changed tracking source',async t=>{
  const data={mode:'jersey',engine:'rapidocr',videoSha256:'video',trackingFingerprint:'tracking',scannedFrames:1,candidates:[{value:'10',score:.8,distinctFrames:1,evidence:[{frame:0}]}]};
  const s=setup(t,{response:data});s.state.frame=0;s.state.point={box:[1,2,30,60],trackId:7,source:'tracked'};s.panel.render();
  await s.button('识别本帧背号').onclick();const old=s.button('采用 #10 到 P1'),before=structuredClone(s.state.session);
  s.state.clip.tracking_fingerprint='new';old.onclick();assert.equal(s.commits.length,0);s.state.clip.tracking_fingerprint='tracking';
  s.state.session.entities[0].bindings.push({kind:'track',trackId:8,start:5,end:8});old.onclick();assert.equal(s.commits.length,0);assert.match(s.text(),/编号关联或原图位置已变化/);
  s.state.session=before;await s.button('识别本帧背号').onclick();old.onclick();assert.equal(s.commits.length,0);assert.match(s.text(),/识别任务已变化/);
});

test('scoreboard presets remain bounded image pixels and malformed dimensions are rejected',()=>{
  assert.deepEqual(scoreboardRegionForPreset({width:1280,height:720},'center'),[288,633,992,720]);
  assert.deepEqual(scoreboardRegionForPreset({width:1280,height:720}),[0,633,704,720]);
  assert.throws(()=>scoreboardRegionForPreset({width:1280,height:720},'whole'));
  assert.throws(()=>scoreboardRegionForPreset({width:1280,height:NaN}));
});
