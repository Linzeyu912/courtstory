"""Two bounded offline mechanism probes; no model/API calls or repo writes."""
from pathlib import Path
import hashlib
import json
import runpy

import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, required=True)
root = parser.parse_args().repo
output = Path(__file__).resolve().parent
source = root / 'engineering/experiments/player_recovery/tracking.py'
mod = runpy.run_path(str(source))

# Synthetic mechanism probe: identical first three observations, different suffix.
frames = [
    {'frame':i, 'time':i/30,
     'detections':[{'bbox':[100+i,100,120+i,140], 'confidence':0.9, 'source':'detector'}]}
    for i in range(7)
]
prefix = mod['recover_tracks'](frames[:3])
full = mod['recover_tracks'](frames)
probe = []
for i in range(3):
    a, b = prefix['frames'][i]['tracks'][0], full['frames'][i]['tracks'][0]
    probe.append({'frame':i,'source':b['source'],'observed':b['observed'],
                  'raw_bbox_equal':a['raw_bbox']==b['raw_bbox'],
                  'prefix_bbox':a['bbox'],'full_bbox':b['bbox'],
                  'max_change_px':max(abs(x-y) for x,y in zip(a['bbox'],b['bbox']))})

# Real-data mechanism probe: perform existing mathematical rebuilding with no anchors.
case = root/'tmp/player-recovery/batch-v3/s24-053/players-short.json'
c = json.loads(case.read_text(encoding='utf-8'))
rebuilt = mod['apply_qwen_anchors'](c, [], fps=c['fps'], max_qwen_gap_seconds=0.3)
def keys(doc):
    return {(f['frame'], p['track_id']) for f in doc['frames'] for p in f['tracks']}

result = {
    'scope':'Pure offline mechanism checks; synthetic probe is not real accuracy evaluation',
    'input_hashes':{str(p.relative_to(root)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in (source,case)},
    'prefix_probe':probe,
    'empty_anchor_replay':{'removed':sorted(keys(c)-keys(rebuilt)),
                           'added':sorted(keys(rebuilt)-keys(c)),
                           'accepted_qwen_anchors':rebuilt['summary']['accepted_qwen_anchors']}
}
assert all(x['raw_bbox_equal'] for x in probe)
assert any(x['max_change_px']>0 for x in probe)
assert result['empty_anchor_replay']['removed']==[(138,14)]
assert not result['empty_anchor_replay']['added']
assert result['empty_anchor_replay']['accepted_qwen_anchors']==0
(output/'offline-dependency-probes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
