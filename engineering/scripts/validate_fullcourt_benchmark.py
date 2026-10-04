"""Validate provenance, all frame matrices, timing and complete video decoding."""
import argparse
from pathlib import Path

import av
import numpy as np

from benchmark_court_generalization import CONDITIONS, read, save, sha
from court_fullcourt import valid_geometry, project, LENGTH, WIDTH


def validate(directory, previous, video):
    manifest = read(previous/'manifest.json'); result = {'sourceHash': manifest['sourceHash'], 'conditions': {}, 'videos': {}}
    ground = np.array([[x, y] for x in np.linspace(0, LENGTH, 9) for y in np.linspace(0, WIDTH, 5)])
    for name in CONDITIONS:
        source = video if name == 'original' else previous/(name+'.mp4')
        run = read(directory/(name+'-joint.json')); rows = run['frames']
        if run.get('motionAudit'):
            assert sha(directory/'before-motion-audit'/(name+'-joint.json')) == run['motionAudit']['rawCandidateHash']
        assert sha(source) == run['videoHash'] == manifest['conditions'][name]['hash']
        for suffix, expected in run['provenance']['inputs'].items(): assert sha(previous/(name+suffix)) == expected
        assert len(rows) == len(manifest['frames'])
        roundtrips = []; steps = []; prior = None
        for i, (row, clock) in enumerate(zip(rows, manifest['frames'])):
            assert row['frame'] == i and abs(row['time']-clock['time']) < .001
            if not row.get('courtToImage'):
                assert row['status'] == 'invalid' and row['reason']; prior = None; continue
            h = np.asarray(row['courtToImage']).reshape(3,3); inverse = np.asarray(row['imageToCourt']).reshape(3,3)
            assert valid_geometry(h) and row['metricAccuracyValidated'] is False
            points = project(h, ground); recovered = project(inverse, points)
            error = float(np.max(np.linalg.norm(recovered-ground,axis=1))); roundtrips.append(error); assert error < 1e-6
            if prior is not None:
                visible = (points[:,0]>=0)&(points[:,0]<1552)&(points[:,1]>=0)&(points[:,1]<872)&(prior[:,0]>=0)&(prior[:,0]<1552)&(prior[:,1]>=0)&(prior[:,1]<872)
                if visible.any(): steps.append({'frame':i,'pixels':float(np.max(np.linalg.norm(points[visible]-prior[visible],axis=1)))})
            prior = points
            q = row['quality']
            if 'twoAnchorDifferenceMeters' in q: assert q['twoAnchorDifferenceMeters']['p95'] <= .75
        result['conditions'][name] = {'allSourceAndCacheHashesPreserved': True, 'frameTimesChecked':len(rows),
            'matricesChecked':len(roundtrips),'maximumInverseRoundtripMeters':max(roundtrips),
            'largestConsecutiveVisibleGridStepPixelsNotPlayerMotion':max(steps,key=lambda r:r['pixels']) if steps else None}
    for name, size in [('court-before-after.mp4',(1920,640)),('court-augmentations.mp4',(1920,1280))]:
        path = directory/name; count = 0; prior = None
        with av.open(str(path)) as container:
            stream=container.streams.video[0]
            assert (stream.width,stream.height)==size
            for picture in container.decode(video=0):
                assert abs(float(picture.time)-count/30) < .001
                prior=float(picture.time); count+=1
            assert count == len(manifest['frames'])
        with path.open('rb') as f: header=f.read(2*1024*1024)
        assert header.find(b'moov')>=0 and header.find(b'moov')<header.find(b'mdat')
        result['videos'][name]={'sha256':sha(path),'decodedFrames':count,'lastTime':prior,'dimensions':list(size),'fastStart':True}
    result['verificationCodeHashes']={name:sha(Path(__file__).parent/name) for name in
        ('court_fullcourt.py','benchmark_fullcourt.py','audit_fullcourt_motion.py','report_fullcourt.py','validate_fullcourt_benchmark.py','test_court_fullcourt.py')}
    save(directory/'validation.json',result)
    print('All source/cache hashes, 4320 frame records, valid matrices and both complete videos verified.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--previous',type=Path,required=True);p.add_argument('--video',type=Path,required=True)
    a=p.parse_args();validate(a.output,a.previous,a.video)
