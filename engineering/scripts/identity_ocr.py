"""Local OCR evidence for existing P identities; never edits tracks or identities."""
import math
import re
import threading


class OCRUnavailable(RuntimeError):
    pass


TEAM_ALIASES = {
    'ATL':['ATL','ATLANTA','HAWKS'], 'BOS':['BOS','BOSTON','CELTICS'],
    'BKN':['BKN','BRK','BROOKLYN','NETS'], 'CHA':['CHA','CHARLOTTE','HORNETS'],
    'CHI':['CHI','CHICAGO','BULLS'], 'CLE':['CLE','CLEVELAND','CAVALIERS'],
    'DAL':['DAL','DALLAS','MAVERICKS'], 'DEN':['DEN','DENVER','NUGGETS'],
    'DET':['DET','DETROIT','PISTONS'], 'GSW':['GSW','GS','GOLDEN STATE','WARRIORS'],
    'HOU':['HOU','HOUSTON','ROCKETS'], 'IND':['IND','INDIANA','PACERS'],
    'LAC':['LAC','CLIPPERS'], 'LAL':['LAL','LAKERS'], 'MEM':['MEM','MEMPHIS','GRIZZLIES'],
    'MIA':['MIA','MIAMI','HEAT'], 'MIL':['MIL','MILWAUKEE','BUCKS'],
    'MIN':['MIN','MINNESOTA','TIMBERWOLVES'], 'NOP':['NOP','NO','NEW ORLEANS','PELICANS'],
    'NYK':['NYK','NY','NEW YORK','KNICKS'], 'OKC':['OKC','OKLAHOMA CITY','THUNDER'],
    'ORL':['ORL','ORLANDO','MAGIC'], 'PHI':['PHI','PHILADELPHIA','76ERS'],
    'PHX':['PHX','PHO','PHOENIX','SUNS'], 'POR':['POR','PORTLAND','BLAZERS'],
    'SAC':['SAC','SACRAMENTO','KINGS'], 'SAS':['SAS','SA','SAN ANTONIO','SPURS'],
    'TOR':['TOR','TORONTO','RAPTORS'], 'UTA':['UTA','UTAH','JAZZ'],
    'WAS':['WAS','WSH','WASHINGTON','WIZARDS']}


def jersey_number(text):
    # No O->0 conversion, no extraction of one digit from a score or a clock.
    value=str(text).strip()
    return value if re.fullmatch(r'[0-9]{1,2}',value) else None


def team_codes(text):
    normalized=re.sub(r'[^A-Z0-9]+',' ',str(text).upper()).strip()
    return sorted(code for code,aliases in TEAM_ALIASES.items() if any(
        re.search(r'(?<![A-Z0-9])'+re.escape(alias)+r'(?![A-Z0-9])',normalized) for alias in aliases))


def validate_request(request,payload):
    if request.get('videoSha256')!=payload['video_sha256']:
        raise ValueError('OCR 视频来源已变化，请重新打开当前视频。')
    mode=request.get('mode','jersey')
    if mode not in ('jersey','scoreboard'):raise ValueError('不支持的识别类型。')
    rows=request.get('observations')
    if not isinstance(rows,list) or not 1<=len(rows)<=24:raise ValueError('一次识别应提供 1–24 个画面。')
    seen=set()
    for row in rows:
        if not isinstance(row,dict) or type(row.get('frame')) is not int or not 0<=row['frame']<len(payload['frames']):
            raise ValueError('OCR 帧号不正确。')
        if row['frame'] in seen:raise ValueError('OCR 帧号不能重复。')
        seen.add(row['frame'])
        if mode=='jersey':
            box=row.get('box')
            if (not isinstance(box,list) or len(box)!=4 or
                any(type(v) not in (int,float) or not math.isfinite(v) for v in box) or
                not box[0]<box[2] or not box[1]<box[3] or
                min(payload['width'],box[2])<=max(0,box[0]) or min(payload['height'],box[3])<=max(0,box[1])):
                raise ValueError('请先为当前球员关联有效的人物框。')
            if row.get('trackId') is not None and type(row['trackId']) is not int:
                raise ValueError('临时编号格式不正确。')
    return mode,rows


class IdentityOCR:
    def __init__(self):
        self.engine=None
        self.lock=threading.Lock()

    def _load(self):
        if self.engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
                self.engine=RapidOCR(intra_op_num_threads=4,inter_op_num_threads=1)
            except (ImportError,OSError,RuntimeError) as error:
                raise OCRUnavailable('本地 OCR 模型暂不可用；手工填写和原跟踪继续可用。'+str(error)) from error
        return self.engine

    def recognize(self,video,payload,request):
        mode,rows=validate_request(request,payload)
        import cv2
        import av
        import numpy as np
        requested={row['frame']:row for row in rows};images={}
        with av.open(str(video)) as container:
            for index,picture in enumerate(container.decode(video=0)):
                if index in requested:
                    if abs(float(picture.time)-payload['frames'][index]['time'])>.003:
                        raise ValueError('OCR 视频时间与轨迹不一致。')
                    images[index]=picture.to_ndarray(format='bgr24')
                if index>=max(requested):break
        if len(images)!=len(rows):raise ValueError('无法读取指定的视频帧。')
        evidence=[]
        with self.lock:
            engine=self._load()
            for row in rows:
                image=images[row['frame']];height,width=image.shape[:2]
                if (width,height)!=(payload['width'],payload['height']):raise ValueError('OCR 画面尺寸不一致。')
                if mode=='jersey':
                    x1,y1,x2,y2=row['box'];bh=y2-y1;bw=x2-x1
                    # Torso-only crop reduces shorts, floor logos and nearby players.
                    crop=[max(0,int(x1+.12*bw)),max(0,int(y1+.17*bh)),min(width,int(x2-.12*bw)),min(height,int(y1+.69*bh))]
                else:crop=[0,int(height*.64),width,height]
                x1,y1,x2,y2=crop;patch=image[y1:y2,x1:x2]
                if min(patch.shape[:2])<6:continue
                factor=min(5.,max(1.,160/max(1,patch.shape[0]))) if mode=='jersey' else 1.
                patch=cv2.resize(patch,None,fx=factor,fy=factor,interpolation=cv2.INTER_CUBIC)
                variants=[('color',patch)]
                if mode=='jersey':
                    gray=cv2.cvtColor(patch,cv2.COLOR_BGR2GRAY)
                    gray=cv2.createCLAHE(clipLimit=2.,tileGridSize=(4,4)).apply(gray)
                    variants.append(('contrast',cv2.cvtColor(gray,cv2.COLOR_GRAY2BGR)))
                for variant,pixels in variants:
                    detected,_=engine(pixels)
                    for polygon,text,score in detected or []:
                        number=jersey_number(text) if mode=='jersey' else None
                        codes=team_codes(text) if mode=='scoreboard' else []
                        if mode=='jersey' and (number is None or score<.55):continue
                        if mode=='scoreboard' and (not codes or score<.55):continue
                        vertices=np.asarray(polygon)/factor+np.array([x1,y1])
                        evidence.append({'frame':row['frame'],'time':payload['frames'][row['frame']]['time'],
                            'trackId':row.get('trackId'),'text':str(text),'score':float(score),
                            'jersey':number,'teams':codes,'crop':crop,'polygon':vertices.tolist(),'variant':variant})
        values=sorted({e['jersey'] for e in evidence if e['jersey'] is not None}) if mode=='jersey' else sorted({t for e in evidence for t in e['teams']})
        candidates=[]
        for value in values:
            items=[e for e in evidence if e['jersey']==value] if mode=='jersey' else [e for e in evidence if value in e['teams']]
            candidates.append({'value':value,'score':max(e['score'] for e in items),'distinctFrames':len({e['frame'] for e in items}),
                               'evidence':sorted(items,key=lambda e:-e['score'])[:8]})
        candidates.sort(key=lambda c:(-c['distinctFrames'],-c['score']))
        return {'schemaVersion':1,'mode':mode,'engine':'rapidocr_onnxruntime','videoSha256':payload['video_sha256'],
                'trackingFingerprint':payload.get('tracking_fingerprint'),'candidates':candidates,'scannedFrames':len(images),
                'status':'no_reading' if not candidates else 'candidate' if len(candidates)==1 else 'multiple_candidates',
                'identityConfirmed':False,'reviewRequired':True}
