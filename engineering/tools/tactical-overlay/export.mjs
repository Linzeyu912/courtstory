import {readFile,writeFile,mkdir,readdir,realpath,lstat,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildTacticalOverlay} from './overlay.mjs';
import {renderOverlaySvg} from './render-svg.mjs';
import {buildPreviewHtml} from './preview.mjs';

const PRODUCER='tactical-overlay-static-v1';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const contained=(directory,file)=>{const r=relative(directory,file);return r===''||(!r.startsWith('..\\')&&!r.startsWith('../')&&r!=='..'&&!isAbsolute(r));};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unavailablePage=message=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>拒绝叠加</title><body style="background:#10202a;color:#ffe4ab;font-family:system-ui;padding:40px"><h1>拒绝叠加：本次产物未通过验证</h1><p>${escape(message)}</p><p>先前场景已停止展示，请修正输入后重新导出。</p></body></html>`;

async function inspectOutput(outDirectory){
  let entries;try{entries=await readdir(outDirectory);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!entries.length)return null;
  let old;try{old=JSON.parse(await readFile(join(outDirectory,'source-index.json'),'utf8'));}catch{throw new Error('output directory must be empty or an existing tactical overlay export');}
  if(old.producer!==PRODUCER)throw new Error('output directory belongs to another producer');
  return old;
}

async function refuseOutput(output,message){
  // Only replace the owned entry/index; aliased originals retain their bytes/inode.
  await publishFile(join(output,'index.html'),unavailablePage(message),{replaceAlias:true});
  await publishFile(join(output,'source-index.json'),json({schemaVersion:1,producer:PRODUCER,status:'refused',error:message,scenes:[]}),{replaceAlias:true});
}

async function checkDestination(file,{replaceAlias=false}={}){
  let entry;try{entry=await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!replaceAlias&&(entry.isSymbolicLink()||entry.nlink>1))throw new Error(`output destination alias/link refused: ${file}`);
  if(!entry.isFile()&&!entry.isSymbolicLink())throw new Error(`output destination must be a file: ${file}`);
}

async function publishFile(file,bytes,options){
  await checkDestination(file,options);
  const temporary=join(dirname(file),`.tactical-overlay-${randomUUID()}.tmp`);
  try{
    await writeFile(temporary,bytes,{flag:'wx'});
    // Replace a directory entry instead of truncating/following an existing inode.
    await rename(temporary,file);
  }finally{
    try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

async function protectOutput(output,protectedPaths){
  // Canonicalise existing directories/files before containment checks (including symlinks).
  let canonicalOutput;try{canonicalOutput=await realpath(output);}catch(e){if(e.code!=='ENOENT')throw e;
    let ancestor=dirname(output),suffix=relative(ancestor,output);
    while(true){try{canonicalOutput=resolve(await realpath(ancestor),suffix);break;}catch(error){if(error.code!=='ENOENT')throw error;const parent=dirname(ancestor);if(parent===ancestor)throw error;suffix=join(relative(parent,ancestor),suffix);ancestor=parent;}}
  }
  for(const path of protectedPaths){let actual;try{actual=await realpath(path);}catch(e){if(e.code!=='ENOENT')throw e;actual=resolve(path);}
    if(contained(canonicalOutput,actual))throw new Error('output directory cannot contain input assets/files');
  }
}

async function verifyBackground({frames,entry,review,manifest,framesDirectory}){
  const mapping=review.sourceFrameMapping[manifest.freezeFrame];
  if(!entry)throw new Error(`missing exact frame asset for ${manifest.phaseId} / frame ${manifest.freezeFrame}`);
  if(entry.frame!==manifest.freezeFrame||entry.time!==mapping.time||entry.time!==manifest.time)throw new Error('frame asset frame/time mismatch');
  if(entry.sourceFrame!==undefined&&entry.sourceFrame!==mapping.sourceFrame)throw new Error('frame asset source frame mismatch');
  if(entry.sourceTime!==undefined&&entry.sourceTime!==mapping.sourceTime)throw new Error('frame asset source time mismatch');
  const path=resolve(framesDirectory,entry.file),bytes=await readFile(path),digest=sha256(bytes);
  if(digest!==entry.sha256.toLowerCase())throw new Error(`JPEG sha256 mismatch: frame ${entry.frame}`);
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error(`JPEG byte signature unavailable: frame ${entry.frame}`);
  return {bytes,background:{frame:entry.frame,time:entry.time,sourceFrame:mapping.sourceFrame,sourceTime:mapping.sourceTime,
    videoSha256:frames.videoSha256,sha256:digest,sourceBinding:structuredClone(manifest.sourceBinding),
    file:entry.file,dataUrl:`data:image/jpeg;base64,${bytes.toString('base64')}`}};
}

/** Validate all scenes before publishing; source objects and frame files are never written. */
export async function exportPreview({review,playDefinition,frames=null,framesDirectory=process.cwd(),outDirectory,title='战术轨迹 · 静态核对',options={},inputFiles=[]}={}) {
  if(typeof outDirectory!=='string'||!outDirectory)throw new TypeError('outDirectory required');
  const output=resolve(outDirectory),assetRoot=resolve(framesDirectory);
  const protectedPaths=[...inputFiles,...(Array.isArray(frames?.frames)?frames.frames.filter(f=>typeof f?.file==='string').map(f=>resolve(assetRoot,f.file)):[])];
  await protectOutput(output,protectedPaths);
  const previous=await inspectOutput(output);
  try {
    if(!Array.isArray(playDefinition?.phases)||!playDefinition.phases.length)throw new Error('play has no phases');
    const phaseDefinitions=[...playDefinition.phases].sort((a,b)=>a.order-b.order);
    const manifests=[];
    for(const phase of phaseDefinitions){
      const m=await buildTacticalOverlay({review,playDefinition,phaseId:phase.phaseId,freezeFrame:phase.freezeFrame,options});
      if(m.status==='refused')throw new Error(`engine refused ${phase.phaseId}: ${m.issues.map(i=>i.code).join(', ')}`);
      manifests.push(m);
    }
    const frameEntries=new Map();
    if(frames!==null){
      if(typeof frames!=='object'||!Array.isArray(frames.frames))throw new Error('frame index must contain frames array');
      const binding=manifests[0].sourceBinding;
      if(frames.videoSha256!==binding.videoSha256)throw new Error('frame index video binding mismatch');
      if(frames.sourceBinding!==undefined&&(!frames.sourceBinding||Object.keys(binding).some(key=>frames.sourceBinding[key]!==binding[key])))throw new Error('frame index source binding mismatch');
      for(const entry of frames.frames){
        if(!entry||!Number.isSafeInteger(entry.frame)||entry.frame<0||frameEntries.has(entry.frame))throw new Error('invalid or duplicate frame index entry');
        const map=review.sourceFrameMapping[entry.frame];
        if(!map||map.frame!==entry.frame||entry.time!==map.time)throw new Error('frame index frame/time mapping mismatch');
        if(typeof entry.file!=='string'||!entry.file||!/^[a-f0-9]{64}$/i.test(entry.sha256??''))throw new Error('frame entry file/sha256 required');
        if(entry.sourceFrame!==undefined&&entry.sourceFrame!==map.sourceFrame)throw new Error('frame index source frame mismatch');
        if(entry.sourceTime!==undefined&&entry.sourceTime!==map.sourceTime)throw new Error('frame index source time mismatch');
        frameEntries.set(entry.frame,entry);
      }
    }
    const scenes=[],assets=[];
    for(const [i,m] of manifests.entries()){
      let background=null,bytes=null;
      // A supplied index is strict, including stages whose projection only permits court 2D.
      if(frames!==null){const verified=await verifyBackground({frames,entry:frameEntries.get(m.freezeFrame),review,manifest:m,framesDirectory:assetRoot});background=verified.background;bytes=verified.bytes;}
      const mode=background&&m.videoOverlay.available?'video':'court';
      const stem=`stage-${String(i+1).padStart(3,'0')}`;
      const scene={title:phaseDefinitions[i].title??m.phaseId,manifest:m,mode,background:mode==='video'?background:null,
        manifestFile:`${stem}.manifest.json`,svgFile:`${stem}.${mode}.svg`,frameFile:bytes?`${stem}.freeze.jpg`:null};
      scene.svg=renderOverlaySvg(m,{mode,viewport:{width:1280,height:720}});
      scenes.push(scene);assets.push({bytes,verifiedBackground:background});
    }
    const html=buildPreviewHtml({title,scenes});
    const index={schemaVersion:1,producer:PRODUCER,status:'ready',synthetic:manifests[0].synthetic,sourceBinding:manifests[0].sourceBinding,
      playId:manifests[0].playId,playRevision:manifests[0].playRevision,frameIndexVerification:'caller provenance and actual JPEG byte consistency; not independent decode proof',
      scenes:scenes.map((s,i)=>({phaseId:s.manifest.phaseId,title:s.title,freezeFrame:s.manifest.freezeFrame,time:s.manifest.time,sourceFrame:s.manifest.sourceFrame,sourceTime:s.manifest.sourceTime,
        mode:s.mode,status:s.manifest.status,manifestFile:s.manifestFile,manifestSha256:sha256(Buffer.from(json(s.manifest))),svgFile:s.svgFile,svgSha256:sha256(Buffer.from(s.svg)),frameFile:s.frameFile,
        background:assets[i].verifiedBackground?Object.fromEntries(Object.entries(assets[i].verifiedBackground).filter(([key])=>key!=='dataUrl')):null}))};
    const destinations=['index.html','source-index.json',...scenes.flatMap(s=>[s.manifestFile,s.svgFile,...(s.frameFile?[s.frameFile]:[])])];
    for(const file of destinations)await checkDestination(join(output,file));
    await mkdir(output,{recursive:true});
    // Publishing starts with a refusal page; interruptions cannot show a mixed old/new scene.
    await publishFile(join(output,'index.html'),unavailablePage('正在生成并验证完整场景，请在命令成功后刷新。'));
    for(const [i,s] of scenes.entries()){
      await publishFile(join(output,s.manifestFile),json(s.manifest));await publishFile(join(output,s.svgFile),s.svg);
      if(assets[i].bytes)await publishFile(join(output,s.frameFile),assets[i].bytes);
    }
    await publishFile(join(output,'source-index.json'),json(index));
    await publishFile(join(output,'index.html'),html);
    return {scenes,index,outDirectory:output};
  } catch(error){
    if(previous)await refuseOutput(output,error.message);
    throw error;
  }
}

async function cli(args){
  const usage='node engineering/tools/tactical-overlay/export.mjs --review <review.json> --play <play.json> [--frames <frames.json>] --out <directory>';
  const values={};
  for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--review','--play','--frames','--out','--title'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||values[key])throw new Error(usage);values[key]=args[i+1];}
  if(!values['--review']||!values['--play']||!values['--out'])throw new Error(usage);
  const inputFiles=[values['--review'],values['--play'],values['--frames']].filter(Boolean).map(p=>resolve(p));
  let review,playDefinition,frames;
  try{
    review=JSON.parse(await readFile(inputFiles[0],'utf8'));playDefinition=JSON.parse(await readFile(inputFiles[1],'utf8'));
    frames=values['--frames']?JSON.parse(await readFile(resolve(values['--frames']),'utf8')):null;
  }catch(error){
    const output=resolve(values['--out']);await protectOutput(output,inputFiles);
    if(await inspectOutput(output))await refuseOutput(output,`输入快照无法读取：${error.message}`);
    throw error;
  }
  const result=await exportPreview({review,playDefinition,frames,framesDirectory:values['--frames']?dirname(resolve(values['--frames'])):process.cwd(),outDirectory:values['--out'],title:values['--title'],inputFiles});
  process.stdout.write(`Exported ${result.scenes.length} bound stages: ${join(result.outDirectory,'index.html')}\n`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).catch(error=>{process.stderr.write(`Tactical overlay export refused: ${error.message}\n`);process.exitCode=1;});
}
