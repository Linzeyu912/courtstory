"""User-started Qwen Token Plan probe; never changes a production draft."""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'engineering/scripts'))
from local_video_library import atomic_json
from player_name_identity import create_qwen_token_plan_provider, recognize_player_names
from player_game_roster import PlayerGameRoster
from tactical_workbench import TacticalWorkbench


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


class LoggedProvider:
    def __init__(self, provider, folder):
        self.provider, self.folder, self.calls = provider, folder, []

    def status(self):
        return self.provider.status()

    def read(self, images, labels):
        started = time.monotonic()
        emit({'event': 'reading', 'player': labels[0].split('-')[0], 'images': len(images)})
        try:
            result = self.provider.read(images, labels)
        except Exception as error:
            self.calls.append({'player': labels[0].split('-')[0], 'images': len(images), 'ok': False,
                'elapsedSeconds': round(time.monotonic()-started, 3), 'message': str(error)})
            atomic_json(self.folder/'calls.json', self.calls)
            emit(self.calls[-1])
            raise
        entry = {'player': labels[0].split('-')[0], 'images': len(images), 'ok': True,
            'elapsedSeconds': round(time.monotonic()-started, 3), 'readings': result}
        self.calls.append(entry)
        atomic_json(self.folder/'calls.json', self.calls)
        emit({'event': 'read', **{k:v for k,v in entry.items() if k != 'readings'}})
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--players', nargs='*', help='Optional QA subset; default all ten')
    parser.add_argument('--max-images', type=int, default=12)
    parser.add_argument('--label', default='all-players')
    args=parser.parse_args()
    if not args.label.replace('-', '').isalnum():
        parser.error('Use a simple label')
    out=ROOT/'artifacts/player-name-identity-20261007'/args.label
    out.mkdir(parents=True, exist_ok=True)
    session=read(ROOT/'artifacts/qwen-all-players-20261007/official-training-001/session.json')
    clip=read(ROOT/'artifacts/qwen-official-20261005/official-training-001/clip.json')
    library=read(ROOT/'data/videos/tactics/acceptance/review-library.json')
    video=ROOT/next(s['video'] for s in library['samples'] if s['id']=='official-training-001')
    original=deepcopy(session)
    if args.players:
        for entity in session['entities']:
            if entity['id'] not in args.players:
                entity['identitySuggestionsDismissed']=True
                for field in ('bindings', 'modelBindings', 'anchors', 'identityKeyframes'):
                    entity[field]=[]
    atomic_json(out/'input-session.json',session)
    atomic_json(out/'input-clip.json',clip)
    provider=LoggedProvider(create_qwen_token_plan_provider(timeout=90),out)
    started=time.monotonic()
    candidate=recognize_player_names(session,clip,video,TacticalWorkbench(out/'workbench'),
        PlayerGameRoster(ROOT/'data/player-rosters','0022500701'), season='2025-26',
        team_map={'A':'HOU','B':'DAL'}, provider=provider, max_frames_per_entity=args.max_images,work_dir=out/'evidence')
    source=hashlib.sha256(json.dumps(session,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    job={'jobId':'interactive-'+args.label,'purpose':'player_names','status':'ready','sourceKey':source,
        'base':{'videoHash':clip['video_sha256'],'trackingFingerprint':clip['tracking_fingerprint'],
            'trackingRevision':clip['tracking_revision'],'variant':'team-stable','qa':True,'clientRevision':0},
        'candidate':candidate}
    atomic_json(out/'job.json',job)
    summary={'case':'official-training-001','gameId':'0022500701','provider':provider.status(),
        'calls':len(provider.calls),'successfulCalls':sum(x['ok'] for x in provider.calls),
        'elapsedSeconds':round(time.monotonic()-started,3),
        'segments':dict(Counter(x['status'] for x in candidate['candidates'])),
        'players':[{ 'id':e['id'], 'names':sorted({x['nameCandidate']['name'] for x in candidate['candidates']
             if x['entityId']==e['id'] and x['status']=='candidate'}),
             'candidateSegments':sum(x['entityId']==e['id'] and x['status']=='candidate' for x in candidate['candidates'])}
             for e in session['entities'] if e['role']=='player'],
        'inputChanged':original!=read(ROOT/'artifacts/qwen-all-players-20261007/official-training-001/session.json'),
        'identityAccuracyVerified':False}
    atomic_json(out/'summary.json',summary)
    emit(summary)


if __name__=='__main__':
    main()
