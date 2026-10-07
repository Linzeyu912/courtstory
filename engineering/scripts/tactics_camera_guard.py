"""Conservative local camera contradictions, not calibrated coordinate authority.

Court48 proposals remain needs_review. Only a large endpoint disagreement with
well-supported same-side floor seeds can veto an otherwise accepted route.
Unavailable seeds and small residuals never grant any rendering permission.
"""
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

from court_calibration import COURT_MODEL_SHA256, DEFAULT_COURT_MODEL

ROOT=Path(__file__).resolve().parents[2]
POLICY={'version':1,'minimumPoints':4,'maximumControlRms':5,'minimumLineFamilies':3,
        'minimumLineSupport':.5,'maximumLineMedian':3.5,'minimumDifferencePixels':160,
        'minimumDifferenceWidthRatio':.125,'modelSha256':COURT_MODEL_SHA256,
        'metricAccuracyValidated':False,'scope':'negative_endpoint_contradiction_only'}


def _digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()


def _project(h,p):
    x,y=p;d=h[6]*x+h[7]*y+h[8]
    if not math.isfinite(d) or abs(d)<1e-8:raise ValueError('degenerate projection')
    q=[(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d]
    if not all(math.isfinite(v) for v in q):raise ValueError('nonfinite projection')
    return q


def _inverse(h):
    a,b,c,d,e,f,g,i,j=h
    out=[e*j-f*i,c*i-b*j,b*f-c*e,f*g-d*j,a*j-c*g,c*d-a*f,d*i-e*g,b*g-a*i,a*e-b*d]
    determinant=a*out[0]+b*out[3]+c*out[6]
    if abs(determinant)<1e-10:raise ValueError('singular matrix')
    return [v/determinant for v in out]


def _supported(seed,metadata):
    p=seed.get('proposal',{});q=seed.get('lineQuality',{})
    hypotheses=p.get('orientation',{}).get('hypotheses',[])
    fits=[h.get('fitResidualPixels',math.inf) for h in hypotheses if h.get('accepted')]
    h=p.get('courtToImage')
    return (seed.get('sourceImageSha256')==metadata.get('sourceImageSha256') and
            p.get('status')=='needs_review' and p.get('side') in ('left','right') and
            len(p.get('points',[]))>=4 and bool(fits) and max(fits)<=5 and
            len(q.get('supportedFamilies',[]))>=3 and q.get('supportWithin3Pixels',0)>=.5 and
            q.get('medianResidualPixels',math.inf)<=3.5 and isinstance(h,list) and len(h)==9 and
            all(type(v) in (int,float) and math.isfinite(v) for v in h))


def compare_stage(pack,facts,seeds):
    metadata={row['frame']:row for row in pack['images']}
    people={p['id']:p for p in facts['people']};rows=[]
    cuts=pack.get('sampling',{}).get('cutFrames',[])
    for index,route in enumerate(facts['routes']):
        first,last=route['anchorFrame'],max(route['evidenceFrames'])
        row={'routeIndex':index,'personId':route['personId'],'anchorFrame':first,'lastFrame':last,
             'status':'geometry_unavailable','reason':'insufficient_independent_line_support'}
        rows.append(row)
        a,b=seeds.get(str(first),{}),seeds.get(str(last),{})
        if any(first<c<=last for c in cuts):row['reason']='source_cut';continue
        if not (_supported(a,metadata[first]) and _supported(b,metadata[last])):continue
        if a['proposal']['side']!=b['proposal']['side']:row['reason']='opposite_court_side';continue
        foot=next(o['foot'] for o in people[route['personId']]['observations'] if o['frame']==last)
        try:
            court=_project(_inverse(b['proposal']['courtToImage']),foot)
            point=_project(a['proposal']['courtToImage'],court)
            # Extrapolation beyond the visible image is not negative authority.
            if not (0<=point[0]<=pack['width'] and 0<=point[1]<=pack['height']):continue
            difference=math.dist(point,route['points'][-1])
        except (ValueError,ZeroDivisionError,OverflowError):continue
        threshold=max(160,pack['width']*.125)
        row.update(status='camera_contradiction' if difference>threshold else 'no_large_contradiction',
                   reason='coarse_floor_endpoint_disagreement' if difference>threshold else 'not_an_accuracy_verification',
                   sourceFoot=deepcopy(foot),proposedEndpoint=deepcopy(route['points'][-1]),
                   approximateEndpoint=point,differencePixels=difference,thresholdPixels=threshold,
                   anchorImageSha256=a['sourceImageSha256'],lastImageSha256=b['sourceImageSha256'],
                   anchorLineQuality=deepcopy(a['lineQuality']),lastLineQuality=deepcopy(b['lineQuality']))
    return {'policy':deepcopy(POLICY),'metricAccuracyValidated':False,'routes':rows}


def constrain_audit(stages,audit):
    """Only remove permission, after the caller validates the unmodified audit."""
    effective=deepcopy(audit)
    for stage in stages:
        result=next(row['audit'] for row in effective['stages'] if row['stageId']==stage['stageId'])
        for row in stage.get('cameraGeometry',{}).get('routes',[]):
            if row['status']!='camera_contradiction':continue
            target=next(r for r in result['routes'] if r['routeIndex']==row['routeIndex'])
            if target['personId']!=row['personId']:raise ValueError('camera route reference mismatch')
            # Preserve an existing identity/visibility rejection and its reason;
            # the additional camera evidence is attached separately to repairNeeds.
            if target['verdict']=='accept':
                target.update(verdict='uncertain',geometry='misaligned',
                              reason=('原有相机坐标矛盾尚未解除；本次本地几何不可用，修改需补证'
                                      if row.get('currentComparison')=='geometry_unavailable' else
                                      f"独立球场线检查发现终点约差{row['differencePixels']:.0f}px，需重新核对相机补偿"))
    return effective


def retain_camera_contradictions(stages,reports,previous):
    """An unavailable measurement cannot erase an already established negative.

    No positive result is carried forward. Source, PTS, images, scope and policy
    bind the negative; text/action labels do not change its geometric evidence.
    A coordinate correction still needs a new supported comparison before the
    old conflict can be retired. The visual audit remains mandatory afterward.
    """
    result=deepcopy(reports)
    for stage in stages:
        pack,facts=stage['pack'],stage['facts'];report=result[stage['stageId']]
        source=_digest({'binding':pack.get('binding'),'width':pack['width'],'height':pack['height'],
                        'mapping':pack.get('sourceFrameMapping'),'images':pack['images'],
                        'cuts':pack.get('sampling',{}).get('cutFrames',[]),'policy':POLICY})
        people={p['id']:p for p in facts['people']}
        current={r['routeIndex']:r for r in report.get('routes',[])}
        old=previous.get(stage['stageId'],{}).get('cameraGeometry',{})
        for index,route in enumerate(facts['routes']):
            geometry=_digest({'route':{k:route[k] for k in ('personId','anchorFrame','evidenceFrames','points')},
                              'observations':people[route['personId']]['observations'],'source':source})
            row=current.get(index)
            prior=next((r for r in old.get('routes',[]) if r.get('routeIndex')==index and
                        r.get('personId')==route['personId'] and r.get('sourceDigest')==source and
                        r.get('status')=='camera_contradiction'),None)
            if prior and (row is None or row['status']=='geometry_unavailable'):
                row=deepcopy(prior)
                row.update(currentComparison='geometry_unavailable',reason='known_camera_contradiction_unresolved',
                           geometryInputChanged=prior.get('originalConflictGeometryDigest',prior.get('geometryInputDigest'))!=geometry,
                           currentProposedEndpoint=deepcopy(route['points'][-1]),
                           originalConflictGeometryDigest=prior.get('originalConflictGeometryDigest',prior.get('geometryInputDigest')))
                current[index]=row
            if row is not None:
                row.update(sourceDigest=source,geometryInputDigest=geometry)
        report['routes']=list(current.values())
    return result


def audit_geometry_prompt(stages):
    rows=[]
    for stage in stages:
        report=stage.get('cameraGeometry',{});routes=report.get('routes',[])
        rows.append({'stageId':stage['stageId'],'metricAccuracyValidated':False,
                     'unavailableReason':report.get('reason'),
                     'unavailableRoutes':[r['routeIndex'] for r in routes if r['status']=='geometry_unavailable'],
                     'conflicts':[{k:r[k] for k in ('routeIndex','personId','anchorFrame','lastFrame',
                                                   'sourceFoot','proposedEndpoint','approximateEndpoint','differencePixels',
                                                   'currentComparison','geometryInputChanged','currentProposedEndpoint') if k in r}
                                  for r in routes if r['status']=='camera_contradiction']})
    return ('\n独立本地相机检查（只提供反证，不是精确坐标授权）：'
            'camera_contradiction 项的路线必须重新对照原图中的场地线核对；'
            'approximateEndpoint 只是未确认的粗估参考，禁止直接复制当真值。'
            'currentComparison不可用时，差异和粗估来自历史反证，不代表修改后的当前测量；必须补证，不能因缺测当作已解决。'
            'geometry_unavailable 或 no_large_contradiction 都不代表几何正确。\n'+
            json.dumps(rows,ensure_ascii=False,separators=(',',':')))


class CameraGuard:
    def __init__(self,model_path=None,python_path=None):
        self.model=Path(model_path) if model_path else ROOT/DEFAULT_COURT_MODEL
        self.python=Path(python_path) if python_path else ROOT/'tmp/player-identity-test/.venv/Scripts/python.exe'

    def review(self,stages,clip,folder,deadline,cancel):
        """Local-only, bounded child; failed availability is explicit and nonfatal."""
        from PIL import Image
        results={};requests={};valid=[];folder=Path(folder).resolve()
        def unavailable(stage,reason):results[stage['stageId']]={'policy':deepcopy(POLICY),'metricAccuracyValidated':False,
                                                               'status':'geometry_unavailable','reason':reason,'routes':[]}
        for stage in stages:
            pack=stage['pack']
            if cancel.is_set():unavailable(stage,'cancelled');continue
            if time.monotonic()>=deadline:unavailable(stage,'budget_exhausted');continue
            if (pack.get('binding',{}).get('videoSha256')!=clip.get('video_sha256') or
                (pack.get('width'),pack.get('height'))!=(clip.get('width'),clip.get('height'))):
                unavailable(stage,'source_mismatch');continue
            if clip.get('supportsCourtCalibration') is not True:unavailable(stage,'unsupported_court');continue
            try:
                for m in pack['images']:
                    if cancel.is_set() or time.monotonic()>=deadline:raise TimeoutError('cancelled_or_expired')
                    path=(folder/stage['stageId']/f"source-frame-{m['frame']:06d}.jpg").resolve()
                    if not path.is_relative_to(folder) or path.stat().st_size>20_000_000:raise ValueError('image_path_or_size')
                    if m.get('videoSha256')!=clip['video_sha256'] or hashlib.sha256(path.read_bytes()).hexdigest()!=m['sourceImageSha256']:
                        raise ValueError('source_image_hash_mismatch')
                    with Image.open(path) as image:
                        if image.size!=(pack['width'],pack['height']):raise ValueError('source_image_dimensions')
                    frame=clip['frames'][m['frame']]
                    value={'frame':m['frame'],'sourceImageSha256':m['sourceImageSha256'],'path':str(path),
                           'videoSha256':clip['video_sha256'],'width':pack['width'],'height':pack['height'],
                           'objects':frame.get('objects',[]),'boxes':frame.get('tracks',[]),
                           'cuts':pack.get('sampling',{}).get('cutFrames',[]),'policy':POLICY}
                    requests[_digest(value)]=value
                valid.append(stage)
            except (OSError,ValueError,IndexError,KeyError,TimeoutError) as exc:unavailable(stage,str(exc))
        if not valid:return results
        try:
            cache=folder/'camera-geometry';cache.mkdir(exist_ok=True)
            seeds={};missing={}
            for key,value in requests.items():
                path=cache/f'{key}.json'
                if path.is_file() and path.stat().st_size<200_000:
                    cached=json.loads(path.read_text(encoding='utf-8'))
                    if cached.get('inputDigest')==key and cached.get('seedDigest')==_digest(cached['seed']):
                        seeds[key]=cached['seed'];continue
                missing[key]=value
            if missing:
                if not self.model.is_file() or not self.python.is_file():raise RuntimeError('local_model_unavailable')
                if hashlib.sha256(self.model.read_bytes()).hexdigest()!=COURT_MODEL_SHA256:raise RuntimeError('model_hash_mismatch')
                received=self._infer(missing,cache,deadline,cancel)
                for key,seed in received.items():
                    if key not in missing or seed.get('sourceImageSha256')!=missing[key]['sourceImageSha256']:raise ValueError('worker_source_mismatch')
                    seeds[key]=seed
                    from tactics_job_storage import atomic_job_json
                    atomic_job_json(cache/f'{key}.json',{'inputDigest':key,'seedDigest':_digest(seed),'seed':seed})
            if set(seeds)!=set(requests):raise ValueError('worker_incomplete')
            by_frame={str(requests[k]['frame']):v for k,v in seeds.items()}
            for stage in valid:results[stage['stageId']]=compare_stage(stage['pack'],stage['facts'],by_frame)
        except (OSError,ValueError,KeyError,TimeoutError,RuntimeError) as exc:
            for stage in valid:unavailable(stage,str(exc))
        return results

    def _infer(self,requests,folder,deadline,cancel):
        context=folder/'worker-input.json';context.write_text(json.dumps({'model':str(self.model),'frames':requests}),encoding='utf-8')
        environment=dict(os.environ,YOLO_AUTOINSTALL='false',YOLO_OFFLINE='true',PYTHONIOENCODING='utf-8')
        until=min(deadline,time.monotonic()+30)
        if cancel.is_set() or time.monotonic()>=until:raise TimeoutError('cancelled_or_expired')
        with (folder/'worker-output.json').open('wb') as stdout,(folder/'worker-stderr.txt').open('wb') as stderr:
            process=subprocess.Popen([str(self.python),'-X','utf8',str(Path(__file__).resolve()),str(context)],
                                     cwd=ROOT,env=environment,stdout=stdout,stderr=stderr,
                                     creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:
                while process.poll() is None:
                    if cancel.is_set() or time.monotonic()>=until:raise TimeoutError('local_geometry_timeout_or_cancelled')
                    time.sleep(min(.05,max(0,until-time.monotonic())))
                if process.returncode:raise RuntimeError(f'local_geometry_worker_exit_{process.returncode}')
            finally:
                if process.poll() is None:process.kill()
                process.wait()
        output=folder/'worker-output.json'
        if output.stat().st_size>10_000_000:raise ValueError('local_geometry_output_limit')
        return json.loads(output.read_text(encoding='utf-8'))


def _worker(path):
    import contextlib
    import cv2
    import numpy as np
    from court_calibration import CourtKeypointModel
    from court_orientation import estimate_court
    from court_propagation import projected_line_quality
    data=json.loads(Path(path).read_text(encoding='utf-8'));results={};cv2.setNumThreads(4)
    with contextlib.redirect_stdout(sys.stderr):
        model=CourtKeypointModel(data['model'],640)
        for key,item in data['frames'].items():
            raw=Path(item['path']).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=item['sourceImageSha256']:raise ValueError('source image changed')
            image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if image is None or image.shape[:2]!=(item['height'],item['width']):raise ValueError('source dimensions changed')
            kps=model(image);proposal=estimate_court(kps,item['objects'],item['width'],item['height'])
            seed={'frame':item['frame'],'sourceImageSha256':item['sourceImageSha256'],'proposal':proposal,'rawKeypoints':kps.tolist()}
            if proposal.get('courtToImage'):
                seed['lineQuality']=projected_line_quality(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),np.array(proposal['courtToImage']).reshape(3,3),item['boxes'],1.)
            results[key]=seed
    print(json.dumps(results,ensure_ascii=False,allow_nan=False))


if __name__=='__main__':_worker(sys.argv[1])
