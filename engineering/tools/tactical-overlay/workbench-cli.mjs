import {buildCourtPreparation,validateCourtPreparation,preparationDigest} from '../player-review/court-preparation.mjs';
import {previewGroundTrajectory,adoptGroundTrajectory,replayCourtPreparation,groundSourceBinding} from '../player-review/ground-trajectory.mjs';
import {buildTrajectories} from '../player-review/trajectory.mjs';
import {validateDocument} from '../player-review/tactics-document.mjs';
import {makeCandidateFixture} from './fixtures/005-candidate/generate.mjs';
import {buildTacticalOverlay} from './overlay.mjs';
import {buildPreviewHtml} from './preview.mjs';
import {AGENT_SCHEMA,AGENT_SCHEMA_V3,AGENT_SCHEMA_VIDEO,documentDigest,adoptAgentCandidate} from '../player-review/tactics-agent.mjs';
import {annotationPresentation} from '../player-review/tactics-annotations.mjs';
import {compileProduction,renderProductionSvg,importAuthoredProduction} from '../player-review/tactics-production.mjs';
// Keep partial UTF-8 code points between pipe chunks, including large Chinese drafts.
process.stdin.setEncoding('utf8');
let input='';for await(const chunk of process.stdin)input+=chunk;
try{
  const request=JSON.parse(input);
  if(request.operation==='preparation-digest')process.stdout.write(JSON.stringify({digest:preparationDigest(request.preparation)}));
  else if(request.operation==='court-preparation-build')process.stdout.write(JSON.stringify({preparation:buildCourtPreparation({session:request.session,clip:request.clip}),imageByPlayer:buildTrajectories(request.session,request.clip.frames,request.clip.sourceCuts??[])}));
  else if(request.operation==='court-preparation-replay')process.stdout.write(JSON.stringify({preparation:replayCourtPreparation(request.preparation,request.operations??request.patches??[])}));
  else if(request.operation==='ground-trajectory-source')process.stdout.write(JSON.stringify({sourceBinding:groundSourceBinding(request.preparation)}));
  else if(request.operation==='ground-trajectory-preview')process.stdout.write(JSON.stringify(previewGroundTrajectory(request.preparation,request.input)));
  else if(request.operation==='ground-trajectory-adopt')process.stdout.write(JSON.stringify({preparation:adoptGroundTrajectory(request.preparation,request.candidate)}));
  else if(request.operation==='court-preparation-validate'){
    validateCourtPreparation(request.preparation);
    if(request.session.videoHash!==request.clip.video_sha256)throw new Error('准备来源视频不匹配。');
    const expected=replayCourtPreparation(buildCourtPreparation({session:request.session,clip:request.clip}),request.preparation.operations??request.preparation.smoothingPatches);
    if(preparationDigest(expected)!==preparationDigest(request.preparation))throw new Error('准备数据与原始来源或有序处理记录不一致。');
    process.stdout.write(JSON.stringify({valid:true}));
  }else if(request.operation==='agent-schema')process.stdout.write(JSON.stringify(request.version===3?AGENT_SCHEMA_V3:request.version===4?AGENT_SCHEMA_VIDEO:AGENT_SCHEMA));
  else if(request.operation==='agent-digest')process.stdout.write(JSON.stringify({digest:await documentDigest(request.document)}));
  else if(request.operation==='production-compile'){await validateDocument(request.document);process.stdout.write(JSON.stringify(compileProduction(request.document,request.options)));}
  else if(request.operation==='production-svg'){await validateDocument(request.document);process.stdout.write(JSON.stringify({svg:renderProductionSvg(request.document,request.frameState)}));}
  else if(request.operation==='production-import-authored')process.stdout.write(JSON.stringify({document:await importAuthoredProduction(request.document,request.legacyConfig)}));
  else if(request.operation==='agent-adopt'){
    const document=await adoptAgentCandidate(request.document,request.candidate,request.options);
    const annotationIds=(document.annotations?.items??[]).filter(a=>a.origin?.jobId===request.options.jobId).map(a=>a.id);
    process.stdout.write(JSON.stringify({document,presentation:annotationPresentation(document,{annotationIds})}));
  }
  else if(request.operation==='candidate'){
    const {review,playDefinition}=await makeCandidateFixture();
    process.stdout.write(JSON.stringify({schemaVersion:1,title:'THY · 005 SAS–MIA 三阶段候选',notes:'六名参与者及动作均待人工复核。此快照独立于当前工作台草稿。',review,playDefinition}));
  }else{
    const d=await validateDocument(request.document);
    if(request.operation==='export'){
      const scenes=[];
      for(const phase of d.playDefinition.phases){
        const manifest=await buildTacticalOverlay({review:d.review,playDefinition:d.playDefinition,phaseId:phase.phaseId,freezeFrame:phase.freezeFrame});
        const mode=manifest.videoOverlay?.available?'video':'court';
        const background=mode==='video'?{...request.frames.find(f=>f.frame===phase.freezeFrame),sourceBinding:manifest.sourceBinding}:null;
        scenes.push({title:phase.title,manifest,mode,background});
      }
      const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const notes=`<section aria-label="讲解与审核意见"><h2>讲解与审核意见</h2><p style="white-space:pre-wrap">${escape(d.notes)}</p></section>`;
      const scope=`<section aria-label="导出范围"><h2>导出范围</h2><p>此冻结帧报告仅绘制既有动作与审核快照，不包含工作台的平滑未来路线或人工展示修正。完整展示修正及来源绑定保留在战术审核数据 JSON，请同时导出 JSON。${d.presentation?.routes.length?`本次文档含 ${d.presentation.routes.length} 项展示修正。`:''}</p></section>`;
      process.stdout.write(JSON.stringify({html:buildPreviewHtml({title:d.title,scenes}).replace('</main>',scope+notes+'</main>')}));
    }else process.stdout.write(JSON.stringify({valid:true}));
  }
}catch(error){process.stderr.write(error.message);process.exitCode=1;}
