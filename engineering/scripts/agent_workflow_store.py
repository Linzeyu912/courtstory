"""SQLite authority for workflow identity, leases, budgets and immutable outputs."""
from contextlib import contextmanager, closing
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import sqlite3
import time
import uuid

from agent_workflow_contract import (WorkflowError, WORKFLOW_VERSION, canonical, digest,
                                     business_digest, _validate, SOURCE, DOC, ARTIFACT_SCHEMA, native_digest)

TERMINAL = {'succeeded', 'partial', 'needs_attention', 'failed', 'cancelled'}
ACTIVE = {'queued', 'running'}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def file_digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def new_id(prefix):
    return prefix + '-' + uuid.uuid4().hex


class WorkflowStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / 'state.sqlite3'
        with closing(self.connect()) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS assets(caller TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,
                    PRIMARY KEY(caller,id));
                CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,caller TEXT NOT NULL,workflow TEXT NOT NULL,
                    request TEXT NOT NULL,policy TEXT NOT NULL,revision INTEGER NOT NULL,generation INTEGER NOT NULL,
                    status TEXT NOT NULL,created REAL NOT NULL,deadline REAL NOT NULL,source TEXT,doc TEXT,
                    error TEXT,unmet TEXT NOT NULL,budget TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,stage TEXT NOT NULL,
                    generation INTEGER NOT NULL,status TEXT NOT NULL,valid INTEGER NOT NULL DEFAULT 1,
                    request TEXT NOT NULL,input_digest TEXT NOT NULL,source_digest TEXT,deps TEXT NOT NULL,
                    attempt TEXT,lease TEXT,lease_until REAL,result TEXT,error TEXT,created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS operations_run ON operations(run_id,stage,created);
                CREATE TABLE IF NOT EXISTS idempotency(caller TEXT NOT NULL,workflow TEXT NOT NULL,scope TEXT NOT NULL,
                    key TEXT NOT NULL,digest TEXT NOT NULL,target TEXT NOT NULL,
                    PRIMARY KEY(caller,workflow,scope,key));
                CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,operation_id TEXT NOT NULL,
                    path TEXT NOT NULL,metadata TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS resources(operation_id TEXT PRIMARY KEY,resource TEXT NOT NULL,
                    run_id TEXT NOT NULL,lease TEXT NOT NULL,lease_until REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,
                    created TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS analysis_revisions(run_id TEXT NOT NULL,operation_id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL,reason TEXT NOT NULL,prior_analysis TEXT,prior_inventory TEXT,
                    UNIQUE(run_id,revision));
                CREATE TABLE IF NOT EXISTS repair_passes(run_id TEXT NOT NULL,pass_number INTEGER NOT NULL,
                    generation INTEGER NOT NULL,failed_operation TEXT NOT NULL,feedback TEXT NOT NULL,
                    explicit INTEGER NOT NULL,created TEXT NOT NULL,PRIMARY KEY(run_id,pass_number),
                    UNIQUE(run_id,failed_operation));
            ''')

    def connect(self):
        db = sqlite3.connect(str(self.database), timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=30000')
        return db

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def event(self, db, run_id, kind, data):
        db.execute('INSERT INTO events(run_id,created,kind,data) VALUES(?,?,?,?)',
                   (run_id, utc_now(), kind, canonical(data)))

    def register_asset(self, caller, asset_id, record):
        """Trusted local/admin operation; never accepts paths from an HTTP client."""
        record = dict(record)
        path = Path(record.get('videoPath') or record.get('path') or '').resolve()
        if not path.is_file():
            raise WorkflowError('invalid_input', 'Registered video is not a regular file')
        mapping = record.get('sourceFrameMapping')
        if not isinstance(mapping, list) or not mapping:
            raise WorkflowError('invalid_input', 'Asset registration requires exact decoded frame mapping')
        previous_pts = -float('inf')
        native_mapping = []
        for index, frame in enumerate(mapping):
            local = frame.get('assetFrame', frame.get('frame'))
            pts = frame.get('pts', frame.get('time'))
            if local != index or type(local) is not int or type(pts) not in (int, float) or not math.isfinite(pts) or pts < previous_pts:
                raise WorkflowError('invalid_input', 'Invalid decoded frame index or PTS mapping')
            previous_pts = pts
            native_mapping.append({'frame': index, 'time': pts, 'sourceFrame': frame.get('sourceFrame', index),
                                   'sourceTime': frame.get('sourceTime', pts)})
        actual_sha = file_digest(path)
        if record.get('videoSha256') and record['videoSha256'] != actual_sha:
            raise WorkflowError('source_mismatch', 'Supplied video SHA does not match the registered file')
        mapping_digest = native_digest(native_mapping)
        if record.get('frameMappingDigest') and record['frameMappingDigest'] != mapping_digest:
            raise WorkflowError('source_mismatch', 'Supplied frame mapping digest is incorrect')
        record.update({'videoPath': str(path), 'videoSha256': actual_sha, 'sourceFrameMapping': native_mapping,
                       'frameMappingDigest': mapping_digest, 'frameCount': len(mapping), 'assetRef': asset_id})
        baselines = {}
        for field in ('reviewPath', 'clipPath', 'trackingPath', 'trackingMetadataPath', 'baseDocumentPath'):
            if record.get(field):
                baseline = Path(record[field]).resolve()
                if not baseline.is_file():
                    raise WorkflowError('invalid_input', 'Registered baseline is not a regular file')
                record[field] = str(baseline)
                baselines[field] = file_digest(baseline)
        record['baselineDigests'] = baselines
        with self.transaction() as db:
            old = db.execute('SELECT data FROM assets WHERE caller=? AND id=?', (caller, asset_id)).fetchone()
            if old and canonical(record) != old['data']:
                raise WorkflowError('version_conflict', 'Asset IDs are immutable; register a new asset ID')
            db.execute('INSERT OR IGNORE INTO assets VALUES(?,?,?)', (caller, asset_id, canonical(record)))
        return {k: record[k] for k in ('assetRef', 'videoSha256', 'frameMappingDigest', 'frameCount')}

    def asset(self, caller, asset_id):
        with closing(self.connect()) as db:
            row = db.execute('SELECT data FROM assets WHERE caller=? AND id=?', (caller, asset_id)).fetchone()
        if not row:
            raise WorkflowError('invalid_input', 'Asset is unavailable to this caller')
        return json.loads(row['data'])

    def verify_asset(self, caller, asset_id):
        record = self.asset(caller, asset_id)
        try:
            if file_digest(record['videoPath']) != record['videoSha256']:
                raise WorkflowError('source_mismatch', 'Registered video bytes changed')
            for key, expected in record.get('baselineDigests', {}).items():
                if file_digest(record[key]) != expected:
                    raise WorkflowError('version_conflict', 'Registered baseline changed; register a new asset to rebase')
        except OSError as exc:
            raise WorkflowError('source_mismatch', 'Registered source or baseline is no longer readable') from exc
        return record

    def _run(self, db, caller, run_id):
        row = db.execute('SELECT * FROM runs WHERE id=? AND caller=?', (run_id, caller)).fetchone()
        if not row:
            raise WorkflowError('invalid_input', 'Run is unavailable to this caller')
        return row

    def _idem(self, db, caller, scope, key, request):
        fingerprint = business_digest(request)
        row = db.execute('SELECT digest,target FROM idempotency WHERE caller=? AND workflow=? AND scope=? AND key=?',
                         (caller, WORKFLOW_VERSION, scope, key)).fetchone()
        if row and row['digest'] != fingerprint:
            raise WorkflowError('idempotency_conflict', 'Idempotency key already has another business request')
        return (row['target'] if row else None), fingerprint

    def _save_idem(self, db, caller, scope, key, fingerprint, target):
        db.execute('INSERT INTO idempotency VALUES(?,?,?,?,?,?)',
                   (caller, WORKFLOW_VERSION, scope, key, fingerprint, target))

    def existing_operation(self, caller, run_id, stage, request):
        with self.transaction() as db:
            self._run(db, caller, run_id)
            prior, _ = self._idem(db, caller, run_id + ':' + stage, request['idempotencyKey'], request)
            return prior

    def submit(self, caller, request, policy):
        # Deduplication precedes current source checks: retries always identify the same run.
        with self.transaction() as db:
            prior, fingerprint = self._idem(db, caller, 'submit_workflow', request['idempotencyKey'], request)
            if prior:
                return prior
        asset = self.verify_asset(caller, request['args']['assetRef'])
        if request['range']['endFrameExclusive'] > asset['frameCount']:
            raise WorkflowError('invalid_input', 'Requested range exceeds the registered decoded asset')
        if request['args'].get('parentRunRef'):
            self.get(caller, request['args']['parentRunRef'])
        run_id = new_id('run')
        with self.transaction() as db:
            prior, fingerprint = self._idem(db, caller, 'submit_workflow', request['idempotencyKey'], request)
            if prior:
                return prior
            now = time.time()
            budget = {'modelCalls': 0, 'trackingCalls': 0, 'repairPasses': 0, 'costUsd': None, 'wallSeconds': 0}
            db.execute('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (run_id, caller, WORKFLOW_VERSION, canonical(request), canonical(policy), 1, 1,
                        'queued', now, now + policy['maxWallSeconds'], None, None, None, '[]', canonical(budget)))
            self._save_idem(db, caller, 'submit_workflow', request['idempotencyKey'], fingerprint, run_id)
            self.event(db, run_id, 'submitted', {'requestDigest': fingerprint})
        return run_id

    def get(self, caller, run_id):
        with closing(self.connect()) as db:
            row = dict(self._run(db, caller, run_id))
            operations = [dict(item) for item in db.execute('SELECT * FROM operations WHERE run_id=? ORDER BY created,id', (run_id,))]
            artifacts = [json.loads(item['metadata']) for item in db.execute('SELECT metadata FROM artifacts WHERE run_id=?', (run_id,))]
        for field in ('request', 'policy', 'source', 'doc', 'error', 'unmet', 'budget'):
            row[field] = json.loads(row[field]) if row[field] else None
        for item in operations:
            for field in ('request', 'deps', 'result', 'error'):
                item[field] = json.loads(item[field]) if item[field] else None
        row['operations'], row['artifacts'] = operations, artifacts
        row['budget'].setdefault('repairPasses', 0)
        if row['status'] in ACTIVE:
            row['budget']['wallSeconds'] = max(row['budget']['wallSeconds'], min(time.time(), row['deadline']) - row['created'])
        return row

    def stage_results(self, caller, run_id):
        results = {}
        for operation in self.get(caller, run_id)['operations']:
            if operation['valid'] and operation['status'] in {'succeeded', 'skipped'}:
                results[operation['stage']] = operation
        return results

    def _check_revision(self, row, expected):
        if row['revision'] != expected:
            raise WorkflowError('version_conflict', 'expectedRunRevision does not match the current run')

    def register_operation(self, caller, run_id, stage, request, dependency_names):
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            prior, fingerprint = self._idem(db, caller, run_id + ':' + stage, request['idempotencyKey'], request)
            if prior:
                return prior
            self._check_revision(row, request['expectedRunRevision'])
            accepted = json.loads(row['request'])
            if json.loads(row['unmet']) and not accepted['args']['allowPartial']:
                raise WorkflowError('capability_unavailable', 'The accepted request forbids partial delivery')
            bounds = request['range']
            if bounds['startFrame'] < accepted['range']['startFrame'] or bounds['endFrameExclusive'] > accepted['range']['endFrameExclusive']:
                raise WorkflowError('invalid_input', 'Tool range must belong to the accepted run')
            if request['policyRef'] != accepted['policyRef']:
                raise WorkflowError('invalid_input', 'Tool policy differs from the accepted run')
            if row['status'] not in ACTIVE:
                raise WorkflowError('cancelled' if row['status'] == 'cancelled' else 'version_conflict', 'Run is not active')
            if time.time() >= row['deadline']:
                raise WorkflowError('budget_exhausted', 'Workflow wall time budget has elapsed')
            source = json.loads(row['source']) if row['source'] else None
            if request.get('sourceRef') != source and stage != 'inspect_clip':
                raise WorkflowError('source_mismatch', 'Tool sourceRef differs from the current snapshot')
            if request.get('docRef') is not None and canonical(request['docRef']) != (row['doc'] or 'null'):
                raise WorkflowError('version_conflict', 'Tool docRef differs from the current document')
            if stage in {'build_player_annotations', 'commit_candidate', 'render_projected_video'} and (
                    not source or source['trackingFingerprint'] is None or source['trackingRevision'] is None):
                raise WorkflowError('source_mismatch', 'A real derived tracking review is required before native document operations')
            previous = db.execute("SELECT id FROM operations WHERE run_id=? AND stage=? AND valid=1 AND status IN ('queued','running')", (run_id, stage)).fetchone()
            if previous:
                raise WorkflowError('version_conflict', 'An operation for this stage is already in progress')
            deps = {}
            for dependency in dependency_names:
                dep = db.execute("SELECT id,result FROM operations WHERE run_id=? AND stage=? AND valid=1 AND status IN ('succeeded','skipped') ORDER BY created DESC LIMIT 1", (run_id, dependency)).fetchone()
                if not dep:
                    raise WorkflowError('invalid_input', 'An operation dependency is not complete: ' + dependency)
                deps[dep['id']] = digest(json.loads(dep['result']))
            operation_id = new_id('op')
            db.execute('INSERT INTO operations(id,run_id,stage,generation,status,request,input_digest,source_digest,deps,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (operation_id, run_id, stage, row['generation'], 'queued', canonical(request), fingerprint,
                        digest(source), canonical(deps), time.time()))
            db.execute("UPDATE runs SET revision=revision+1,status='running' WHERE id=?", (run_id,))
            self._save_idem(db, caller, run_id + ':' + stage, request['idempotencyKey'], fingerprint, operation_id)
            self.event(db, run_id, 'operation_registered', {'operationId': operation_id, 'stage': stage})
        return operation_id

    def claim(self, caller, run_id, operation_id, resource='cpu', lease_seconds=60):
        with self.transaction() as db:
            run = self._run(db, caller, run_id)
            op = db.execute('SELECT * FROM operations WHERE id=? AND run_id=?', (operation_id, run_id)).fetchone()
            if op and op['status'] == 'running' and op['valid'] and run['status'] in ACTIVE and op['generation'] == run['generation']:
                return None
            if not op or op['status'] != 'queued' or not op['valid'] or run['status'] not in ACTIVE or op['generation'] != run['generation']:
                raise WorkflowError('stale_generation', 'Operation cannot acquire a lease')
            if time.time() >= run['deadline']:
                raise WorkflowError('budget_exhausted', 'Workflow wall time budget has elapsed')
            now = time.time()
            db.execute('DELETE FROM resources WHERE lease_until<=?', (now,))
            policy = json.loads(run['policy'])
            if resource != 'cpu':
                # Shared across processes using this store. Render matches the native single worker.
                limit = policy['apiConcurrency'] if resource == 'api' else 1
                count = db.execute('SELECT COUNT(*) FROM resources WHERE resource=?', (resource,)).fetchone()[0]
                if count >= limit:
                    return None
                if resource == 'api':
                    count = db.execute("SELECT COUNT(*) FROM resources WHERE resource='api' AND run_id=?", (run_id,)).fetchone()[0]
                    if count >= policy['apiConcurrency']:
                        return None
            attempt, lease = new_id('attempt'), new_id('lease')
            analysis_context = {}
            if op['stage'] == 'analyze_play':
                latest_revision = db.execute('SELECT MAX(revision) FROM analysis_revisions WHERE run_id=?', (run_id,)).fetchone()[0] or 0
                prior_analysis = prior_inventory = None
                # Include invalidated historical successes. Existing databases
                # may predate the reservation table; their published revision is
                # still authoritative and must never be reused by a new attempt.
                for historical in db.execute("SELECT result FROM operations WHERE run_id=? AND stage='analyze_play' AND result IS NOT NULL ORDER BY created", (run_id,)):
                    output = json.loads(historical['result']).get('outputs', {})
                    previous = output.get('analysisRevision', 0)
                    if type(previous) is int:
                        latest_revision = max(latest_revision, previous)
                    if output.get('playAnalysisRef'):
                        prior_analysis = output['playAnalysisRef']
                    if output.get('participantInventoryRef'):
                        prior_inventory = output['participantInventoryRef']
                resumed = db.execute("SELECT data FROM events WHERE run_id=? AND kind IN ('resumed','repair_scheduled') ORDER BY id DESC LIMIT 1", (run_id,)).fetchone()
                reason = json.loads(resumed['data'])['reason'] if resumed else 'initial_analysis'
                revision = latest_revision + 1
                db.execute('INSERT INTO analysis_revisions VALUES(?,?,?,?,?,?)',
                           (run_id, operation_id, revision, reason,
                            canonical(prior_analysis) if prior_analysis else None,
                            canonical(prior_inventory) if prior_inventory else None))
                analysis_context = {'analysisRevision': revision, 'analysisRevisionReason': reason,
                                    'priorAnalysisRef': prior_analysis, 'priorInventoryRef': prior_inventory}
                repair = db.execute('SELECT feedback FROM repair_passes WHERE run_id=? AND generation=?',
                                    (run_id, run['generation'])).fetchone()
                if repair:
                    analysis_context['repairFeedbackRef'] = json.loads(repair['feedback'])
            until = min(now + lease_seconds, run['deadline'])
            db.execute("UPDATE operations SET status='running',attempt=?,lease=?,lease_until=? WHERE id=?", (attempt, lease, until, operation_id))
            if resource != 'cpu':
                db.execute('INSERT INTO resources VALUES(?,?,?,?,?)', (operation_id, resource, run_id, lease, until))
            self.event(db, run_id, 'attempt_started', {'operationId': operation_id, 'attemptId': attempt,
                                                     **({'analysisRevision': analysis_context['analysisRevision']} if analysis_context else {})})
        return {'attemptId': attempt, 'leaseToken': lease, 'generation': run['generation'], **analysis_context}

    def _check_lease(self, db, caller, run_id, operation_id, lease):
        run = self._run(db, caller, run_id)
        op = db.execute('SELECT * FROM operations WHERE id=? AND run_id=?', (operation_id, run_id)).fetchone()
        if not op or not op['valid'] or run['status'] not in ACTIVE or op['status'] != 'running' or op['generation'] != run['generation'] or op['lease'] != lease:
            raise WorkflowError('stale_generation', 'Operation lease or generation was revoked')
        now = time.time()
        if now >= run['deadline']:
            raise WorkflowError('budget_exhausted', 'Workflow wall time budget has elapsed')
        if now >= op['lease_until']:
            raise WorkflowError('stale_generation', 'Operation lease expired')
        if op['source_digest'] != digest(json.loads(run['source']) if run['source'] else None):
            raise WorkflowError('source_mismatch', 'Source snapshot changed during the operation')
        for dep_id, expected in json.loads(op['deps']).items():
            dep = db.execute('SELECT valid,status,result FROM operations WHERE id=?', (dep_id,)).fetchone()
            if not dep or not dep['valid'] or dep['status'] not in {'succeeded', 'skipped'} or digest(json.loads(dep['result'])) != expected:
                raise WorkflowError('stale_generation', 'An operation dependency changed')
        return run, op

    def checkpoint(self, caller, run_id, operation_id, lease):
        with self.transaction() as db:
            self._check_lease(db, caller, run_id, operation_id, lease)

    @contextmanager
    def side_effect_guard(self, caller, run_id, operation_id, lease):
        self.verify_asset(caller, self.get(caller, run_id)['request']['args']['assetRef'])
        # Serializes irreversible local save with cancel. Callers must not nest another
        # store transaction in this scope; the handler writes only its derived store.
        with self.transaction() as db:
            run, _ = self._check_lease(db, caller, run_id, operation_id, lease)
            if json.loads(run['unmet']) and not json.loads(run['request'])['args']['allowPartial']:
                raise WorkflowError('capability_unavailable', 'Unmet requirements forbid side effects for this request')
            yield
            # A process crash leaves a recoverable derived save but no accepted artifact.
            # Adapters recover it by matching the exact candidate digest/version.

    def heartbeat(self, caller, run_id, operation_id, lease, lease_seconds=60):
        with self.transaction() as db:
            run, _ = self._check_lease(db, caller, run_id, operation_id, lease)
            until = min(time.time() + lease_seconds, run['deadline'])
            db.execute('UPDATE operations SET lease_until=? WHERE id=?', (until, operation_id))
            db.execute('UPDATE resources SET lease_until=? WHERE operation_id=?', (until, operation_id))

    def consume(self, caller, run_id, operation_id, lease, kind='model', estimated_cost_usd=None):
        with self.transaction() as db:
            run, _ = self._check_lease(db, caller, run_id, operation_id, lease)
            policy, budget = json.loads(run['policy']), json.loads(run['budget'])
            if policy['maxCostUsd'] is not None and estimated_cost_usd is None:
                raise WorkflowError('budget_unmeasurable', 'Provider cannot reliably measure or reserve the required monetary budget')
            if estimated_cost_usd is not None and (type(estimated_cost_usd) not in (int, float) or estimated_cost_usd < 0):
                raise WorkflowError('invalid_input', 'Cost reservation must be nonnegative')
            if kind == 'model' and budget['modelCalls'] >= policy['maxModelCalls']:
                raise WorkflowError('budget_exhausted', 'Model call budget is exhausted')
            if estimated_cost_usd is not None:
                total = (budget['costUsd'] or 0) + estimated_cost_usd
                if policy['maxCostUsd'] is not None and total > policy['maxCostUsd']:
                    raise WorkflowError('budget_exhausted', 'Monetary budget is exhausted')
                budget['costUsd'] = total if budget['modelCalls'] == 0 or budget['costUsd'] is not None else None
            else:
                budget['costUsd'] = None
            budget['modelCalls' if kind == 'model' else 'trackingCalls'] += 1
            db.execute('UPDATE runs SET budget=?,revision=revision+1 WHERE id=?', (canonical(budget), run_id))
            self.event(db, run_id, 'budget_reserved', {'kind': kind, 'estimatedCostUsd': estimated_cost_usd})

    def finish(self, caller, run_id, operation_id, lease, result, attempt_dir, *, failure=None, recovery_revision=None):
        """Register immutable diagnostics even for a failed quality operation.

        recovery_revision is reserved for the trusted local legacy importer. It
        never turns a failed operation into a successful dependency.
        """
        run = self.get(caller, run_id)
        asset = self.verify_asset(caller, run['request']['args']['assetRef'])
        source = result.get('sourceRef')
        doc = result.get('docRef')
        if source:
            _validate(source, SOURCE)
            if source['videoSha256'] != asset['videoSha256'] or source['frameMappingDigest'] != asset['frameMappingDigest']:
                raise WorkflowError('source_mismatch', 'Tool changed the registered video or frame mapping')
        if doc:
            _validate(doc, DOC)
        attempt_dir = Path(attempt_dir).resolve()
        prepared = []
        for artifact in result.get('artifacts', []):
            path = Path(artifact['path']).resolve()
            if not path.is_relative_to(attempt_dir) or not path.is_file():
                raise WorkflowError('output_invalid', 'Artifact must be a completed file inside its attempt directory')
            artifact_id = new_id('artifact')
            meta = {'artifactId': artifact_id, 'kind': artifact['kind'], 'sha256': file_digest(path),
                    'sizeBytes': path.stat().st_size, 'mediaType': artifact.get('mediaType', 'application/json'),
                    'createdAt': utc_now(), 'producerOperationId': operation_id}
            _validate(meta, ARTIFACT_SCHEMA)
            prepared.append((path, meta))
        # Snapshot accepted files. Tool output paths are internal references only.
        artifact_dir = self.root / 'runs' / run_id / 'artifacts'
        artifact_dir.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            if recovery_revision is None:
                row, operation = self._check_lease(db, caller, run_id, operation_id, lease)
            else:
                row = self._run(db, caller, run_id)
                self._check_revision(row, recovery_revision)
                operation = db.execute('SELECT * FROM operations WHERE id=? AND run_id=?', (operation_id, run_id)).fetchone()
                expected_attempt = self.root / 'runs' / run_id / 'attempts' / (operation['attempt'] if operation else '')
                if (not failure or not operation or operation['stage'] != 'preview_projection'
                        or operation['status'] != 'failed' or not operation['valid'] or operation['result']
                        or row['status'] != 'needs_attention' or operation['generation'] != row['generation']
                        or attempt_dir != expected_attempt.resolve()):
                    raise WorkflowError('version_conflict', 'Only the original failed preview attempt can recover diagnostics')
            if failure and operation['stage'] not in {'check_participant_coverage', 'check_projection', 'preview_projection'}:
                raise WorkflowError('invalid_input', 'Only quality failures can publish failed diagnostics')
            if operation['stage'] == 'analyze_play':
                reservation = db.execute('SELECT revision FROM analysis_revisions WHERE operation_id=?', (operation_id,)).fetchone()
                actual_revision = result.get('outputs', {}).get('analysisRevision')
                if not reservation or type(actual_revision) is not int or actual_revision != reservation['revision']:
                    raise WorkflowError('version_conflict', 'Analysis revision differs from its persistent attempt reservation')
            for path, meta in prepared:
                destination = artifact_dir / meta['artifactId']
                temporary = destination.with_suffix('.tmp')
                shutil.copyfile(path, temporary)
                if file_digest(temporary) != meta['sha256']:
                    raise WorkflowError('output_invalid', 'Artifact changed while being registered')
                temporary.replace(destination)
                db.execute('INSERT INTO artifacts VALUES(?,?,?,?,?)',
                           (meta['artifactId'], run_id, operation_id, str(destination), canonical(meta)))
            stored = {**result, 'artifactRefs': [meta for _, meta in prepared]}
            stored.pop('artifacts', None)
            if failure:
                failure.evidence_refs = list(dict.fromkeys(failure.evidence_refs + [meta['artifactId'] for _, meta in prepared]))
            db.execute('UPDATE operations SET status=?,result=?,error=?,lease=NULL,lease_until=NULL WHERE id=?',
                       ('failed' if failure else 'succeeded', canonical(stored), canonical(failure.as_dict()) if failure else None, operation_id))
            db.execute('DELETE FROM resources WHERE operation_id=?', (operation_id,))
            if failure:
                db.execute('UPDATE runs SET revision=revision+1 WHERE id=?', (run_id,))
                if recovery_revision is not None:
                    db.execute('UPDATE runs SET error=? WHERE id=?', (canonical(failure.as_dict()), run_id))
                self.event(db, run_id, 'failed_diagnostics_recovered' if recovery_revision is not None else 'operation_failed',
                           {'operationId': operation_id, 'reasonCode': failure.reason_code, 'resultDigest': digest(stored)})
            else:
                unmet = json.loads(row['unmet']) + result.get('unmetRequirements', [])
                db.execute('UPDATE runs SET revision=revision+1,source=?,doc=?,unmet=? WHERE id=?',
                           (canonical(source) if source else row['source'], canonical(doc) if doc else row['doc'],
                            canonical(list(dict.fromkeys(unmet))), run_id))
                self.event(db, run_id, 'operation_succeeded', {'operationId': operation_id, 'resultDigest': digest(stored)})
        return stored

    def schedule_repair(self, caller, run_id, failed_operation, feedback, expected_revision, *, explicit=False):
        """Consume one repair pass without resetting provider or total wall budgets."""
        self.verify_asset(caller, self.get(caller, run_id)['request']['args']['assetRef'])
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            self._check_revision(row, expected_revision)
            op = db.execute('SELECT * FROM operations WHERE id=? AND run_id=?', (failed_operation, run_id)).fetchone()
            allowed = ACTIVE | ({'needs_attention'} if explicit else set())
            if (row['status'] not in allowed or not op or op['stage'] != 'preview_projection'
                    or op['status'] != 'failed' or not op['valid'] or not op['result']
                    or op['generation'] != row['generation']):
                raise WorkflowError('stale_generation', 'The failed preview is no longer repairable in this generation')
            if db.execute("SELECT 1 FROM operations WHERE run_id=? AND (status='running' OR (valid=1 AND stage='commit_candidate' AND status='succeeded'))", (run_id,)).fetchone():
                raise WorkflowError('version_conflict', 'A running operation or accepted save prevents feedback repair')
            policy, budget = json.loads(row['policy']), json.loads(row['budget'])
            count = db.execute('SELECT COUNT(*) FROM repair_passes WHERE run_id=?', (run_id,)).fetchone()[0]
            if count >= min(1, policy.get('maxRepairPasses', 1)):
                raise WorkflowError('capability_unavailable', 'The bounded feedback repair pass is exhausted')
            if budget['modelCalls'] + 2 > policy['maxModelCalls']:
                raise WorkflowError('budget_exhausted', 'Feedback repair needs remaining analysis and independent review calls')
            if policy['maxCostUsd'] is not None:
                raise WorkflowError('budget_unmeasurable', 'Feedback repair cannot premeasure provider monetary cost')
            now = time.time()
            terminal_restart = explicit and row['status'] not in ACTIVE
            spent = budget['wallSeconds'] if terminal_restart else max(budget['wallSeconds'], now - row['created'])
            if spent >= policy['maxWallSeconds'] or (not terminal_restart and now >= row['deadline']):
                raise WorkflowError('budget_exhausted', 'Feedback repair has no remaining total wall budget')
            created = now - spent if terminal_restart else row['created']
            deadline = now + policy['maxWallSeconds'] - spent if terminal_restart else row['deadline']
            kept = list(db.execute("SELECT stage,result FROM operations WHERE run_id=? AND valid=1 AND stage IN ('inspect_clip','prepare_players') AND status='succeeded'", (run_id,)))
            if {item['stage'] for item in kept} != {'inspect_clip', 'prepare_players'}:
                raise WorkflowError('invalid_input', 'Feedback repair requires intact source and player preparation')
            retained_unmet = list(dict.fromkeys(value for item in kept for value in json.loads(item['result']).get('unmetRequirements', [])))
            folder = self.root / 'runs' / run_id / 'repairs'
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / (new_id('feedback') + '.json')
            feedback = {**feedback, 'repairPass': count + 1}
            path.write_text(canonical(feedback), encoding='utf-8')
            ref = {'path': str(path), 'sha256': file_digest(path)}
            generation = row['generation'] + 1
            db.execute('INSERT INTO repair_passes VALUES(?,?,?,?,?,?,?)',
                       (run_id, count + 1, generation, failed_operation, canonical(ref), int(explicit), utc_now()))
            db.execute("UPDATE operations SET valid=0,lease=NULL,lease_until=NULL WHERE run_id=? AND stage NOT IN ('inspect_clip','prepare_players')", (run_id,))
            db.execute('DELETE FROM resources WHERE run_id=?', (run_id,))
            budget.update({'repairPasses': count + 1, 'wallSeconds': spent})
            db.execute("UPDATE runs SET status='queued',generation=?,revision=revision+1,error=NULL,unmet=?,budget=?,created=?,deadline=? WHERE id=?",
                       (generation, canonical(retained_unmet), canonical(budget), created, deadline, run_id))
            self.event(db, run_id, 'repair_scheduled', {'reason': 'independent_review_feedback', 'repairPass': count + 1,
                'failedOperationId': failed_operation, 'feedbackRef': ref, 'previousGeneration': row['generation'],
                'previousWallSeconds': spent, 'explicitRecovery': terminal_restart,
                'terminalIdleSeconds': max(0, now - row['created'] - spent) if terminal_restart else 0,
                'deadline': deadline})
        return ref

    def skip(self, caller, run_id, operation_id, reason):
        with self.transaction() as db:
            run = self._run(db, caller, run_id)
            op = db.execute('SELECT * FROM operations WHERE id=? AND run_id=?', (operation_id, run_id)).fetchone()
            if not op or op['status'] != 'queued' or run['status'] not in ACTIVE or op['generation'] != run['generation']:
                raise WorkflowError('stale_generation', 'Operation cannot be skipped')
            db.execute("UPDATE operations SET status='skipped',result=? WHERE id=?", (canonical({'outputs': {}, 'skipReason': reason}), operation_id))
            db.execute('UPDATE runs SET revision=revision+1 WHERE id=?', (run_id,))
            self.event(db, run_id, 'operation_skipped', {'operationId': operation_id, 'reason': reason})

    def fail(self, caller, run_id, operation_id, lease, error):
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            op = db.execute('SELECT * FROM operations WHERE id=? AND run_id=?', (operation_id, run_id)).fetchone()
            if not op or row['generation'] != op['generation'] or row['status'] not in ACTIVE or op['lease'] != lease:
                self.event(db, run_id, 'late_result_rejected', {'operationId': operation_id, 'reasonCode': error.reason_code})
                return False
            db.execute("UPDATE operations SET status='failed',error=?,lease=NULL,lease_until=NULL WHERE id=?", (canonical(error.as_dict()), operation_id))
            db.execute('DELETE FROM resources WHERE operation_id=?', (operation_id,))
            db.execute('UPDATE runs SET revision=revision+1 WHERE id=?', (run_id,))
            self.event(db, run_id, 'operation_failed', {'operationId': operation_id, 'reasonCode': error.reason_code})
        return True

    def terminal(self, caller, run_id, status, error=None, *, expected_generation=None):
        if status not in TERMINAL:
            raise ValueError('Invalid terminal state')
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            if row['status'] not in ACTIVE or (expected_generation is not None and row['generation'] != expected_generation):
                return
            budget = json.loads(row['budget'])
            budget['wallSeconds'] = max(0, time.time() - row['created'])
            unmet = json.loads(row['unmet'])
            if error and error.reason_code not in unmet:
                unmet.append(error.reason_code)
            db.execute('UPDATE runs SET status=?,error=?,budget=?,revision=revision+1 WHERE id=?',
                       (status, canonical(error.as_dict()) if error else None, canonical(budget), run_id))
            db.execute('UPDATE runs SET unmet=? WHERE id=?', (canonical(unmet), run_id))
            db.execute("UPDATE operations SET status='cancelled',lease=NULL,lease_until=NULL WHERE run_id=? AND status IN ('queued','running')", (run_id,))
            db.execute('DELETE FROM resources WHERE run_id=?', (run_id,))
            self.event(db, run_id, 'run_terminal', {'status': status})

    def cancel(self, caller, request):
        run_id = request['runId']
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            prior, fingerprint = self._idem(db, caller, run_id + ':cancel_run', request['idempotencyKey'], request)
            if prior:
                return run_id
            self._check_revision(row, request['expectedRunRevision'])
            if row['status'] == 'succeeded':
                raise WorkflowError('version_conflict', 'A successful run cannot be cancelled')
            error = WorkflowError('cancelled', 'Run cancelled by its caller')
            db.execute("UPDATE runs SET status='cancelled',generation=generation+1,revision=revision+1,error=? WHERE id=?", (canonical(error.as_dict()), run_id))
            db.execute("UPDATE operations SET status='cancelled',lease=NULL,lease_until=NULL WHERE run_id=? AND status IN ('queued','running')", (run_id,))
            db.execute('DELETE FROM resources WHERE run_id=?', (run_id,))
            self._save_idem(db, caller, run_id + ':cancel_run', request['idempotencyKey'], fingerprint, run_id)
            self.event(db, run_id, 'cancelled', {'reason': request['args']['reason']})
        return run_id

    def resume(self, caller, request, stage_graph):
        run_id = request['runId']
        # Idempotent retry must work even after a newer generation started.
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            prior, _ = self._idem(db, caller, run_id + ':resume_run', request['idempotencyKey'], request)
            if prior or row['status'] == 'succeeded':
                return run_id
        run = self.get(caller, run_id)
        self.verify_asset(caller, run['request']['args']['assetRef'])
        invalid = set(request['args'].get('retryStages', []))
        if invalid - set(stage_graph):
            raise WorkflowError('invalid_input', 'retryStages contains an unregistered stage')
        # A failed or interrupted stage is always invalidated; successful unaffected
        # stages remain usable after an actual process restart.
        valid_results = self.stage_results(caller, run_id)
        def intact(value):
            if isinstance(value, dict):
                if 'path' in value and 'sha256' in value:
                    try:
                        if file_digest(value['path']) != value['sha256']:
                            return False
                    except OSError:
                        return False
                return all(intact(item) for item in value.values())
            if isinstance(value, list):
                return all(intact(item) for item in value)
            return True
        invalid |= {name for name, op in valid_results.items() if not intact(op['result'])}
        invalid |= set(stage_graph) - set(valid_results)
        changed = True
        while changed:
            old = set(invalid)
            invalid |= {name for name, deps in stage_graph.items() if set(deps) & invalid}
            changed = old != invalid
        retained_unmet = list(dict.fromkeys(item for name, op in valid_results.items() if name not in invalid
                                           for item in op['result'].get('unmetRequirements', [])))
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            prior, fingerprint = self._idem(db, caller, run_id + ':resume_run', request['idempotencyKey'], request)
            if prior:
                return run_id
            self._check_revision(row, request['expectedRunRevision'])
            if row['status'] not in TERMINAL:
                raise WorkflowError('version_conflict', 'Resume requires a terminal run; recover expired leases first')
            for stage in invalid:
                db.execute('UPDATE operations SET valid=0,lease=NULL,lease_until=NULL WHERE run_id=? AND stage=?', (run_id, stage))
            # A fresh generation has a fresh wall-clock budget but retains spent model
            # and monetary budget; explicit resume cannot reset provider call limits.
            now = time.time()
            budget = json.loads(row['budget'])
            previous_wall_seconds = budget['wallSeconds']
            budget['wallSeconds'] = 0
            db.execute("UPDATE runs SET status='queued',generation=generation+1,revision=revision+1,error=NULL,unmet=?,budget=?,created=?,deadline=? WHERE id=?",
                       (canonical(retained_unmet), canonical(budget), now, now + json.loads(row['policy'])['maxWallSeconds'], run_id))
            self._save_idem(db, caller, run_id + ':resume_run', request['idempotencyKey'], fingerprint, run_id)
            self.event(db, run_id, 'resumed', {'invalidatedStages': sorted(invalid), 'reason': request['args']['reason'],
                                            'previousGeneration': row['generation'], 'previousWallSeconds': previous_wall_seconds})
        return run_id

    def recover(self, caller, run_id):
        """Only expired leases are abandoned; another live worker is never stolen."""
        with self.transaction() as db:
            row = self._run(db, caller, run_id)
            expired = db.execute("SELECT id FROM operations WHERE run_id=? AND status='running' AND lease_until<=?", (run_id, time.time())).fetchall()
            if row['status'] not in ACTIVE or not expired:
                return False
            error = WorkflowError('stale_generation', 'A previous worker lease expired; resume can retry affected stages', True)
            db.execute("UPDATE operations SET status='failed',error=?,lease=NULL,lease_until=NULL WHERE run_id=? AND status='running' AND lease_until<=?", (canonical(error.as_dict()), run_id, time.time()))
            db.execute("UPDATE runs SET status='failed',error=?,generation=generation+1,revision=revision+1 WHERE id=?", (canonical(error.as_dict()), run_id))
            db.execute('DELETE FROM resources WHERE run_id=?', (run_id,))
            self.event(db, run_id, 'expired_leases_recovered', {'operationIds': [item['id'] for item in expired]})
        return True
