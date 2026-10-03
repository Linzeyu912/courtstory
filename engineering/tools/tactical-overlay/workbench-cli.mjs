import {validateDocument} from '../player-review/tactics-document.mjs';
import {makeCandidateFixture} from './fixtures/005-candidate/generate.mjs';
import {buildTacticalOverlay} from './overlay.mjs';
import {buildPreviewHtml} from './preview.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
try{
  const request=JSON.parse(input);
  if(request.operation==='candidate'){
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
      process.stdout.write(JSON.stringify({html:buildPreviewHtml({title:d.title,scenes}).replace('</main>',notes+'</main>')}));
    }else process.stdout.write(JSON.stringify({valid:true}));
  }
}catch(error){process.stderr.write(error.message);process.exitCode=1;}
