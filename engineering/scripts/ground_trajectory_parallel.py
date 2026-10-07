"""Ten isolated player lanes over one frozen mapping input; one coordinator merges."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re
import threading
import time
import uuid
from pathlib import Path

from ground_trajectory_agent import GroundTrajectoryAgent, ACTIVE
from ground_trajectory_frame_cache import shared_ground_trajectory_frame_cache
from local_video_library import atomic_json


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def provider_requires_stop(message):
    text=str(message).lower()
    compact=re.sub(r'[\s_-]+','',text)
    return bool(re.search(r'\b(?:401|402|403)\b',text) or
        any(word in compact for word in ('insufficient','arrear','balance','额度不足','欠费',
            'creditsexhausted','creditquotaexhausted','monthlyquotaexhausted',
            'unauthorized','invalidapikey','apikeyisinvalid')))


def with_binding_boundaries(points, entity):
    """Keep frozen coordinates, but don't connect different track bindings blindly."""
    boundaries=set();previous=None
    for binding in sorted(entity.get('bindings',[]),key=lambda b:b.get('start',0)):
        if binding.get('kind')!='track':continue
        track=binding.get('trackId')
        if previous is not None and track!=previous:boundaries.add(binding['start'])
        previous=track
    rows=[dict(p) for p in points]
    for point in rows:
        if point.get('frame') in boundaries:
            point['breakBefore']=True
            point['qualityFlags']=sorted(set(point.get('qualityFlags',[]))|{'binding_transition'})
    return rows


class ParallelGroundMapping:
    def __init__(self, folder, tactics, max_workers=10, chunk_frames=300, notify=None):
        self.folder = Path(folder).resolve(); self.folder.mkdir(parents=True, exist_ok=True)
        self.tactics = tactics; self.max_workers = max_workers; self.chunk_frames = chunk_frames
        self.notify = notify or (lambda value: None)
        self.lock = threading.RLock(); self.stop = threading.Event()
        self.manifest = {}; self.agent = None

    def _save(self):
        with self.lock: atomic_json(self.folder/'run.json', self.manifest)

    def _event(self, **value):
        self.notify(value)

    @staticmethod
    def intervals(count, cuts, width):
        boundaries = sorted({0, count, *(f for f in cuts if 0 < f < count)})
        return [(s, min(s+width, b)) for a, b in zip(boundaries, boundaries[1:]) for s in range(a, b, width)]

    def run(self, session, clip, video, smoothing_config=None, selected_ids=None, review_notes=None):
        # This source is never edited by any lane or adopted into the user's draft.
        session = deepcopy(session); clip = deepcopy(clip)
        ids = selected_ids or [e['id'] for e in session['entities'] if e.get('role') == 'player']
        if len(set(ids)) != len(ids): raise ValueError('Repeated player ownership')
        raw = session['courtPreparation']['rawByPlayer']
        if any(pid not in raw for pid in ids): raise ValueError('Unknown player ownership')
        source_digest = digest({'session':session,'clip':clip})
        previous_results={};previous_manifest={}
        if (self.folder/'result.json').exists():
            old=json.loads((self.folder/'result.json').read_text(encoding='utf-8'))
            if old['sourceDigest']!=source_digest:raise ValueError('Cached results belong to a different frozen input')
            previous_results=old['players']
            # An interrupted coordinator may have saved a player's result before
            # merging it. Recover that owner's completed snapshot on the same input.
            for pid in list(previous_results):
                path=self.folder/'players'/pid/'result.json'
                if path.exists():
                    saved=json.loads(path.read_text(encoding='utf-8'))
                    if saved.get('entityId')==pid and saved.get('raw')==raw.get(pid):previous_results[pid]=saved
        if (self.folder/'run.json').exists():
            previous_manifest=json.loads((self.folder/'run.json').read_text(encoding='utf-8'))
            archive=self.folder/'runs'/f'{previous_manifest["runId"]}.json';archive.parent.mkdir(parents=True,exist_ok=True)
            atomic_json(archive,previous_manifest)
        atomic_json(self.folder/'frozen.json', {'session':session,'clip':clip,'video':str(video),'digest':source_digest})
        self.manifest = {'schemaVersion':1,'runId':str(uuid.uuid4()),'createdAt':datetime.now(timezone.utc).isoformat(),
            'sourceDigest':source_digest,'videoHash':clip['video_sha256'],'status':'running','workers':min(self.max_workers,len(ids)),
            'playerCount':len(ids),'requestedPlayerIds':list(ids),
            'chunkFrames':self.chunk_frames,'players':{pid:{'status':'queued','jobs':[]} for pid in ids},
            'peakActiveModelJobs':0,'errors':[],
            'historicalErrors':previous_manifest.get('historicalErrors',[])+previous_manifest.get('errors',[])}
        for pid,state in previous_manifest.get('players',{}).items():
            if pid not in ids:self.manifest['players'][pid]=state
        self._save()
        self.agent = GroundTrajectoryAgent(self.folder/'jobs', self.tactics, timeout=600,
            max_workers=self.max_workers, frozen_inputs=True, request_concurrency=min(4,self.max_workers),
            request_interval_seconds=2.0)
        provider=self.agent.status()
        self.manifest['provider']={k:provider.get(k) for k in ('model','baseUrl')};self._save()
        self._event(stage='parallel_start', players=ids, sourceDigest=source_digest, configured=self.agent.status())
        if not self.agent.status()['available']:
            self.manifest['status']='failed'; self.manifest['errors'].append(self.agent.status()['message']);self._save()
            self.agent.close();raise ValueError(self.agent.status()['message'])
        try:
            with ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix='player-lane') as pool:
                futures = {pool.submit(self._player, pid, session, clip, video, smoothing_config,
                    (review_notes or {}).get(pid)):pid for pid in ids}
                results = {pid:value for pid,value in previous_results.items() if pid not in ids}
                for future in as_completed(futures):
                    pid = futures[future]
                    try: results[pid] = future.result()
                    except Exception as error:
                        message = self.agent._safe_message(error)
                        with self.lock:
                            self.manifest['players'][pid]['status']='failed';self.manifest['errors'].append({'player':pid,'message':message})
                        self._event(stage='player_failure', player=pid, message=message);self._save()
            if digest({'session':session,'clip':clip}) != source_digest:
                raise ValueError('Frozen source was changed during concurrent work')
            # Only this coordinator writes the multi-player result, after each owner finishes.
            atomic_json(self.folder/'result.json', {'sourceDigest':source_digest,'videoHash':clip['video_sha256'],
                'players':results,'frameMapping':session['courtPreparation']['frameMapping']})
            with self.lock:
                self.manifest['status']='partial' if self.manifest['errors'] or any(r['status']!='ready' for r in results.values()) else 'ready'
                self.manifest['completedAt']=datetime.now(timezone.utc).isoformat()
            self._save();self._event(stage='parallel_done', status=self.manifest['status'], players=len(results))
            return results
        finally: self.agent.close()

    def _player(self, pid, session, clip, video, smoothing_config, review_note=None):
        from ground_trajectory_denoise import denoise_player
        (self.folder/'players'/pid).mkdir(parents=True,exist_ok=True)
        count = len(clip['frames']); prep = session['courtPreparation']
        proposed = deepcopy(prep['rawByPlayer'][pid]); anchors=[]; unknown=[]; jobs=[]
        cuts = sorted(set((session.get('cuts') or []) + clip.get('sourceCuts', [])))
        ranges = self.intervals(count, cuts, self.chunk_frames)
        entity=next(e for e in session['entities'] if e['id']==pid)
        with self.lock:self.manifest['players'][pid]['status']='running'
        self._save()
        for start, end in ranges:
            if self.stop.is_set(): break
            if not any(p.get('x') is not None for p in proposed[start:end]):continue
            result_path=self.folder/'players'/pid/f'{start}-{end}.json'
            result_path.parent.mkdir(parents=True,exist_ok=True)
            value=json.loads(result_path.read_text(encoding='utf-8')) if result_path.exists() else None
            if value and value['status']=='failed':
                result_path.rename(result_path.with_name(f'{start}-{end}-failed-{value["jobId"]}.json'));value=None
            cached=value is not None
            if value is None:
                # All ten lanes request the same introductory timeline where available.
                suggested=sorted({start+round((end-start-1)*i/11) for i in range(min(12,end-start))})
                shared_ground_trajectory_frame_cache().get(clip['video_sha256'], suggested,
                    lambda missing:self.tactics.frames(video,clip,missing))
                goal=(f'你只负责 {pid}（{entity.get("name",pid)}，{entity.get("team",entity.get("teamSide"))}），'
                    f'不修改其他人、身份、检测框或场地标定。范围[{start},{end})。'
                    '先看覆盖本段的拼图和脚部裁图。针对这个人至少选择4-7个清楚内部帧地面锚点；'
                    '每个有足够观测的连续段都应检查，急停/折返/起跳/落地处增加证据。'
                    '双脚落地取接地点中间，单脚支撑取支撑脚；腾空用前后地面证据估水平位置。'
                    '只使用已读图的 assetId 像素坐标，不猜米数；rangeBoundaryLocks 不移动。'
                    '先拟合并真实读取回投，不要把曲线平滑当正确。若原点正确也需明确核对。'
                    '原检测或标定缺失保持缺口。不要把没有检测等同出画；不要误删仍可见位置。'
                    '回投后有问题可补锚点或标合理未知。最后结束候选，记录剩余不确定处。')
                if pid=='P1' and '002' in self.folder.name and start<=1155<end:
                    goal+=' 请检查源帧1155白1号仍可见的情况，不沿用此前误删。'
                if review_note:goal+=' 独立复核提示（仅检查当前本人和当前范围，结论必须重新看原图确认）：'+str(review_note)
                request={'session':session,'clientRevision':0,'entityIds':[pid],
                    'range':{'startFrame':start,'endFrameExclusive':end},'goal':goal}
                job=self.agent.create(request,clip,video,clip['tracking_revision'],True)
                with self.lock:self.manifest['players'][pid]['jobs'].append(job['jobId'])
                self._save();self._event(stage='player_job_start',player=pid,start=start,end=end,jobId=job['jobId'])
                last=None
                while True:
                    value=self.agent.get(job['jobId'],clip,clip['tracking_revision'],True)
                    signature=(value['status'],value.get('message'),(value.get('usage') or {}).get('requests'))
                    if signature!=last:
                        self._event(stage='player_progress',player=pid,start=start,status=value['status'],
                            message=value.get('message'),requests=(value.get('usage') or {}).get('requests'));last=signature
                    with self.agent.lock:
                        active=sum(j['status'] in ACTIVE and (j.get('usage') or {}).get('requests',0)>0 for j in self.agent.jobs.values())
                    with self.lock:self.manifest['peakActiveModelJobs']=max(active,self.manifest['peakActiveModelJobs'])
                    activity=getattr(self.agent,'request_activity',{})
                    with self.lock:
                        self.manifest['requestConcurrencyLimit']=activity.get('limit')
                        self.manifest['peakInFlightRequests']=max(self.manifest.get('peakInFlightRequests',0),activity.get('peakActive',0))
                    if value['status'] not in ACTIVE:break
                    if self.stop.is_set():self.agent.cancel(job['jobId'],clip,clip['tracking_revision'],True)
                    time.sleep(1)
                atomic_json(result_path,value)
            c=value.get('candidate');jobs.append({'start':start,'end':end,'jobId':value.get('jobId'),
                'status':value['status'],'usage':value.get('usage'),'message':value.get('message')})
            if c:
                if c['entityIds'] != [pid]:raise ValueError('A lane attempted to modify another player')
                for f in range(start,end):proposed[f]=deepcopy(c['pointsByPlayer'][pid][f])
                anchors.extend(c['anchors']);unknown.extend(c['unknownRanges'])
            if value['status']=='failed' or (not cached and value.get('lastError')):
                message=value.get('lastError') or value.get('message','任务失败')
                self._event(stage='model_failure',player=pid,start=start,status=value['status'],message=message)
                with self.lock:self.manifest['errors'].append({'player':pid,'start':start,'status':value['status'],'message':message})
                if provider_requires_stop(message):
                    self.stop.set();break
        proposed=with_binding_boundaries(proposed,entity)
        filtered=denoise_player(proposed, anchors=anchors, cuts=cuts, config=smoothing_config)
        status='ready' if jobs and all(j['status']=='ready' for j in jobs) else 'partial'
        result={'entityId':pid,'status':status,'raw':prep['rawByPlayer'][pid],'refined':proposed,
            'points':filtered['points'],'denoise':filtered['diagnostics'],'anchors':anchors,'unknownRanges':unknown,'jobs':jobs}
        atomic_json(self.folder/'players'/pid/'result.json',result)
        with self.lock:self.manifest['players'][pid].update(status=status,anchors=len(anchors),completedJobs=len(jobs))
        self._save();self._event(stage='player_done',player=pid,status=status,anchors=len(anchors),jobs=len(jobs))
        return result
