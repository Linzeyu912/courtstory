import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const folders=[process.argv[2]||'artifacts/player-name-optimization-20261007/v3-consumer-baseline',
  process.argv[3]||'artifacts/player-name-optimization-20261007/full-tracking-v4-final'];
function summarize(relative){
  const folder=path.resolve(root,relative);
  const coverage=JSON.parse(fs.readFileSync(path.join(folder,'coverage.json'),'utf8'));
  const snapshot=JSON.parse(fs.readFileSync(path.join(folder,'snapshot.json'),'utf8'));
  const players=coverage.players.map(({profile,...record})=>record);
  const observed=snapshot.nameOverlay.playerNameIdentities;
  const namedFrames=players.reduce((sum,item)=>sum+item.namedPositionFrames,0);
  const locatedFrames=players.reduce((sum,item)=>sum+item.visiblePositionFrames,0);
  const frameCount=snapshot.frames.length;
  let framesWithTenNames=0;
  for(let frame=0;frame<frameCount;frame++){
    if(observed.length===10&&observed.every(entity=>{const point=entity.observations[frame];
      return point?.frame===frame&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.nameIdentity?.name;}))framesWithTenNames++;
  }
  return {folder:relative,source:snapshot.nameOverlay.nameIdentitySource,
    namedFrames,locatedFrames,weightedNamedCoverage:locatedFrames?namedFrames/locatedFrames:0,
    framesWithTenNames,frameCount,players,sourceFilesUnchanged:coverage.sourceFilesUnchanged??null,
    namedPlayers:players.filter(item=>item.names.length).length,
    allPlayersHaveSingletonNames:players.length===10&&players.every(item=>item.names.length===1),
    allNamedRecordsMatchProfile:players.every(item=>!item.profileName||item.names.every(name=>name===item.profileName))};
}
const [baseline,current]=folders.map(summarize);
if(JSON.stringify(baseline.source)!==JSON.stringify(current.source))throw new Error('Coverage sources differ.');
const result={accuracyVerified:false,metric:'Named located observations / all located observations; player-by-source-frame coverage, not accuracy.',
  baseline,current,weightedCoveragePercentagePointChange:(current.weightedNamedCoverage-baseline.weightedNamedCoverage)*100};
const output=path.join(root,folders[1],'comparison-summary.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({baseline:{namedFrames:baseline.namedFrames,locatedFrames:baseline.locatedFrames,
  weightedNamedCoverage:baseline.weightedNamedCoverage,framesWithTenNames:baseline.framesWithTenNames},
  current:{namedFrames:current.namedFrames,locatedFrames:current.locatedFrames,weightedNamedCoverage:current.weightedNamedCoverage,
    framesWithTenNames:current.framesWithTenNames,namedPlayers:current.namedPlayers,
    allPlayersHaveSingletonNames:current.allPlayersHaveSingletonNames,allNamedRecordsMatchProfile:current.allNamedRecordsMatchProfile,
    sourceFilesUnchanged:current.sourceFilesUnchanged},output}));
