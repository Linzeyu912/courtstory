"""Full-source ten-player visual replay, reusing saved tracks and name candidates."""
from collections import deque
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from basketball_render import media_signature,validate_media_signatures,resolve_ffmpeg
from tactics_render import discover_ffmpeg,draw_name_overlay,name_overlay_index
from local_video_library import file_hash,atomic_json


def main():
    import av
    import cv2
    import numpy as np
    parser=argparse.ArgumentParser()
    parser.add_argument('--folder',default='artifacts/player-name-optimization-20261007/full-tracking')
    parser.add_argument('--drawing-iteration',type=int,default=1)
    args=parser.parse_args()
    folder=(ROOT/args.folder).resolve()
    if not folder.is_relative_to((ROOT/'artifacts').resolve()):
        raise ValueError('Replay output must stay in local artifacts')
    snapshot=json.loads((folder/'snapshot.json').read_text(encoding='utf-8'))
    overlay=snapshot['nameOverlay'];source_info=overlay['nameIdentitySource']
    library=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
    video=ROOT/next(item['video'] for item in library['samples'] if item['id']=='official-training-001')
    if file_hash(video)!=source_info['videoSha256']:
        raise ValueError('Replay snapshot does not match source video')
    index=name_overlay_index(overlay);cuts=set(snapshot['cuts'])
    histories={f'P{i}':deque(maxlen=14) for i in range(1,11)}
    previous={};frames_seen=0;all_seen=set();counts=[]
    intermediate=folder/'tracking-video-only.mp4';finished=folder/'official001-all-players-full.mp4'
    with av.open(str(video)) as source,av.open(str(intermediate),'w') as output:
        native=source.streams.video[0]
        encoder=output.add_stream('libx264',rate=native.average_rate)
        encoder.width,encoder.height=source_info['width'],source_info['height']
        encoder.pix_fmt='yuv420p';encoder.time_base=encoder.codec_context.time_base=native.time_base
        encoder.options={'preset':'veryfast','crf':'20'}
        for f,decoded in enumerate(source.decode(video=0)):
            if f>=len(snapshot['frames']) or abs(float(decoded.time)-snapshot['frames'][f]['time'])>1e-6:
                raise ValueError('Replay frame and source PTS are not aligned')
            image=decoded.to_ndarray(format='rgb24');scale=image.shape[0]/720;located=0;named=0
            for number in range(1,11):
                ident=f'P{number}';record=index.get((ident,f));observation=record[1] if record else None
                if not observation or observation.get('x') is None or observation.get('y') is None:
                    histories[ident].clear();previous.pop(ident,None);continue
                located+=1;all_seen.add(ident);named+=bool(observation.get('nameIdentity'))
                track=observation.get('trackId')
                if f in cuts or previous.get(ident)!=track:histories[ident].clear()
                previous[ident]=track
                foot=(round(observation['x']),round(observation['y']))
                histories[ident].append(foot)
                color=(238,85,104) if number<=5 else (66,149,237)
                if len(histories[ident])>1:
                    cv2.polylines(image,[np.array(histories[ident],dtype=np.int32)],False,color,2,cv2.LINE_AA)
                box=observation.get('box')
                if box:
                    a,b,c,d=map(round,box)
                    cv2.rectangle(image,(a,b),(c,d),color,2,cv2.LINE_AA)
            image=draw_name_overlay(image,f,overlay,index)
            cv2.rectangle(image,(0,0),(image.shape[1],round(32*scale)),(16,25,34),-1)
            cv2.putText(image,f'ALL 10 PLAYERS | {snapshot["frames"][f]["time"]:.2f}s | located {located}/10 | names {named}/10 (candidates)',
                (14,round(23*scale)),cv2.FONT_HERSHEY_SIMPLEX,.5*scale,(230,236,242),1,cv2.LINE_AA)
            if f in (60,147,270,300,502,600,650,900,1048,1209,1290):
                cv2.imwrite(str(folder/f'frame-{f}.png'),cv2.cvtColor(image,cv2.COLOR_RGB2BGR))
            rendered=av.VideoFrame.from_ndarray(image,format='rgb24');rendered.pts=decoded.pts;rendered.time_base=decoded.time_base
            for packet in encoder.encode(rendered):output.mux(packet)
            frames_seen+=1;counts.append(located)
            if f%300==0:print(json.dumps({'frame':f,'total':len(snapshot['frames']),'located':located}),flush=True)
        for packet in encoder.encode():output.mux(packet)
    if frames_seen!=len(snapshot['frames']) or len(all_seen)!=10:
        raise ValueError('Replay did not cover the full source or all ten saved players')
    try:ffmpeg=discover_ffmpeg()
    except ValueError:ffmpeg=str(resolve_ffmpeg(None))
    command=[ffmpeg,'-hide_banner','-y','-copyts','-i',str(intermediate),'-i',str(video),
        '-map','0:v:0','-map','1:a?','-c:v','copy','-c:a','copy','-avoid_negative_ts','disabled','-movflags','+faststart',str(finished)]
    run=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',errors='replace')
    (folder/'mux.log').write_text(run.stderr,encoding='utf-8')
    if run.returncode:raise RuntimeError('Audio remux failed; see mux.log')
    original=media_signature(video);result=media_signature(finished)
    problems=validate_media_signatures(original,result)
    if problems:raise ValueError(str(problems))
    with av.open(str(finished)) as container:
        stream=container.streams.video[0];duration=float(stream.duration*stream.time_base);fps=float(stream.average_rate)
    report={'video':finished.name,'source':'official-training-001','frames':frames_seen,'players':sorted(all_seen),
        'dimensions':[source_info['width'],source_info['height']],'fps':fps,'durationSeconds':duration,
        'maximumSimultaneousPlayers':max(counts),'framesWithAllTenPositions':counts.count(10),
        'sourcePtsPreserved':True,'sourceAudioPreserved':True,'accuracyVerified':False,'drawingIteration':args.drawing_iteration,
        'coverage':json.loads((folder/'coverage.json').read_text(encoding='utf-8'))['players']}
    atomic_json(folder/'result.json',report)
    print(json.dumps({**report,'coverage':[{k:v for k,v in player.items() if k!='profile'} for player in report['coverage']]}),flush=True)


if __name__=='__main__':main()
