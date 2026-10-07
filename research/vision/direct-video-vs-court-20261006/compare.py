"""Research artifact only: synchronize retained A/B videos and label candidate mapping."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import av

def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-dir',type=Path,required=True)
    args=parser.parse_args();folder=args.run_dir.resolve()
    left=folder/'A/direct-video-fixed.mp4';right=folder/'B/court-projected.mp4';output=folder/'comparison.mp4'
    if output.exists():raise ValueError('Keep the existing comparison; use a fresh run for another encode.')
    a=read(folder/'A/plan.json');b=read(folder/'B/plan.json')
    clocks=lambda p:[(f['sourceFrame'],f['sourceTime'],f['state'],f['reveal']) for f in p['frames']]
    if clocks(a)!=clocks(b):raise ValueError('A/B clocks differ; refusing misleading comparison.')
    font=Path('C:/Windows/Fonts/arial.ttf')
    if not font.is_file():raise ValueError('The explicit research header font is unavailable.')
    font_value=font.as_posix().replace(':','\\:')
    def panel(index,label):
        return f"[{index}:v]scale=640:360:flags=lanczos,setsar=1,pad=640:396:0:36:color=0x10242b,drawtext=fontfile='{font_value}':text='{label}':fontcolor=white:fontsize=18:x=12:y=8[p{index}]"
    filters=panel(0,'A | video pixels - fixed')+';'+panel(1,'B | court mapping - CANDIDATE')+';[p0][p1]hstack=inputs=2:shortest=1[v]'
    base=[shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-y','-i',left.as_posix(),'-i',right.as_posix(),'-filter_complex',filters,'-map','[v]','-an','-r','30']
    attempts=[];begun=time.monotonic()
    for encoder,options in [('h264_nvenc',['-preset','p5','-cq','19','-b:v','0']),('libx264',['-preset','veryfast','-crf','18'])]:
        command=base+['-c:v',encoder]+options+['-pix_fmt','yuv420p','-movflags','+faststart',output.as_posix()]
        result=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        attempts.append({'encoder':encoder,'command':command,'commandLine':subprocess.list2cmdline(command),'exitCode':result.returncode,'stderr':result.stderr})
        if not result.returncode:break
    else:
        (folder/'comparison-commands.json').write_text(json.dumps(attempts,indent=2),encoding='utf-8')
        raise ValueError('Both hardware and CPU comparison encoding failed.')
    with av.open(str(output)) as video:
        frames=list(video.decode(video=0));width=video.streams.video[0].width;height=video.streams.video[0].height
        if len(frames)!=len(a['frames']) or (width,height)!=(1280,396):raise ValueError('Comparison decode/dimensions mismatch.')
        for index in [0,67,90,101,134]:frames[index].to_image().save(folder/f'comparison-f{index:04d}.jpg',quality=94)
    report={'status':'succeeded','sameClock':True,'sourceSeconds':[9.5,12.5],'pauseSeconds':1.5,
      'decodedFrames':len(frames),'fps':30,'durationSeconds':len(frames)/30,'width':width,'height':height,
      'video':str(output),'bytes':output.stat().st_size,'sha256':sha(output),'inputA':{'sha256':sha(left),'bytes':left.stat().st_size},
      'inputB':{'sha256':sha(right),'bytes':right.stat().st_size},'elapsedSeconds':time.monotonic()-begun,
      'encoder':attempts[-1]['encoder'],'BStatus':'candidate_preview_not_metric_or_human_validated',
      'comparisonScope':'same model content, existing space-specific geometry and camera workflows; not strictly isolated camera or identical Bezier/ribbon'}
    (folder/'comparison-commands.json').write_text(json.dumps(attempts,ensure_ascii=False,indent=2),encoding='utf-8')
    (folder/'comparison-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
