"""Check actual mapped-marker frame coverage without filling missing observations."""
import argparse
import json
from pathlib import Path

import numpy as np


def mapped(h, point):
    if h is None or point is None:
        return False
    q = np.asarray(h).reshape(3, 3) @ [*point, 1.]
    if not np.isfinite(q).all() or abs(q[2]) < 1e-8:
        return False
    x, y = q[:2]/q[2]
    return bool(0 <= x <= 28.6512 and 0 <= y <= 15.24)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--maps', required=True)
    p.add_argument('--old-maps', required=True)
    p.add_argument('--pose-root', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--minimum', type=float, default=.9)
    a = p.parse_args()
    if not 0 < a.minimum <= 1:
        p.error('minimum must be in (0, 1]')
    data = json.loads(Path(a.maps).read_text('utf-8'))
    old = json.loads(Path(a.old_maps).read_text('utf-8'))
    report = {'acceptanceMinimum': a.minimum, 'samples': {}, 'models': [],
              'independentHumanGroundTruth': False,
              'meaning': 'Frame coverage of visible markers; not metric accuracy or ten-player completeness.'}
    for sid, sample in data['samples'].items():
        rows = sample['frames']; valid = [r for r in rows if r['imageToCourt']]
        inverse_errors = []
        for r in valid:
            product = np.asarray(r['imageToCourt']).reshape(3, 3) @ np.asarray(r['courtToImage']).reshape(3, 3)
            product /= product[2, 2]
            inverse_errors.append(float(np.abs(product-np.eye(3)).max()))
        assert len(valid)/len(rows) >= a.minimum, f'{sid}: insufficient matrix coverage'
        assert max(inverse_errors, default=1.) < 1e-7, f'{sid}: inconsistent inverse'
        report['samples'][sid] = {'totalFrames': len(rows), 'validMatrices': len(valid),
            'matrixCoverage': len(valid)/len(rows),
            'beforeValidMatrices': sum(bool(r['imageToCourt']) for r in old['samples'][sid]['frames']),
            'unavailableFramesOneBased': [r['frame']+1 for r in rows if not r['imageToCourt']],
            'maxInverseIdentityError': max(inverse_errors)}
        inputs = sorted(Path(a.pose_root).glob(sid+'-*.json'))
        assert len(inputs) == 6, f'{sid}: expected all six pose models'
        for path in inputs:
            poses = json.loads(path.read_text('utf-8'))
            assert poses['videoHash'] == sample['videoHash']
            assert len(poses['frames']) == len(rows)
            baseline_frames = pose_frames = both_frames = 0
            for i, frame in enumerate(poses['frames']):
                assert frame['frame'] == rows[i]['frame'] == i
                h = rows[i]['imageToCourt']
                base = sum(mapped(h, person['baselineAnchor']) for person in frame['people'])
                pose = sum(mapped(h, person.get('anchor')) for person in frame['people'])
                baseline_frames += base > 0; pose_frames += pose > 0; both_frames += base > 0 and pose > 0
            result = {'sample': sid, 'model': poses['model'], 'frames': len(rows),
                      'framesWithYellowMarker': baseline_frames, 'framesWithCyanMarker': pose_frames,
                      'framesWithBothColors': both_frames, 'bothColorFrameCoverage': both_frames/len(rows)}
            report['models'].append(result)
            assert result['bothColorFrameCoverage'] >= a.minimum, f'{sid} {poses["model"]}: marker coverage below target'
    Path(a.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report['samples'], ensure_ascii=False))


if __name__ == '__main__':
    main()
