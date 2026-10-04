"""Render observations side by side, with common mapping and no smoothing.

Pixel/metre disagreement from the baseline is NOT an accuracy measurement.
"""
import argparse
import csv
import json
from pathlib import Path
import numpy as np
import cv2
import av
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[2]
YELLOW=(56,220,255);CYAN=(240,230,25)
FONTS={s:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',s) for s in (17,20,24,28)}
GROUPS=[('yolo',['baseline','yolov8s-pose','yolo11n-pose','yolo26n-pose']),('specialist',['baseline','rtmpose-s-halpe26','rtmw-l','vitpose-plus-small'])]
LABELS={'baseline':'现有 E-BARD YOLOv8n · 人物框底边','yolov8s-pose':'YOLOv8s Pose · 双踝中点','yolo11n-pose':'YOLO11n Pose · 双踝中点','yolo26n-pose':'YOLO26n Pose · 双踝中点','rtmpose-s-halpe26':'RTMPose-s · 双脚关键点中点','rtmw-l':'RTMW-l · 双脚关键点中点','vitpose-plus-small':'ViTPose+ small · 双踝中点'}

def text(image,lines,size=20):
    p=Image.fromarray(cv2.cvtColor(image,cv2.COLOR_BGR2RGB));d=ImageDraw.Draw(p)
    for xy,label,color in lines:d.text(xy,label,font=FONTS[size],fill=color)
    return cv2.cvtColor(np.asarray(p),cv2.COLOR_RGB2BGR)

def project(matrix,point):
    if matrix is None or point is None:return None
    h=np.asarray(matrix).reshape(3,3);r=h@np.array([*point,1.])
    return r[:2]/r[2] if abs(r[2])>1e-8 else None

def court(image,marks,mapping,people,x=638,y=570):
    # Common full-court diagram for every panel, in metres; no interpolation.
    scale=10.;h,w=153,287
    cv2.rectangle(image,(x,y),(x+w,y+h),(179,202,217),-1)
    xy=lambda p:tuple(np.rint([x+p[0]*scale,y+p[1]*scale]).astype(int))
    for line in marks:cv2.polylines(image,[np.array([xy(p) for p in line['points']],np.int32)],False,(83,83,83),1,cv2.LINE_AA)
    counts={'baseline':0,'pose':0,'outside':0}
    for baseline,anchor in people:
        for name,p,col,rad,thickness in (('baseline',project(mapping,baseline),YELLOW,5,2),('pose',project(mapping,anchor),CYAN,3,-1)):
            if p is None:continue
            if 0<=p[0]<=28.6512 and 0<=p[1]<=15.24:
                cv2.circle(image,xy(p),rad if thickness>0 else rad+1,(30,35,40),4 if thickness>0 else -1,cv2.LINE_AA)
                cv2.circle(image,xy(p),rad,col,thickness,cv2.LINE_AA);counts[name]+=1
            else:counts['outside']+=1
    return counts

class Video:
    def __init__(self,path,width,height):
        self.poster_path=Path(path).with_name(Path(path).stem+'-poster.jpg')
        self.container=av.open(str(path),'w',options={'movflags':'+faststart'});self.stream=self.container.add_stream('libx264',rate=15);self.stream.width=width;self.stream.height=height;self.stream.pix_fmt='yuv420p';self.stream.options={'crf':'19','preset':'fast'};self.count=0
    def write(self,image):
        frame=av.VideoFrame.from_ndarray(image,format='bgr24')
        if self.count==0:frame.to_image().save(self.poster_path,quality=88)
        for packet in self.stream.encode(frame):self.container.mux(packet)
        self.count+=1
    def close(self):
        for packet in self.stream.encode():self.container.mux(packet)
        self.container.close()

def pose_panel(image,name,row,mapping,marks,frame,time):
    panel=np.full((746,960,3),(31,27,24),np.uint8);pic=cv2.resize(image,(960,540));sx=960/image.shape[1];sy=540/image.shape[0]
    pos=lambda p:(round(p[0]*sx),round(p[1]*sy))
    pairs=[];usable=0
    for person in row['people']:
        baseline=person['baselineAnchor'];anchor=person.get('anchor') if name!='baseline' else None
        x1,y1,x2,y2=person['box'];cv2.rectangle(pic,pos([x1,y1]),pos([x2,y2]),(175,175,175),1)
        cv2.drawMarker(pic,pos(baseline),YELLOW,cv2.MARKER_CROSS,12,2,cv2.LINE_AA)
        cv2.putText(pic,'T'+str(person['trackId']),pos([x1,y1-3]),cv2.FONT_HERSHEY_SIMPLEX,.48,(255,255,255),1,cv2.LINE_AA)
        if anchor is not None:
            usable+=1;cv2.line(pic,pos(baseline),pos(anchor),CYAN,1,cv2.LINE_AA);cv2.circle(pic,pos(anchor),5,CYAN,2,cv2.LINE_AA)
        pairs.append((baseline,anchor))
    panel[36:576]=pic;matrix=mapping['imageToCourt'];visible=court(panel,marks,matrix,pairs,638,583)
    labels=[((12,3),LABELS[name],(248,248,248)),((12,586),f'源帧 {frame+1} · {time:.3f}s · 15 FPS 慢放',(225,229,233)),
      ((12,615),'黄十字：原框底边   青圆：脚部候选',(255,226,96)),((12,644),f'双侧候选 {usable}/{len(row["people"])} · 接地未验证' if name!='baseline' else '基线观察原样保留 · 不平滑',(210,227,232)),
      ((12,674),'共同矩阵：'+('可用，位置仍待核验' if matrix else '缺失，本帧 2D 留空'),(225,229,233)),
      ((12,704),f'2D 黄圈 {visible["baseline"]} · 青点 {visible["pose"]} · 越界 {visible["outside"]}',(223,202,178))]
    return text(panel,labels)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pose-root',required=True);p.add_argument('--ball-root',required=True);p.add_argument('--maps',required=True);p.add_argument('--output',required=True);p.add_argument('--pose-only',action='store_true',help='Keep existing basketball metrics and render only the six mapped pose comparisons');a=p.parse_args()
    out=Path(a.output);out.mkdir(parents=True,exist_ok=True);maps=json.loads(Path(a.maps).read_text('utf-8'));metrics=[];ball_metrics=[];videos=[]
    previous=json.loads((out/'comparison-metrics.json').read_text('utf-8')) if a.pose_only else None
    library=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text('utf-8'));cv2.setNumThreads(4)
    for sid in ('004','005','006'):
        sample=next(s for s in library['samples'] if s['id']==sid);raw=json.loads((ROOT/next(v['tracks'] for v in sample['trackingVariants'] if v['id']=='ebard')).read_text('utf-8'))
        data={name:json.loads((Path(a.pose_root)/f'{sid}-{name}.json').read_text('utf-8')) for _,names in GROUPS for name in names if name!='baseline'}
        first=next(iter(data.values()));count=len(first['frames']);data['baseline']=first
        if maps['samples'][sid]['videoHash']!=first['videoHash']:raise ValueError('Mapping video mismatch')
        for name,model in data.items():
            if name=='baseline':continue
            px=[];metres=[];n=0;matched=0
            for row in model['frames']:
                h=maps['samples'][sid]['frames'][row['frame']]['imageToCourt']
                for person in row['people']:
                    n+=1;matched+=bool(person.get('matched'))
                    if person.get('anchor') is not None:
                        px.append(float(np.linalg.norm(np.array(person['anchor'])-person['baselineAnchor'])))
                        aa,bb=project(h,person['anchor']),project(h,person['baselineAnchor'])
                        if aa is not None and bb is not None:metres.append(float(np.linalg.norm(aa-bb)))
            metrics.append({'sample':sid,'model':name,'frames':len(model['frames']),'playerObservations':n,'poseMatched':matched,'twoSidedAnchors':len(px),'anchorCoverage':len(px)/n if n else 0,
                'medianBaselineDifferencePixels':float(np.median(px)) if px else None,'medianBaselineDifferenceMetres':float(np.median(metres)) if metres else None,'mappedPairs':len(metres),'groundTruthAvailable':False})
        for tag,names in GROUPS:
            path=out/f'{sid}-feet-{tag}.mp4';writer=Video(path,1920,1492);cap=cv2.VideoCapture(str(ROOT/sample['video']))
            for frame in range(count):
                ok,im=cap.read()
                if not ok:raise ValueError('Video decoding failed')
                mapping=maps['samples'][sid]['frames'][frame]
                panels=[pose_panel(im,n,data[n]['frames'][frame],mapping,maps['markings'],frame,raw[frame]['time']) for n in names]
                canvas=np.vstack([np.hstack(panels[:2]),np.hstack(panels[2:])]);writer.write(canvas)
                if sid=='005' and frame in (0,65,110):cv2.imwrite(str(out/f'{sid}-{tag}-frame{frame+1}.jpg'),canvas)
            writer.close();cap.release();videos.append({'file':path.name,'frames':count,'fps':15,'playbackSpeed':float(15*np.median(np.diff([r['time'] for r in raw])))});print('Rendered',path.name,flush=True)
        if a.pose_only:continue
        balls={n:json.loads((Path(a.ball_root)/f'{sid}-{n}.json').read_text('utf-8')) for n in ('wasb','tracknetv2')}
        ball_count=min(count,*[len(d['frames']) for d in balls.values()]);path=out/f'{sid}-basketball.mp4';writer=Video(path,1920,1252);cap=cv2.VideoCapture(str(ROOT/sample['video']))
        found={n:0 for n in ('baseline','wasb','tracknetv2')};multiple={n:0 for n in found}
        for frame in range(ball_count):
            ok,im=cap.read()
            if not ok:raise ValueError('Video decoding failed')
            panels=[]
            for name in ('baseline','wasb','tracknetv2','explain'):
                panel=np.full((626,960,3),(31,27,24),np.uint8)
                if name=='explain':
                    lines=['篮球图像检测对比','现有 YOLOv8n / WASB / TrackNetV2','候选均使用公开篮球权重；没有重新训练。','绿框 / 黄圈为现有检测；青圈为新候选。','多个青圈：检测歧义；粗圈：最大热图分量。','未人工标注真值，检出帧数不等于准确率。','此视频只比较画面中的球，未投影到地面。','15 FPS 慢放；不平滑、不补缺失。',f'源帧 {frame+1} · {raw[frame]["time"]:.3f}s']
                    panel=text(panel,[((35,35+i*57),s,(232,235,240)) for i,s in enumerate(lines)],24);panels.append(panel);continue
                pic=cv2.resize(im,(960,540));sx=960/im.shape[1];sy=540/im.shape[0]
                if name=='baseline':
                    candidates=[o for o in raw[frame].get('objects',[]) if o['kind']=='basketball']
                    for o in candidates:
                        box=o['box'];x,y=(box[0]+box[2])/2,(box[1]+box[3])/2
                        cv2.rectangle(pic,(round(box[0]*sx),round(box[1]*sy)),(round(box[2]*sx),round(box[3]*sy)),(60,240,100),2)
                        cv2.circle(pic,(round(x*sx),round(y*sy)),10,YELLOW,2,cv2.LINE_AA)
                else:
                    candidates=balls[name]['frames'][frame]['candidates']
                    for i,c in enumerate(candidates):cv2.circle(pic,(round(c['x']*sx),round(c['y']*sy)),10,CYAN,3 if i==0 else 1,cv2.LINE_AA)
                found[name]+=bool(candidates);multiple[name]+=len(candidates)>1
                panel[38:578]=pic
                panel=text(panel,[((12,5),'现有 E-BARD YOLOv8n' if name=='baseline' else name.upper()+' · 篮球权重',(243,244,247)),((12,592),f'源帧 {frame+1} · 候选数 {len(candidates)} · 图像观测，不代表地面位置',(229,232,237))]);panels.append(panel)
            canvas=np.vstack([np.hstack(panels[:2]),np.hstack(panels[2:])]);writer.write(canvas)
            if sid=='005' and frame in (0,65,110):cv2.imwrite(str(out/f'{sid}-ball-frame{frame+1}.jpg'),canvas)
        writer.close();cap.release();videos.append({'file':path.name,'frames':ball_count,'fps':15,'playbackSpeed':float(15*np.median(np.diff([r['time'] for r in raw])))});print('Rendered',path.name,flush=True)
        ball_metrics.extend({'sample':sid,'model':name,'frames':ball_count,'framesWithCandidate':found[name],'framesWithMultipleCandidates':multiple[name],'groundTruthAvailable':False} for name in found)
    if a.pose_only:
        ball_metrics=previous['ball'];videos.extend(v for v in previous['videos'] if '-basketball.' in v['file'])
    summary={'pose':metrics,'ball':ball_metrics,'videos':videos,'metricWarning':'Coverage and baseline disagreement are not accuracy; no manual ground truth. No smoothing.'}
    (out/'comparison-metrics.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    for name,rows in [('pose-metrics.csv',metrics),('ball-metrics.csv',ball_metrics)]:
        with (out/name).open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

if __name__=='__main__':main()
