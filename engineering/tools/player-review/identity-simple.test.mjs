import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedIdentityObservation,applyMatchupReading,mountSimpleIdentityRecognition} from './identity-ocr.mjs';

test('explicit unassigned T60 uses its raw box, never the active P9 box',()=>{
 const s={frame:0,selectedTrackId:60,selectedPlayerId:null,point:{trackId:4,box:[1,2,3,4]},clip:{frames:[{tracks:[[10,20,30,60,60,.9,0],[1,2,3,4,4,.9,0]]}]}};
 assert.deepEqual(selectedIdentityObservation(s),{frame:0,trackId:60,box:[10,20,30,60]});
 s.clip.frames[0].tracks=[];assert.equal(selectedIdentityObservation(s),null);
});

const tick=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
function panelFixture(t,{manual=false,teams=[]}={}){
 const doc=globalThis.document,fetcher=globalThis.fetch;
 const make=tag=>({tagName:tag,children:[],textContent:'',value:'',disabled:false,attributes:{},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},setAttribute(k,v){this.attributes[k]=v;}});
 const host=make('div'),calls=[],reads=[],commits=[];
 const s={active:'P9',selectedPlayerId:null,selectedTrackId:60,selectedFrameReady:true,frame:0,sample:'002',variant:'stable',clip:{video_sha256:'v',tracking_fingerprint:'fp',width:100,height:100,frames:[{tracks:[[1,2,30,90,60,.9,0]]}]},session:{videoHash:'v',gameContext:{season:'2024-25'}}};
 if(manual)s.session.gameContext.matchup={videoSha256:'v',source:'human',teams:['HOU','DAL']};
 globalThis.document={getElementById:()=>host,createElement:make};
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);return new Promise(resolve=>calls.push({body,reply:(data,ok=true)=>resolve({ok,json:async()=>data})}));};
 const panel=mountSimpleIdentityRecognition({getState:()=>s,commit:copy=>{commits.push(copy);s.session=copy;panel.render();},onReading:(...r)=>reads.push(r),getTeams:()=>teams});
 const all=n=>[n,...n.children.flatMap(all)],button=text=>all(host).find(n=>n.tagName==='button'&&n.textContent===text);
 t.after(()=>{globalThis.document=doc;globalThis.fetch=fetcher;});
 return {s,panel,calls,reads,commits,button,select:label=>all(host).find(n=>n.attributes['aria-label']===label),text:()=>all(host).map(n=>n.textContent).join(' ')};
}
test('startup identifies both teams once; manual correction during flight is preserved',async t=>{
 const f=panelFixture(t);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body.scoreboardRegion,[0,0,100,100]);
 f.panel.render();assert.equal(f.calls.length,1);
 f.s.session.gameContext.matchup={videoSha256:'v',source:'human',teams:['HOU','DAL']};
 f.calls[0].reply({mode:'scoreboard_vision',engine:'codex-vision',videoSha256:'v',trackingFingerprint:'fp',candidates:[{value:'BOS'},{value:'MIN'}]});await tick();
 assert.equal(f.commits.length,0);assert.deepEqual(f.s.session.gameContext.matchup.teams,['HOU','DAL']);
});
test('failed auto recognition does not loop, explicit retry remains available',async t=>{
 const f=panelFixture(t);f.calls[0].reply({error:'private diagnostic'},false);await tick();
 f.panel.render();f.panel.render();assert.equal(f.calls.length,1);assert.match(f.text(),/手工选择两队或重试/);
 const retry=f.button('重新识别球队').onclick();assert.equal(f.calls.length,2);
 f.calls[1].reply({mode:'scoreboard_vision',engine:'codex-vision',videoSha256:'v',trackingFingerprint:'fp',candidates:[]});await retry;
});
test('late auto teams prefill correction selectors but preserve in-progress human choices',async t=>{
 const teams=['DAL','HOU','BOS','MIN'].map(abbreviation=>({abbreviation,name:abbreviation})),f=panelFixture(t,{teams});
 const a=f.select('本场第一支球队'),b=f.select('本场第二支球队');assert.equal(a.value,'');
 f.calls[0].reply({mode:'scoreboard_vision',engine:'codex-vision',videoSha256:'v',trackingFingerprint:'fp',candidates:[{value:'DAL'},{value:'HOU'}]});await tick();
 assert.equal(a.value,'DAL');assert.equal(b.value,'HOU');
 a.value='BOS';a.onchange();const next=f.button('重新识别球队').onclick();
 f.calls[1].reply({mode:'scoreboard_vision',engine:'codex-vision',videoSha256:'v',trackingFingerprint:'fp',candidates:[{value:'MIN'},{value:'DAL'}]});await next;
 assert.equal(a.value,'BOS');assert.equal(b.value,'HOU');
});
test('a matchup team absent from the current catalog stays unselected',t=>{
 const f=panelFixture(t,{manual:true,teams:[{abbreviation:'DAL',name:'Dallas'}]});
 assert.equal(f.select('本场第一支球队').value,'');assert.equal(f.select('本场第二支球队').value,'DAL');
});
test('recognizing unassigned T60 keeps result provisional and discards changed selection',async t=>{
 const f=panelFixture(t,{manual:true});assert.equal(f.calls.length,0);
 const job=f.button('识别选中球员').onclick();assert.deepEqual(f.calls[0].body.observations,[{frame:0,trackId:60,box:[1,2,30,90]}]);
 f.calls[0].reply({mode:'player_vision',engine:'codex-vision',videoSha256:'v',trackingFingerprint:'fp',observation:f.calls[0].body.observations[0],reading:{team:'HOU',jersey:'00',reason:'visible',confidence:.9}});await job;
 assert.equal(f.commits.length,0);assert.equal(f.reads[0][1].playerId,null);assert.equal(f.reads[0][0].jersey,'00');
 const late=f.button('识别选中球员').onclick();f.s.selectedTrackId=7;f.panel.render();
 f.calls[1].reply({mode:'player_vision',engine:'codex-vision',videoSha256:'v',trackingFingerprint:'fp',observation:f.calls[1].body.observations[0],reading:{team:'DAL',jersey:'1'}});await late;
 assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
});
test('automatic matchup preserves manual teams and season and is scoped to video',()=>{
 const session={videoHash:'v',gameContext:{season:'2024-25',matchup:{teams:['DAL','HOU'],source:'human',videoSha256:'v'}}};
 const response={videoSha256:'v',candidates:[{value:'BOS'},{value:'MIN'}]};
 assert.equal(applyMatchupReading(session,response),false);assert.equal(session.gameContext.season,'2024-25');
 delete session.gameContext.matchup;assert.equal(applyMatchupReading(session,response),true);
 assert.deepEqual(session.gameContext.matchup.teams,['BOS','MIN']);assert.equal(session.gameContext.season,'2024-25');
 assert.throws(()=>applyMatchupReading(session,{...response,videoSha256:'other'}));
});
