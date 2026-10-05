"""Finalize artifact descriptions and save QA stills decoded from the delivered MP4."""
from pathlib import Path
import hashlib,json
import av,cv2

out=Path(__file__).resolve().parent
config_path=out/'authored_routes.json'
config=json.loads(config_path.read_text(encoding='utf-8'))
old='phase1-shallow-handoff-arc'
new='phase1-approach-screen'
for route in config['routes']:
    if route['id']==old:
        route['id']=new
        route['description']='Shallow dribble arc towards the screen.'
config_path.write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
manifest_path=out/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['routes']=config['routes']
manifest['camera']=config['camera']
manifest['freezeReveal']=config['timeline']['freezeReveal']
manifest['authoredRoutesSha256']=hashlib.sha256(config_path.read_bytes()).hexdigest()
for row in manifest['timeline']:
    row['visibleRoutes']=[new if x==old else x for x in row['visibleRoutes']]
targets={15:'freeze1_settle',27:'freeze1_drawing',50:'freeze1_full',100:'source_025',115:'freeze2_settle',127:'freeze2_drawing',150:'freeze2_full',200:'source_050',227:'source_077',240:'freeze3_settle',252:'freeze3_drawing',275:'freeze3_full',325:'source_100',335:'source_110',345:'source_120',355:'source_130',385:'final'}
container=av.open(manifest['output'])
stills=[]
for number,frame in enumerate(container.decode(video=0)):
    if number in targets:
        name=f'encoded_{number:03d}_{targets[number]}.png'
        assert cv2.imwrite(str(out/name),frame.to_ndarray(format='bgr24'))
        stills.append({'outputFrame':number,'path':(out/name).as_posix()})
container.close()
assert number+1==386
manifest['encodedQAStills']=stills
source=Path(config['sourceVideo'])
manifest['sourceUnchangedAfterRender']=hashlib.sha256(source.read_bytes()).hexdigest()==config['sourceSha256']
assert manifest['sourceUnchangedAfterRender']
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'encodedQAStills':len(stills),'sourceUnchanged':True,'output':manifest['output'],'manifest':manifest_path.as_posix()},indent=2))
