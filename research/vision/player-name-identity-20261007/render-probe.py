"""Render one short MP4 from the saved all-players-v2 Qwen candidate, without editing drafts."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys
import time

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from local_video_library import file_hash
from tactical_workbench import TacticalWorkbench
from tactics_render import TacticsRenderer, draw_name_overlay, name_overlay_index
from basketball_presentation import name_overlay_text

OUT=ROOT/'artifacts/player-name-identity-20261007/render'
INPUT=OUT/'render-input.json'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_png(cv2, path, rgb):
    if not cv2.imwrite(str(path),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR)):
        raise RuntimeError(f'Could not write {path.name}')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout',type=int,default=420)
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    payload=read(INPUT);manifest=payload['manifest'];clip=read(ROOT/'artifacts/player-name-identity-20261007/all-players-v2/input-clip.json')
    if clip['video_sha256']!=manifest['videoSha256']:
        raise ValueError('QA snapshot and clip hash differ.')
    library=read(ROOT/'data/videos/tactics/acceptance/review-library.json')
    sample=next(item for item in library['samples'] if item['id']=='official-training-001')
    video=ROOT/sample['video']
    if file_hash(video)!=clip['video_sha256']:
        raise ValueError('Official source video hash differs from the saved recognition job.')

    workbench=TacticalWorkbench(OUT/'workbench')
    renderer=TacticsRenderer(OUT/'job-store',workbench)
    try:
        document=payload['document'];variant='team-stable';qa=True;kind='workspace'
        digest=workbench.run('agent-digest',document=document)['digest']
        version=workbench.load(clip,variant,qa,kind)['version']
        request={'sample':'official-training-001','document':document,'documentDigest':digest,
            'expectedVersion':version,'options':{'fps':30,'nameOverlay':payload['nameOverlay']}}
        plan=workbench.run('production-compile',document=document,options=request['options'])
        job=renderer.create(request,clip,video,variant,qa,kind)
        deadline=time.monotonic()+args.timeout
        while job['status'] in ('queued','running') and time.monotonic()<deadline:
            time.sleep(.5);job=renderer.get(job['id'],clip,variant,qa,kind)
        if job['status']!='succeeded':
            if job['status'] in ('queued','running'):
                renderer.cancel(job['id'],clip,variant,qa,kind)
                raise TimeoutError(f'Production render exceeded {args.timeout}s.')
            raise RuntimeError(job.get('message','Production render failed.'))
        source_mp4=OUT/'job-store'/job['id']/'finished.mp4'
        output_mp4=OUT/'production-cooper-flagg-3s.mp4'
        shutil.copy2(source_mp4,output_mp4)

        import av
        import cv2
        import numpy as np
        with av.open(str(output_mp4)) as container:
            stream=container.streams.video[0];fps=float(stream.average_rate)
            output_frames=list(container.decode(video=0))
        if not output_frames:raise RuntimeError('Production MP4 contains no frames.')
        mid_output=output_frames[len(output_frames)//2]
        output_rgb=mid_output.to_ndarray(format='rgb24')
        source_frame=plan['frames'][len(output_frames)//2]['sourceFrame']
        with av.open(str(video)) as container:
            source_iter=enumerate(container.decode(video=0));source_image=None
            for frame_index,frame in source_iter:
                if frame_index==source_frame:
                    source_image=frame.to_ndarray(format='rgb24');break
        if source_image is None:raise RuntimeError('Could not decode the matching source frame.')
        overlay=payload['nameOverlay'];index=name_overlay_index(overlay)
        p9=next(entity for entity in overlay['playerNameIdentities'] if entity['id']=='P9')
        observation=next(row for row in p9['observations'] if row['frame']==source_frame)
        identity=observation.get('nameIdentity')
        if not identity or identity.get('name')!='Cooper Flagg' or identity.get('identityVerified') is not False:
            raise AssertionError('Selected source frame does not carry the expected unverified Qwen candidate.')
        label=name_overlay_text({**identity,'showName':True,'showJersey':True},'P9')
        if label!='Cooper Flagg? / #32':raise AssertionError(f'Unexpected production label: {label}')
        enabled=draw_name_overlay(source_image.copy(),source_frame,overlay,index)
        if np.array_equal(enabled,source_image):raise AssertionError('Enabled overlay did not alter the matching source frame.')

        off=deepcopy(overlay);off['nameDisplay']['enabled']=False
        globally_disabled=draw_name_overlay(source_image.copy(),source_frame,off,index)
        if not np.array_equal(globally_disabled,source_image):raise AssertionError('Global off still drew text or a ring.')
        name_off=deepcopy(overlay);name_off['nameDisplay']['showName']=False
        jersey_only=draw_name_overlay(source_image.copy(),source_frame,name_off,index)
        jersey_label=name_overlay_text({**identity,'showName':False,'showJersey':True},'P9')
        if jersey_label!='#32' or np.array_equal(jersey_only,source_image):raise AssertionError('Name-off did not preserve the independent jersey label.')
        jersey_off=deepcopy(overlay);jersey_off['nameDisplay']['showJersey']=False
        name_only=draw_name_overlay(source_image.copy(),source_frame,jersey_off,index)
        name_label=name_overlay_text({**identity,'showName':True,'showJersey':False},'P9')
        if name_label!='Cooper Flagg?' or np.array_equal(name_only,source_image):raise AssertionError('Jersey-off did not preserve the independent candidate name.')
        if np.array_equal(jersey_only,name_only):raise AssertionError('Independent name and jersey switches produced identical overlays.')

        save_png(cv2,OUT/'source-frame.png',source_image)
        save_png(cv2,OUT/'production-frame.png',output_rgb)
        save_png(cv2,OUT/'global-off-frame.png',globally_disabled)
        save_png(cv2,OUT/'name-off-frame.png',jersey_only)
        save_png(cv2,OUT/'jersey-off-frame.png',name_only)
        result={'status':'passed','renderer':'TacticsRenderer.create/_render','sourceVideo':'official-training-001',
            'sourceSha256':clip['video_sha256'],'trackingRevision':clip['tracking_revision'],
            'sourceFrameStart':manifest['frameStart'],'sourceFrameEndExclusive':manifest['frameEndExclusive'],
            'verifiedOverlayFrame':source_frame,'label':label,'identityVerified':False,
            'fps':fps,'frames':len(output_frames),'durationSeconds':len(output_frames)/fps,
            'dimensions':[stream.width,stream.height],'video':output_mp4.name,
            'controls':{'globalOffNoOverlay':True,'nameOffLabel':jersey_label,'jerseyOffLabel':name_label},
            'publicJobOptions':job.get('options')}
        (OUT/'render-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally:
        renderer.close()


if __name__=='__main__':main()
