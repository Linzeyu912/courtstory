"""Authored game-style tactical illustration, independent of observed tracker segments."""
import argparse, hashlib, json, subprocess, time
from pathlib import Path
import av
import cv2
import numpy as np

OUT=Path(__file__).resolve().parent
CONFIG=json.loads((OUT/'authored_routes.json').read_text(encoding='utf-8'))
WIDTH,HEIGHT,FPS=1920,1080,30
STYLE=CONFIG['style']
SCALE=STYLE['antialiasScale']
FFMPEG='D:/ffmbeg/ffmpeg-n8.1-latest-win64-gpl-shared-8.1/bin/ffmpeg.exe'
FFPROBE='D:/ffmbeg/ffmpeg-n8.1-latest-win64-gpl-shared-8.1/bin/ffprobe.exe'
DEST=OUT/'005_future_routes_authored_v2.mp4'

def camera(frame):
    keys=CONFIG['camera']['keyframes']
    coords=np.array([k['quad'] for k in keys],dtype=np.float32)
    xs=np.array([k['frame'] for k in keys])
    quad=np.array([np.interp(frame,xs,coords[:,i,j]) for i in range(4) for j in range(2)],dtype=np.float32).reshape(4,2)
    return cv2.getPerspectiveTransform(np.float32(CONFIG['camera']['groundQuad']),quad)

def project(points,matrix):
    return cv2.perspectiveTransform(np.float32(points).reshape(-1,1,2),matrix).reshape(-1,2)

def bezier(points,ts):
    t=np.asarray(ts)[:,None]
    p=np.asarray(points)
    return (1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3]

def ground_curve(route,frame,reveal=1):
    progress=float(np.interp(frame,[x[0] for x in route['progressFrames']],[x[1] for x in route['progressFrames']]))
    if frame<route['visibleFromFrame'] or progress>=1 or reveal<=0:
        return None
    controls=project(route['controlPoints'],np.linalg.inv(camera(route['refFrame'])))
    ts=np.linspace(0,reveal,601)
    return {'full':bezier(controls,ts),'ts':ts,'progress':progress}

def ribbon_polygon(geometry):
    curve,ts,progress=geometry['full'],geometry['ts'],geometry['progress']
    lengths=np.linalg.norm(np.diff(curve,axis=0),axis=1)
    total=float(lengths.sum())
    head_length=STYLE['arrowLengthMetres']
    if total<=head_length:
        return None,0
    cum=np.concatenate([[0],np.cumsum(lengths)])
    base_distance=total-head_length
    walked=float(np.interp(progress,ts,cum))
    if walked>=base_distance:
        return None,0
    base=np.array([np.interp(base_distance,cum,curve[:,i]) for i in range(2)])
    start=np.array([np.interp(progress,ts,curve[:,i]) for i in range(2)])
    middle=curve[(ts>progress)&(cum<base_distance)]
    body=np.vstack([start,middle,base])
    tangent=np.gradient(body,axis=0)
    tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-8)
    normal=np.column_stack([-tangent[:,1],tangent[:,0]])
    half=STYLE['bodyWidthMetres']/2
    left,right=body+normal*half,body-normal*half
    tip=curve[-1]
    forward=tip-body[-1]
    forward/=max(np.linalg.norm(forward),1e-8)
    head_normal=np.array([-forward[1],forward[0]])
    half_head=STYLE['arrowWidthMetres']/2
    polygon=np.vstack([left,body[-1]+head_normal*half_head,tip,body[-1]-head_normal*half_head,right[::-1]])
    # Keep the destination and head fixed. Fade the whole remaining arrow before
    # the tail can collapse into the head; never create tiny residual arrows.
    fade=min(1,(base_distance-walked)/STYLE['fadeRemainingMetres'])
    return polygon,fade

def composite(rgb,frame,reveal=1):
    visible=[]
    for route in CONFIG['routes']:
        curve=ground_curve(route,frame,reveal)
        if curve is None:
            continue
        poly,fade=ribbon_polygon(curve)
        if poly is not None:
            visible.append((route,project(poly,camera(frame)),fade))
    if not visible:
        return rgb,[]
    result=rgb.astype(np.float32)
    for route,poly,fade in visible:
        pts=np.rint(poly*SCALE).astype(np.int32)
        fill=np.zeros((HEIGHT*SCALE,WIDTH*SCALE),np.uint8)
        edge=np.zeros_like(fill)
        cv2.fillPoly(fill,[pts],255,lineType=cv2.LINE_AA)
        cv2.fillPoly(edge,[pts],255,lineType=cv2.LINE_AA)
        cv2.polylines(edge,[pts],True,255,max(1,round(STYLE['edgePixels']*2*SCALE)),cv2.LINE_AA)
        edge=cv2.resize(edge,(WIDTH,HEIGHT),interpolation=cv2.INTER_AREA).astype(np.float32)[...,None]/255
        fill=cv2.resize(fill,(WIDTH,HEIGHT),interpolation=cv2.INTER_AREA).astype(np.float32)[...,None]/255
        opacity=STYLE['opacity']*fade
        alpha=edge*opacity
        result=result*(1-alpha)+np.float32(STYLE['edgeRgb'])*alpha
        alpha=fill*opacity
        result=result*(1-alpha)+np.float32(STYLE['fillRgb'])*alpha
    return np.clip(np.rint(result),0,255).astype(np.uint8),[r['id'] for r,_,_ in visible]

def save_png(rgb,path):
    assert cv2.imwrite(str(path),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR))

def encode_command(encoder):
    cmd=[FFMPEG,'-hide_banner','-y','-f','rawvideo','-pixel_format','rgb24','-video_size','1920x1080','-framerate','30','-i','pipe:0','-an','-c:v',encoder]
    cmd+=['-preset','p7','-tune','hq','-rc','vbr','-cq','17','-b:v','0','-multipass','fullres'] if encoder=='h264_nvenc' else ['-preset','slow','-crf','17']
    return cmd+['-pix_fmt','yuv420p','-profile:v','high','-g','60','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',DEST.as_posix()]

def execute(preview,encoder='h264_nvenc'):
    begin=time.time()
    source=Path(CONFIG['sourceVideo'])
    assert hashlib.sha256(source.read_bytes()).hexdigest()==CONFIG['sourceSha256']
    command=encode_command(encoder)
    process=None
    log=None
    if not preview:
        log=(OUT/f'encode_{encoder}.log').open('w',encoding='utf-8')
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log)
    count=0
    timeline=[]
    qa={15,25,39,40,50,60,77,89,90,100,110,120,130,142}
    try:
        container=av.open(source.as_posix())
        for f,frame in enumerate(container.decode(video=0)):
            if preview and f not in qa:
                continue
            original=frame.to_ndarray(format='rgb24')
            rgb,visible=composite(original,f)
            if f in qa:
                save_png(rgb,OUT/f'preview_{f:03d}.png')
                if f in [15,40,90]:
                    print(f'Preview ready: {(OUT/f"preview_{f:03d}.png").as_posix()}',flush=True)
            if not preview:
                repeats=1+(75 if f in [15,40,90] else 0)+(18 if f==142 else 0)
                buffer=rgb.tobytes()
                for hold_index in range(repeats):
                    if f in [15,40,90] and hold_index<26:
                        u=max(0,min(1,(hold_index-5)/21))
                        reveal=u*u*(3-2*u)
                        frozen,_=composite(original,f,reveal=reveal)
                        process.stdin.write(frozen.tobytes())
                        if hold_index in [0,12,20]:
                            save_png(frozen,OUT/f'freeze_{f:03d}_step_{hold_index:02d}.png')
                    else:
                        process.stdin.write(buffer)
                timeline.append({'sourceFrame':f,'outputStartFrame':count,'outputEndFrameExclusive':count+repeats,'visibleRoutes':visible})
                count+=repeats
        container.close()
        if process:
            process.stdin.close()
            assert process.wait()==0,'Encoder failed'
    finally:
        if process and process.poll() is None:
            process.kill();process.wait()
        if log:
            log.close()
    if preview:
        return
    assert count==386
    probe_cmd=[FFPROBE,'-v','error','-count_frames','-show_streams','-show_format','-of','json',DEST.as_posix()]
    probe=json.loads(subprocess.check_output(probe_cmd))
    (OUT/'ffprobe.json').write_text(json.dumps(probe,indent=2),encoding='utf-8')
    v=probe['streams'][0]
    assert len(probe['streams'])==1 and v['codec_name']=='h264' and v['nb_read_frames']=='386'
    assert v['width']==1920 and v['height']==1080 and v['pix_fmt']=='yuv420p' and v['avg_frame_rate']=='30/1'
    assert abs(float(v['duration'])-386/30)<.001
    decode_cmd=[FFMPEG,'-hide_banner','-v','error','-xerror','-i',DEST.as_posix(),'-f','null','-']
    with (OUT/'full_decode.log').open('w',encoding='utf-8') as fh:
        decode=subprocess.run(decode_cmd,stdout=subprocess.DEVNULL,stderr=fh)
    assert decode.returncode==0
    manifest={'output':DEST.as_posix(),'kind':'authored illustration, not tracker evidence','sourceSha256':CONFIG['sourceSha256'],'authoredRoutesSha256':hashlib.sha256((OUT/'authored_routes.json').read_bytes()).hexdigest(),'routes':CONFIG['routes'],'style':STYLE,'timeline':timeline,'fps':FPS,'width':WIDTH,'height':HEIGHT,'frameCount':count,'durationSeconds':count/FPS,'outputBytes':DEST.stat().st_size,'outputSha256':hashlib.sha256(DEST.read_bytes()).hexdigest(),'encoder':encoder,'fullDecodeExitCode':decode.returncode,'elapsedSeconds':time.time()-begin,'commands':{'encode':command,'probe':probe_cmd,'decode':decode_cmd},'limitations':['Approximate visually authored paths and camera registration, intended for tactical explanation, not measured player ground truth.']}
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    def ps(args):return '& '+' '.join("'"+str(a).replace("'","''")+"'" for a in args)
    (OUT/'exact_commands.ps1.txt').write_text('\n\n'.join([ps(['C:/python313/python.exe',Path(__file__).as_posix(),'--encode']),'# Rawvideo stdin is provided by the Python renderer:',ps(command),ps(probe_cmd),ps(decode_cmd)])+'\n',encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ['output','frameCount','durationSeconds','outputBytes','encoder','fullDecodeExitCode','elapsedSeconds']},indent=2),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--encode',action='store_true')
    args=parser.parse_args()
    try:
        execute(preview=not args.encode)
    except (BrokenPipeError,AssertionError) as error:
        if not args.encode:
            raise
        print(f'NVENC attempt failed: {error}; retrying CPU.',flush=True)
        execute(preview=False,encoder='libx264')
