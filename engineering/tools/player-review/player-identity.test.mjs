import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveObjectURL} from 'node:buffer';
import {blankSession,draftStorageKey,isHumanIdentitySelected} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';

// Run the shipped app. Only browser layout, React roots, media and HTTP are
// replaced; the draft, annotations, identity module, export and click routing
// stay real. HTTP fixtures use the agreed server response, including nulls.
const rating={record_id:'name:mikeconley@2024-25',game:'2K25',season:'2024-25',status:'partial',
  ratings:{overall:82,three_point_shot:84,mid_range_shot:76,close_shot:72,layup:85,driving_dunk:25,
    ball_handle:88,speed_with_ball:75,perimeter_defense:80,interior_defense:35,block:null,help_defense_iq:78,defensive_consistency:70},
  field_provenance:{three_point_shot:{source_id:'snapshot-25',url:'https://example.com/fixed-2k25',game:'2K25',snapshot_date:'2024-11-26T02:25:26Z',date_basis:'repository_snapshot'}}};
const conley={player_id:'name:mikeconley',name:'Mike Conley',season:'2024-25',team_abbreviation:'MIN',jersey_number:'10',
  season_roster:[{team_abbreviation:'MIN',jersey_numbers:['10']}],rating};
const options={seasons:['2024-25','2025-26'],teams:[{abbreviation:'MIN',name:'Minnesota Timberwolves'},
  {abbreviation:'BOS',name:'Boston Celtics'},{abbreviation:'DET',name:'Detroit Pistons'}],dataset_scope:{roster:'season_roster_including_departed'}};
const flush=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};

async function openIdentityApp({qa=true,lookup=null,optionsResponse=null,savedSession=null}={}){
  const frames=[.12,.158,.205].map((time,frame)=>({frame,time,source_frame:100+frame,source_time:12.12+(time-.12),
    tracks:[[100,80,220,320,7,.95,2],[400,100,530,330,8,.93,2]],track_roles:{7:'player',8:'player'}}));
  const clip={video_sha256:'identity-video',tracking_fingerprint:'identity-raw-v1',tracking_revision:'team-stable',
    width:1280,height:720,frames,sourceCuts:[],track_roles:{7:'player',8:'player'},variants:[{id:'team-stable',label:'篮球'}],
    trackingMetadata:{model:'basketball',tracker:'BoT-SORT',presentation:{default_stable:true}}};
  const session=blankSession(clip.video_sha256);
  confirmIdentity(session,'P1',0,{box:frames[0].tracks[0].slice(0,4),trackId:7},frames);
  Object.assign(session.entities[0],{name:'人工姓名',team:'白衣手工记录',jersey:'7',teamGroup:'A',teamGroupSource:'human'});
  session.entities[1].modelBindings=[{kind:'track',start:0,end:2,trackId:8,source:'model_suggestion',identityConfirmed:false,reviewRequired:true}];
  const key=draftStorageKey(clip,'team-stable',qa),saved=new Map([[key,JSON.stringify(savedSession||session)]]),nodes=new Map(),created=[],requests=[],responses=[];
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  function make(){
    const context={labels:[],boxes:[],strokeStyle:'',clearRect(){this.labels=[];this.boxes=[];},
      strokeRect(...box){this.boxes.push({box,color:this.strokeStyle});},fillText(value){this.labels.push(value);},measureText:value=>({width:String(value).length*8})};
    const ctx=new Proxy(context,{get:(value,key)=>key in value?value[key]:(()=>{})});
    const node={children:[],listeners:{},attributes:{},dataset:{},style:{setProperty(){}},value:'',checked:false,hidden:false,disabled:false,
      textContent:'',tagName:'DIV',clientWidth:1280,clientHeight:720,width:1280,height:720,paused:true,currentTime:0,
      classList:{add(){},remove(){},toggle(){}},append(...children){this.children.push(...children);},prepend(...children){this.children.unshift(...children);},
      replaceChildren(...children){this.children=children;},setAttribute(key,value){this.attributes[key]=String(value);},
      getAttribute(key){return this.attributes[key]??null;},addEventListener(key,fn){(this.listeners[key]||=[]).push(fn);},
      click(){if(!this.disabled)this.dispatch('click',{target:this});},
      dispatch(key,event={}){const delivered={...event,currentTarget:this,target:event.target||this};this[`on${key}`]?.(delivered);for(const fn of this.listeners[key]||[])fn(delivered);},
      focus(){},scrollIntoView(){},getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
      pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},requestVideoFrameCallback(){},
      setPointerCapture(){},hasPointerCapture:()=>false,releasePointerCapture(){},ctx};created.push(node);return node;
  }
  const get=id=>{if(!nodes.has(id)){const node=make(),tag=html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0]||'';
    node.checked=/\bchecked\b/.test(tag);node.hidden=/\bhidden\b/.test(tag);node.disabled=/\bdisabled\b/.test(tag);nodes.set(id,node);}return nodes.get(id);};
  const tabs=['footage','identity','calibration','repair','events'].map(step=>{const tab=get(`tab-${step}`);tab.dataset.step=step;tab.setAttribute('aria-selected',String(step==='footage'));return tab;});
  const body={dataset:{reviewView:'advanced'}};
  const document={body,activeElement:null,getElementById:get,createElement:make,addEventListener(){},querySelector:()=>get('player-overview'),querySelectorAll:selector=>selector==='button[data-step]'?tabs:[]};
  const globals=['document','window','devicePixelRatio','location','fetch','localStorage','requestAnimationFrame','setTimeout','clearTimeout'];
  const previous=new Map(globals.map(name=>[name,globalThis[name]]));
  const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url)));
  Object.assign(globalThis,{document,window:{addEventListener(){},history:{replaceState(){}}},devicePixelRatio:1,
    location:{search:`?sample=test&variant=team-stable${qa?'&qa=1':''}`,assign(){}},requestAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},
    fetch:async raw=>{requests.push(raw);const url=new URL(raw,'http://localhost');let body;
      if(url.pathname==='/api/player-identity/options')body=optionsResponse?await optionsResponse(url):{...options,teams:url.searchParams.has('season')?options.teams:[]};
      else if(url.pathname==='/api/player-identity/lookup'){
        const query=Object.fromEntries(['season','team','jersey'].map(key=>[key,url.searchParams.get(key)]));
        body=lookup?await lookup(query):{query,status:'unique_candidate',candidates:[conley]};
      }else body=raw==='/api/library'?{defaultSample:'test',samples:[{id:'test',title:'测试视频',defaultVariant:'team-stable'}]}:raw==='/team-overlay-policy.json'?policy:clip;
      return {ok:true,status:200,json:async()=>{const copy=structuredClone(body);responses.push(copy);return copy;}};
    }});
  let appApi,identityActions,identityState;
  const restore=()=>{for(const [name,value] of previous){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}};
  try{
    const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),imports=[...source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)],dependencies={};
    for(const match of imports){
      if(match[2]==='./ui.bundle.mjs'){dependencies.mountIdentityUI=actions=>{identityActions=actions;return {render(state){identityState=state;}};};
        dependencies.mountVideoDisplay=({video,stage,startTime,onReady})=>{
          stage.dataset.videoState='ready';video.currentTime=startTime;onReady?.({time:startTime});
          return {pause:()=>video.pause(),seek:time=>{video.pause();video.currentTime=time;},
            reload:()=>{video.pause();video.currentTime=startTime;},togglePlayback:()=>video.paused?video.play():video.pause()};
        };continue;}
      if(match[2]==='./tactics-storage.mjs'){dependencies.migrateLegacyTacticsDrafts=async()=>{};continue;}
      if(match[2]==='./tactics-ui.mjs'){dependencies.mountTacticsUI=()=>({saveDraft(){}});continue;}
      if(match[2]==='./footage-ui.mjs'){dependencies.mountFootageUI=()=>({render(){}});continue;}
      if(match[2]==='./workspace.mjs'){dependencies.createWorkspace=api=>{appApi=api;return {refresh(){},draw(){},drawImageOverlay(){},handleImageClick:()=>false,
        switchStep(step){document.body.dataset.step=step;get('overlay').hidden=step==='footage';for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.step===step));api.setMode('select',{edit:false});}};};continue;}
      const module=await import(new URL(match[2],import.meta.url));
      for(const part of match[1].split(',')){const [name,alias=name]=part.trim().split(/\s+as\s+/);dependencies[alias]=module[name];}
    }
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(dependencies),source.replace(/^import .*;\r?\n/gm,''))(...Object.values(dependencies));await flush();
    return {get,clip,key,saved,requests,responses,created,state:()=>appApi.getState(),body,restore,
      select:id=>identityActions.select(id),identityState:()=>identityState,
      set:(id,value,event='change')=>{get(id).value=value;get(id).dispatch(event);},
      async query({season='2024-25',team='MIN',jersey='10'}={}){
        get('profileSeason').value=season;get('profileSeason').dispatch('change');await flush();
        get('profileTeam').value=team;get('profileTeam').dispatch('change');get('profileJersey').value=jersey;get('profileJersey').dispatch('input');
        get('profileLookup').click();await flush();
      },
      choose:pid=>{get('profileCandidate').value=pid;get('profileCandidate').dispatch('change');},
      async confirm(){get('profileConfirm').click();await flush();},
      textTree:node=>{const visit=current=>`${current.textContent||''} ${current.children.map(visit).join(' ')}`;return visit(node);}};
  }catch(error){restore();throw error;}
}

test('lookup and candidate selection stay provisional until explicit confirmation preserves legacy fields and track data',async()=>{
  const app=await openIdentityApp();try{
    const before=structuredClone(app.state().session),legacy=structuredClone(before.entities[0]);
    await app.query();assert.deepEqual(app.state().session,before);app.choose('name:mikeconley');assert.deepEqual(app.state().session,before);
    await app.confirm();const entity=app.state().session.entities[0];
    assert.equal(entity.playerProfile?.player_id,'name:mikeconley');assert.equal(entity.playerProfile?.status,'confirmed');
    assert.equal(entity.playerProfile?.player_id_namespace,'normalized_name_key');assert.deepEqual(entity.playerProfile?.season_roster,conley.season_roster);
    assert.equal(entity.ratingReference?.ratings.block,null);assert.equal(entity.ratingReference?.ratings.three_point_shot,84);
    for(const key of Object.keys(legacy))assert.deepEqual(entity[key],legacy[key],`legacy ${key} stays unchanged`);
    assert.equal(app.state().session.gameContext?.season,'2024-25');
    assert.deepEqual(entity.playerProfile?.evidence,{videoSha256:'identity-video',trackingFingerprint:'identity-raw-v1',variant:'team-stable',frame:0,sourceFrame:100,sourcePTS:12.12,trackId:7,visibility:'observed_needs_review'});
  }finally{app.restore();}
});

test('confirming the real person profile does not turn a model track into a human association',async()=>{
  const app=await openIdentityApp();try{
    app.select('P2');const before=structuredClone(app.state().session.entities[1]);await app.query();app.choose('name:mikeconley');await app.confirm();
    const entity=app.state().session.entities[1];assert.equal(entity.playerProfile?.player_id,'name:mikeconley');
    assert.equal(isHumanIdentitySelected(entity),false);assert.deepEqual(entity.modelBindings,before.modelBindings);assert.deepEqual(entity.identityKeyframes,before.identityKeyframes);
    assert.equal(app.identityState().entities.length,10);assert.deepEqual(app.identityState().entities.map(entity=>entity.id.replace(/^P/,'')),['1','2','3','4','5','6','7','8','9','10']);
  }finally{app.restore();}
});

test('changing the selected number discards a candidate before a confirmation can affect another player',async()=>{
  const app=await openIdentityApp();try{
    const before=structuredClone(app.state().session);await app.query();app.choose('name:mikeconley');app.select('P2');await app.confirm();
    assert.equal(app.get('profileConfirm').disabled,true);assert.deepEqual(app.state().session,before);assert.equal(app.get('undo').disabled,true);
  }finally{app.restore();}
});

test('the same real player cannot be confirmed for two numbers and rejection creates no undo entry',async()=>{
  const app=await openIdentityApp();try{
    const original=structuredClone(app.state().session);await app.query();app.choose('name:mikeconley');await app.confirm();
    const afterFirst=structuredClone(app.state().session);assert.equal(afterFirst.entities[0].playerProfile?.player_id,'name:mikeconley');
    app.select('P2');await app.query();app.choose('name:mikeconley');await app.confirm();assert.deepEqual(app.state().session,afterFirst);
    app.get('undo').click();assert.deepEqual(app.state().session,original);assert.equal(app.get('undo').disabled,true);
  }finally{app.restore();}
});

test('a second video season is rejected while another number retains an identity from the first season',async()=>{
  const app=await openIdentityApp({lookup:query=>({query,status:'unique_candidate',candidates:[query.season==='2024-25'?conley:{...conley,season:'2025-26',rating:{...rating,record_id:null,game:'2K26',season:'2025-26',status:'not_in_rating_scope'}}]})});
  try{
    await app.query();app.choose('name:mikeconley');await app.confirm();assert.equal(app.state().session.gameContext?.season,'2024-25');
    app.select('P2');const before=structuredClone(app.state().session);await app.query({season:'2025-26'});app.choose('name:mikeconley');await app.confirm();
    assert.deepEqual(app.state().session,before);assert.match(app.get('profileLookupStatus').textContent,/赛季|清除/);
  }finally{app.restore();}
});

test('clear removes only confirmed profile and rating reference, and undo restores both with nulls and sources',async()=>{
  const app=await openIdentityApp();try{
    const legacy=structuredClone(app.state().session.entities[0]);await app.query();app.choose('name:mikeconley');await app.confirm();
    const confirmed=structuredClone(app.state().session);assert.equal(confirmed.entities[0].playerProfile?.player_id,'name:mikeconley');
    app.get('profileClear').click();assert.deepEqual(app.state().session.entities[0],legacy);assert.equal(app.get('profileClear').disabled,true);
    app.get('undo').click();assert.deepEqual(app.state().session,confirmed);assert.equal(app.state().session.entities[0].ratingReference.ratings.block,null);
    assert.deepEqual(app.state().session.entities[0].ratingReference.field_provenance,rating.field_provenance);
  }finally{app.restore();}
});

test('a lookup that returns after changing numbers cannot populate or confirm the new number',async()=>{
  let finish;const app=await openIdentityApp({lookup:query=>new Promise(resolve=>finish=()=>resolve({query,status:'unique_candidate',candidates:[conley]}))});
  try{
    const before=structuredClone(app.state().session);await app.query();assert.ok(app.requests.some(url=>url.startsWith('/api/player-identity/lookup')),'explicit lookup sends the staged query');app.select('P2');finish();await flush();
    app.choose('name:mikeconley');await app.confirm();assert.equal(app.get('profileConfirm').disabled,true);assert.deepEqual(app.state().session,before);
    assert.equal(app.get('profileCandidate').children.length,1);
  }finally{app.restore();}
});

test('editing the number invalidates both a selected candidate and a pending older response',async()=>{
  let finish;const app=await openIdentityApp({lookup:query=>new Promise(resolve=>finish=()=>resolve({query,status:'unique_candidate',candidates:[conley]}))});
  try{
    await app.query();assert.ok(app.requests.some(url=>url.startsWith('/api/player-identity/lookup')),'explicit lookup sends the staged query');app.set('profileJersey','00','input');finish();await flush();app.choose('name:mikeconley');await app.confirm();
    assert.equal(app.get('profileConfirm').disabled,true);assert.equal(app.state().session.entities[0].playerProfile,undefined);assert.equal(app.get('undo').disabled,true);
  }finally{app.restore();}
});

test('a lookup failure keeps an already confirmed profile, ratings and saved draft',async()=>{
  let failing=false;const app=await openIdentityApp({lookup:query=>{if(failing)throw new Error('offline');return {query,status:'unique_candidate',candidates:[conley]};}});
  try{
    await app.query();app.choose('name:mikeconley');await app.confirm();assert.equal(app.state().session.entities[0].playerProfile?.player_id,'name:mikeconley');
    const before=structuredClone(app.state().session),saved=app.saved.get(app.key);failing=true;await app.query({jersey:'99'});
    assert.deepEqual(app.state().session,before);assert.equal(app.saved.get(app.key),saved);assert.equal(app.get('profileConfirm').disabled,true);
    assert.match(app.textTree(app.get('profileRatingCard')),/84/);assert.match(app.textTree(app.get('profileRatingCard')),/未知/);
  }finally{app.restore();}
});

test('jersey lookup and confirmation keep 00 distinct from 0 as text',async()=>{
  const holland={...conley,player_id:'name:ronholland',name:'Ron Holland',team_abbreviation:'DET',jersey_number:'00',rating:{...rating,record_id:'name:ronholland@2024-25'}};
  const app=await openIdentityApp({lookup:query=>({query,status:'unique_candidate',candidates:[holland]})});try{
    await app.query({team:'DET',jersey:'00'});app.choose('name:ronholland');await app.confirm();
    assert.equal(app.state().session.entities[0].playerProfile?.jersey_number,'00');
    const request=app.requests.find(url=>url.startsWith('/api/player-identity/lookup'));assert.equal(new URL(request,'http://localhost').searchParams.get('jersey'),'00');
  }finally{app.restore();}
});

test('a mismatched response or rating season cannot be accepted and does not create an undo edit',async()=>{
  const app=await openIdentityApp({lookup:query=>({query,status:'unique_candidate',candidates:[{...conley,rating:{...rating,season:'2025-26',game:'2K26'}}]})});
  try{
    const before=structuredClone(app.state().session);await app.query();app.choose('name:mikeconley');await app.confirm();
    assert.equal(app.get('profileConfirm').disabled,true);assert.deepEqual(app.state().session,before);assert.equal(app.get('undo').disabled,true);
    assert.match(app.get('profileLookupStatus').textContent,/赛季|数据|返回/);
  }finally{app.restore();}
});

test('export includes all ten profile references while preserving original trajectory and source PTS',async()=>{
  const app=await openIdentityApp({qa:false});try{
    await app.query();app.choose('name:mikeconley');await app.confirm();app.get('export').click();
    const link=app.created.find(node=>node.download==='reviewed-player-tracks.json');assert.ok(link);
    const output=JSON.parse(await resolveObjectURL(link.href).text());URL.revokeObjectURL(link.href);
    assert.equal(output.gameContext?.season,'2024-25');assert.equal(output.playerIdentities?.length,10);
    assert.equal(output.playerIdentities?.[0].playerProfile?.player_id,'name:mikeconley');assert.equal(output.playerIdentities?.[0].ratingReference?.ratings.block,null);
    assert.equal(output.playerIdentities?.[9].id,'P10');assert.equal(output.playerIdentities?.[9].playerProfile,null);
    assert.equal(output.sourceFrameMapping[0].sourceTime,12.12);assert.equal(output.entities[0].trajectory[0].trackId,7);
    assert.equal(output.entities[0].name,'人工姓名');
  }finally{app.restore();}
});

test('multiple exact roster candidates remain unconfirmed until the user chooses a particular name',async()=>{
  const springer={...conley,player_id:'name:jadenspringer',name:'Jaden Springer',team_abbreviation:'BOS',jersey_number:'44',rating:{...rating,record_id:'name:jadenspringer@2024-25'}};
  const norris={...springer,player_id:'name:milesnorris',name:'Miles Norris',rating:{...rating,record_id:'name:milesnorris@2024-25'}};
  const app=await openIdentityApp({lookup:query=>({query,status:'multiple_candidates',candidates:[springer,norris]})});try{
    await app.query({team:'BOS',jersey:'44'});assert.equal(app.get('profileCandidate').children.length,3);
    await app.confirm();assert.equal(app.state().session.entities[0].playerProfile,undefined);assert.equal(app.get('undo').disabled,true);
    app.choose('name:milesnorris');await app.confirm();assert.equal(app.state().session.entities[0].playerProfile?.player_id,'name:milesnorris');
  }finally{app.restore();}
});

test('clearing the last identity allows an explicit new season without borrowing the older ratings',async()=>{
  const empty=Object.fromEntries(Object.keys(rating.ratings).map(key=>[key,null]));
  const app=await openIdentityApp({lookup:query=>({query,status:'unique_candidate',candidates:[query.season==='2024-25'?conley:{...conley,season:'2025-26',rating:{record_id:null,game:'2K26',season:'2025-26',status:'not_in_rating_scope',ratings:empty,field_provenance:{}}}]})});
  try{
    await app.query();app.choose('name:mikeconley');await app.confirm();assert.equal(app.state().session.entities[0].playerProfile?.season,'2024-25');
    app.get('profileClear').click();await app.query({season:'2025-26'});app.choose('name:mikeconley');await app.confirm();
    assert.equal(app.state().session.gameContext?.season,'2025-26');assert.equal(app.state().session.entities[0].ratingReference?.status,'not_in_rating_scope');
    assert.deepEqual(app.state().session.entities[0].ratingReference?.ratings,empty);assert.match(app.textTree(app.get('profileRatingCard')),/未知|范围/);
  }finally{app.restore();}
});

test('confirmed identity and rating sources are deep copies that restore from the existing draft namespace',async()=>{
  const app=await openIdentityApp();let savedSession;try{
    await app.query();app.choose('name:mikeconley');await app.confirm();assert.equal(app.state().session.entities[0].playerProfile?.player_id,'name:mikeconley');
    savedSession=JSON.parse(app.saved.get(app.key));const response=app.responses.find(item=>item.candidates);
    response.candidates[0].rating.ratings.three_point_shot=1;response.candidates[0].season_roster[0].jersey_numbers[0]='99';
    assert.equal(app.state().session.entities[0].ratingReference.ratings.three_point_shot,84);assert.equal(app.state().session.entities[0].playerProfile.season_roster[0].jersey_numbers[0],'10');
  }finally{app.restore();}
  const restored=await openIdentityApp({savedSession});try{
    assert.deepEqual(restored.state().session,savedSession);assert.match(restored.get('profileSummary').textContent,/Mike Conley/);
    assert.match(restored.textTree(restored.get('profileRatingCard')),/84/);assert.equal(restored.get('undo').disabled,true);
  }finally{restored.restore();}
});

test('a slow team-options response from an older season cannot replace the current season choices',async()=>{
  let finish;const app=await openIdentityApp({optionsResponse:url=>{
    const season=url.searchParams.get('season');
    if(season==='2024-25')return new Promise(resolve=>finish=()=>resolve({...options,teams:[{abbreviation:'BOS',name:'Boston Celtics'}]}));
    return {...options,teams:season?[{abbreviation:'GSW',name:'Golden State Warriors'}]:[]};
  }});try{
    app.set('profileSeason','2024-25');await flush();assert.ok(app.requests.some(url=>url.includes('options?season=2024-25')),'selected season loads its teams');
    app.set('profileSeason','2025-26');await flush();finish();await flush();
    assert.deepEqual(app.get('profileTeam').children.map(item=>item.value),['','GSW']);assert.equal(app.get('profileConfirm').disabled,true);
  }finally{app.restore();}
});

test('an expanded capability source remains open when the video redraws another frame of the same player',async()=>{
  const app=await openIdentityApp();try{
    await app.query();app.choose('name:mikeconley');await app.confirm();
    app.get('profileRatingCard').children.at(-1).open=true;app.set('scrubber','1','input');
    assert.equal(app.get('profileRatingCard').children.at(-1).open,true);
  }finally{await flush();app.restore();}
});
