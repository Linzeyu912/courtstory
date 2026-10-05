"""AI visual reference diagnostics; these points are not human ground truth."""
from pathlib import Path
import argparse, json, math, statistics, subprocess
import av
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/qwen-official-20261005'
refs={'001':{810:[542,702],870:[353,766],930:[430,808],960:[630,830],1065:[902,763]},
      '002':{930:[309,801],960:[511,796],990:[716,788],1125:[389,775],1155:[116,857]}}
def project(h,p):
 if p.get('x') is None:return None
 x,y=p['x'],p['y'];d=h[6]*x+h[7]*y+h[8]
 return [(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d]
reports=[]
p=argparse.ArgumentParser();p.add_argument('--labels',nargs='+',default=['optimized-v1','optimized-v2','optimized-v3','optimized-v4']);args=p.parse_args()
library=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
for case,points in refs.items():
 folder=OUT/f'official-training-{case}'
 session=json.loads((folder/'session.json').read_text(encoding='utf-8'));prep=session['courtPreparation']
 versions={v:json.loads((folder/f'result-{v}.json').read_text(encoding='utf-8')) for v in args.labels if (folder/f'result-{v}.json').is_file()}
 versions={v:r for v,r in versions.items() if r.get('candidate')}
 if not versions:continue
 missing={f for f in points if not (folder/f'heldout-{f}.jpg').is_file()}
 if missing:
  sample=next(s for s in library['samples'] if s['id']==f'official-training-{case}')
  with av.open(str(ROOT/sample['video'])) as container:
   for f,frame in enumerate(container.decode(video=0)):
    if f>max(missing):break
    if f in missing:frame.to_image().save(folder/f'heldout-{f}.jpg',quality=94)
 data={'raw':prep['preparedByPlayer']['P1'],**{v:r['candidate']['pointsByPlayer']['P1'] for v,r in versions.items()}}
 script="import fs from 'node:fs';import {previewCourtSmoothing} from './engineering/tools/player-review/court-smoothing.mjs';const s=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(previewCourtSmoothing(s.preparation,{entityIds:['P1'],range:s.range,preset:'light'}).candidate.pointsByPlayer.P1));"
 data['smooth']=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps({'preparation':prep,'range':next(iter(versions.values()))['candidate']['range']}).encode(),cwd=ROOT))
 visible=list(dict.fromkeys([next(iter(versions)),next(reversed(versions))]))
 colors={'raw':'#63b3ff','smooth':'#c29cff',**dict(zip(visible,['#ffab40','#2ee59d']))}
 rows=[];tiles=[]
 for frame,ref in points.items():
  matrix=prep['maps'][frame];row={'frame':frame,'reference':ref,'referenceType':'AI visual support-foot estimate, not human truth','errorsPx':{},'errorsM':{},'predicted':{}}
  target=project(matrix['toCourt'],dict(x=ref[0],y=ref[1]))
  image=Image.open(folder/f'heldout-{frame}.jpg').convert('RGB')
  rect=(max(0,ref[0]-150),max(0,ref[1]-180),min(image.width,ref[0]+220),min(image.height,ref[1]+95));crop=image.crop(rect)
  canvas=Image.new('RGB',(400,330),'#151b28');canvas.paste(crop,(0,35));d=ImageDraw.Draw(canvas);font=ImageFont.load_default(size=15)
  d.text((4,4),f'{case} frame {frame}',font=font,fill='white')
  def xy(pt):return (pt[0]-rect[0],pt[1]-rect[1]+35)
  x,y=xy(ref);d.line((x-10,y,x+10,y),fill='white',width=3);d.line((x,y-10,x,y+10),fill='white',width=3)
  for label in data:
   p=data[label][frame];q=project(matrix['toImage'],p);row['predicted'][label]=q
   row['errorsPx'][label]=math.dist(q,ref) if q else None
   row['errorsM'][label]=math.dist([p['x'],p['y']],target) if q else None
   if q and label in colors:
    x,y=xy(q);d.ellipse((x-6,y-6,x+6,y+6),outline=colors[label],width=3)
  text='  '.join(k.replace('optimized-','')+':'+(str(round(row['errorsPx'][k])) if row['errorsPx'][k] is not None else '?') for k in colors)
  d.rectangle((0,300,400,330),fill='#151b28');d.text((4,305),text,fill='white',font=ImageFont.load_default(size=12))
  tiles.append(canvas);rows.append(row)
 medians={k:round(statistics.median(r['errorsPx'][k] for r in rows if r['errorsPx'][k] is not None),1) for k in data if any(r['errorsPx'][k] is not None for r in rows)}
 paired={}
 for label in versions:
  available=[r for r in rows if r['errorsPx'][label] is not None]
  paired[label]={'count':len(available),'totalReferences':len(rows),**{k:round(statistics.median(r['errorsPx'][k] for r in available),1) for k in ['raw','smooth',label]}} if available else {'count':0,'totalReferences':len(rows)}
 report={'case':case,'metric':'pixel distance to AI visual ground reference; diagnostic only','rows':rows,'medianPx':medians,'pairedMedianPx':paired,
  'runs':{v:{'jobId':r['jobId'],'status':r['status'],'usage':r['usage'],'unknownRanges':r['candidate']['unknownRanges']} for v,r in versions.items()}}
 sheet=Image.new('RGB',(1200,690),'#151b28')
 for j,tile in enumerate(tiles):sheet.paste(tile,((j%3)*400,(j//3)*330))
 ImageDraw.Draw(sheet).text((10,665),f'White: AI reference | Blue: raw | Purple: light smoothing | Orange: {visible[0]} | Green: {visible[-1]}',fill='white',font=ImageFont.load_default(size=16))
 sheet.save(folder/'comparison.jpg',quality=96)
 (folder/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');reports.append(report)
 print(json.dumps({'case':case,'medianPx':medians}),flush=True)
(OUT/'evaluation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
