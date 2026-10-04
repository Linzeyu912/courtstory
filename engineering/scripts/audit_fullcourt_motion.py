"""Repair isolated camera-fit excursions only with two measured floor transfers.

The pre-audit candidate is retained byte-for-byte. No missing mapping is filled,
no player trajectory is changed and no matrix is held or temporally smoothed.
"""
import argparse
import copy
from pathlib import Path

import av
import cv2
import numpy as np

from benchmark_court_generalization import CONDITIONS, read, save, sha
from benchmark_fullcourt import boxes_at
from court_fullcourt import floor_flow, normalize, project, LENGTH, WIDTH, valid_geometry, blend_projected_cameras


def common_visible(cameras, ground, width, height):
    pixels = [project(h, ground) for h in cameras]
    keep = np.ones(len(ground), bool)
    for p in pixels:
        keep &= (p[:,0]>0)&(p[:,0]<width)&(p[:,1]>height*.36)&(p[:,1]<height*.85)
    return [p[keep] for p in pixels], ground[keep]


def audit(video, run, tracks, scene, dimensions):
    cv2.setNumThreads(4); width,height=dimensions; scale=min(1.,1280/width)
    s=np.diag([scale,scale,1.]); inverse_s=np.linalg.inv(s)
    ground=np.array([[x,y] for x in np.linspace(0,LENGTH,19) for y in np.linspace(0,WIDTH,11)])
    matrices={r['frame']:np.asarray(r['courtToImage']).reshape(3,3) for r in run['frames'] if r.get('courtToImage')}
    suspects=set()
    for i in range(1,len(run['frames'])):
        if i-1 not in matrices or i not in matrices:continue
        pixels, _=common_visible([matrices[i-1],matrices[i]],ground,width,height)
        if len(pixels[0])>=8 and np.max(np.linalg.norm(pixels[0]-pixels[1],axis=1))>width*.02:
            suspects.update((i-1,i))
    anchors={int(i):np.asarray(h).reshape(3,3) for i,h in run['cameras'].items()}
    supports={}
    for i in suspects:
        before=[j for j in anchors if 0<i-j<=20];after=[j for j in anchors if 0<j-i<=20]
        if before and after:supports[i]=[max(before),min(after)]
    needed={j for i, refs in supports.items() for j in [i,*refs]};grays={}
    with av.open(str(video)) as container:
        for i,frame in enumerate(container.decode(video=0)):
            if i in needed:grays[i]=cv2.resize(frame.to_ndarray(format='gray'),(round(width*scale),round(height*scale)))
    output=copy.deepcopy(run); details=[]
    for i in sorted(supports):
        if i not in matrices:continue
        candidates=[]
        for j in supports[i]:
            e=floor_flow(grays[j],grays[i],s@anchors[j],boxes_at(tracks,scene,j),boxes_at(tracks,scene,i),scale)
            if e is not None:
                candidates.append(normalize(inverse_s@e['h']@s@anchors[j]))
        detail={'frame':i,'supportFrames':supports[i],'independentNeighborTransfers':len(candidates),'repairApplied':False}
        if len(candidates)==2:
            pixels, visible=common_visible([matrices[i],*candidates],ground,width,height)
            if len(visible)>=8:
                errors=[float(np.quantile(np.linalg.norm(pixels[0]-v,axis=1),.9)) for v in pixels[1:]]
                agreement=float(np.quantile(np.linalg.norm(pixels[1]-pixels[2],axis=1),.9))
                detail.update(rawDisagreementPixels=errors,neighborAgreementPixels=agreement,visibleGridPoints=len(visible))
                if min(errors)>8. and agreement<8.:
                    h=blend_projected_cameras(candidates[0],candidates[1],.5,pixels[1])
                    if valid_geometry(h):
                        row=output['frames'][i]
                        row['courtToImage']=h.ravel().tolist();row['imageToCourt']=normalize(np.linalg.inv(h)).ravel().tolist()
                        row['quality']={'method':'bidirectional_measured_camera_repair','supportFrames':supports[i],
                                        'originalMethod':row['quality']['method'],'motionAudit':detail}
                        detail['repairApplied']=True
        details.append(detail)
    output['motionAudit']={'method':'independent_bracketing_keyframe_floor_motion','prescreenGridStepPixels':width*.02,
        'cameraDisagreementGatePixels':8.,'bothNeighborsMustAgreeWithinPixels':8.,'details':details,
        'repairedFrames':[d['frame'] for d in details if d['repairApplied']],
        'missingMappingsFilled':0,'playerDataChanged':False}
    return output


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--previous',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--video',type=Path,required=True)
    p.add_argument('--conditions',nargs='+',choices=CONDITIONS,default=list(CONDITIONS));a=p.parse_args()
    manifest=read(a.previous/'manifest.json');backup=a.output/'before-motion-audit';backup.mkdir(exist_ok=True)
    for name in a.conditions:
        target=a.output/(name+'-joint.json');raw=backup/target.name
        if not raw.exists():raw.write_bytes(target.read_bytes())
        run=read(raw);video=a.video if name=='original' else a.previous/(name+'.mp4')
        assert sha(video)==run['videoHash']==manifest['conditions'][name]['hash']
        result=audit(video,run,read(a.previous/(name+'-tracks.json')),read(a.previous/(name+'-scene.json')),manifest['dimensions'])
        result['motionAudit']['rawCandidateHash']=sha(raw);save(target,result)
        print(name,'measured repairs',result['motionAudit']['repairedFrames'],flush=True)


if __name__=='__main__':main()
