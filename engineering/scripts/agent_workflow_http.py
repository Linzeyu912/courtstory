"""Bearer-authenticated HTTP adapter. Every operation uses WorkflowRunner."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit

from agent_workflow_contract import WorkflowError, canonical
from agent_workflow_store import new_id, file_digest

PUBLIC_ARTIFACT_KINDS = {'video', 'editable_document', 'manifest', 'decode_report', 'timing',
                         'check_participant_coverage', 'check_projection', 'player_evidence',
                         'participant_inventory', 'play_analysis', 'composite_preview', 'source_frame',
                         'labeled_evidence', 'independent_review', 'acceptance'}


def make_server(runner, address, credentials):
    """credentials maps opaque bearer tokens to caller IDs (never client input)."""
    if not isinstance(credentials, dict) or not credentials or any(not isinstance(token, str) or not token or not isinstance(caller, str) or not caller for token, caller in credentials.items()):
        raise ValueError('At least one nonempty server-configured credential is required')
    pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='workflow-http')
    active, active_lock = set(), threading.Lock()

    def launch(caller, run_id, operation_id=None):
        key = (caller, run_id, operation_id)
        with active_lock:
            if key in active:
                return
            active.add(key)
        def work():
            try:
                if operation_id:
                    if runner.execute_operation(caller, run_id, operation_id) == 'repair_scheduled':
                        runner.run(caller, run_id)
                else:
                    runner.run(caller, run_id)
            finally:
                with active_lock:
                    active.discard(key)
        pool.submit(work)

    class Handler(BaseHTTPRequestHandler):
        server_version = 'TacticsWorkflow/1.0'

        def log_message(self, format, *args):
            # HTTP logs must never record authorization, request bodies or model text.
            return

        def respond(self, status, value):
            data = canonical(value).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def caller(self):
            auth = self.headers.get('Authorization', '')
            supplied = auth[7:] if auth.startswith('Bearer ') else ''
            for token, caller_id in credentials.items():
                if hmac.compare_digest(token.encode('utf-8'), supplied.encode('utf-8')):
                    return caller_id
            return None

        def body(self):
            if self.headers.get('Transfer-Encoding'):
                raise WorkflowError('invalid_input', 'Chunked request bodies are not supported')
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError as exc:
                raise WorkflowError('invalid_input', 'Invalid Content-Length') from exc
            if not 0 < length <= 1024 * 1024:
                raise WorkflowError('invalid_input', 'Request must contain at most 1 MiB of JSON')
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise WorkflowError('invalid_input', 'Content-Type must be application/json')
            try:
                return json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError) as exc:
                raise WorkflowError('invalid_input', 'Request body must be valid UTF-8 JSON') from exc

        def do_GET(self):
            self.dispatch(False)

        def do_POST(self):
            self.dispatch(True)

        def dispatch(self, post):
            caller = self.caller()
            if caller is None:
                self.respond(401, {'error': WorkflowError('unauthorized', 'A valid bearer credential is required').as_dict()})
                return
            # Programmatic API, no browser-cookie authority or permissive CORS.
            if self.headers.get('Origin'):
                self.respond(403, {'error': WorkflowError('invalid_input', 'Browser origins are not enabled for this API').as_dict()})
                return
            try:
                path = urlsplit(self.path).path
                route = re.fullmatch(r'/v1/workflows/([A-Za-z0-9_.:-]+)(?:/(resume|cancel|artifacts)(?:/([A-Za-z0-9_.:-]+))?)?', path)
                if post and path == '/v1/workflows':
                    request = self.body()
                    result = runner.call('submit_workflow', caller, request)
                    launch(caller, result['runId'])
                    self.respond(202 if result['status'] in {'queued', 'running'} else 200, result)
                elif route:
                    run_id, action, artifact_id = route.groups()
                    runner.store.get(caller, run_id)  # scoped before checking route or files
                    if post and action in {'resume', 'cancel'} and not artifact_id:
                        request = self.body()
                        if request.get('runId') != run_id:
                            raise WorkflowError('invalid_input', 'URL run ID differs from the canonical envelope')
                        result = runner.call(action + '_run', caller, request)
                        if action == 'resume':
                            launch(caller, run_id)
                        self.respond(202 if result['status'] in {'queued', 'running'} else 200, result)
                    elif not post and action == 'artifacts' and artifact_id:
                        with closing(runner.store.connect()) as db:
                            row = db.execute('SELECT path,metadata FROM artifacts WHERE run_id=? AND id=?', (run_id, artifact_id)).fetchone()
                        if not row:
                            raise WorkflowError('invalid_input', 'Artifact is unavailable to this caller')
                        meta = json.loads(row['metadata'])
                        if meta['kind'] not in PUBLIC_ARTIFACT_KINDS:
                            raise WorkflowError('capability_unavailable', 'This diagnostic artifact is available only in the local run audit')
                        if file_digest(row['path']) != meta['sha256']:
                            raise WorkflowError('output_invalid', 'Stored artifact integrity check failed')
                        data = Path(row['path']).read_bytes()
                        self.send_response(200)
                        self.send_header('Content-Type', meta['mediaType'])
                        self.send_header('Content-Length', str(len(data)))
                        self.send_header('Content-Disposition', 'attachment; filename="' + artifact_id + '"')
                        self.send_header('Cache-Control', 'no-store')
                        self.end_headers()
                        self.wfile.write(data)
                    elif not post and action in {None, 'artifacts'} and not artifact_id:
                        result = runner.call('get_run', caller, {'schemaVersion': '1.0', 'requestId': new_id('request'), 'runId': run_id, 'args': {}})
                        self.respond(200, result)
                    else:
                        self.respond(404, {'error': WorkflowError('invalid_input', 'Unknown API route').as_dict()})
                elif post and re.fullmatch(r'/v1/tools/[a-z_]+:call', path):
                    tool = path.rsplit('/', 1)[-1][:-5]
                    result = runner.call(tool, caller, self.body())
                    if result.get('operationId'):
                        launch(caller, result['runId'], result['operationId'])
                    self.respond(202, result)
                else:
                    self.respond(404, {'error': WorkflowError('invalid_input', 'Unknown API route').as_dict()})
            except WorkflowError as exc:
                code = 409 if exc.reason_code in {'version_conflict', 'idempotency_conflict', 'source_mismatch'} else 400
                self.respond(code, {'schemaVersion': '1.0', 'error': exc.as_dict()})
            except Exception:
                self.respond(500, {'schemaVersion': '1.0', 'error': WorkflowError('output_invalid', 'Internal API error; consult local diagnostics').as_dict()})

    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    original_close = server.server_close
    def close():
        original_close()
        pool.shutdown(wait=True, cancel_futures=True)
    server.server_close = close
    # Durable queued runs survive an API process restart. Active leases are not
    # stolen; the runner waits for the owner or reports an expired lease for an
    # explicit generation-changing resume.
    with closing(runner.store.connect()) as db:
        pending = [dict(row) for row in db.execute("SELECT id,caller FROM runs WHERE status IN ('queued','running')")]
    for row in pending:
        if row['caller'] in set(credentials.values()):
            launch(row['caller'], row['id'])
    return server


def serve(runner, host='127.0.0.1', port=8896):
    try:
        credentials = json.loads(os.environ.get('BROADCAST_WORKFLOW_TOKENS', '{}'))
    except json.JSONDecodeError as exc:
        raise WorkflowError('invalid_input', 'Server credential configuration is invalid') from exc
    if not isinstance(credentials, dict) or not credentials:
        raise WorkflowError('invalid_input', 'Set BROADCAST_WORKFLOW_TOKENS to a server-side token-to-caller mapping')
    with make_server(runner, (host, port), credentials) as server:
        server.serve_forever(poll_interval=0.25)
