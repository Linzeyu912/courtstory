"""Local administration and canonical submit/status/resume/cancel CLI."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import shutil
import sys

from agent_workflow_contract import WorkflowError, canonical
from agent_workflow_runner import WorkflowRunner, production_handlers
from agent_workflow_store import WorkflowStore, new_id, file_digest


def export_diagnostics(runner, caller, run_id, target, result):
    """Export registered evidence and history without accepting a failed run."""
    run = runner.store.get(caller, run_id)
    names = {'source_snapshot': 'source-snapshot.json', 'registered_review': 'registered-review.json',
             'capabilities': 'capabilities.json', 'derived_clip': 'derived-clip.json',
             'derived_review': 'derived-review.json', 'player_evidence': 'player-evidence.json',
             'identity_map': 'identity-map.json', 'detector_output': 'detector-output.json',
             'detector_provenance': 'detector-provenance.json', 'baseline_document': 'baseline-document.json',
             'play_analysis': 'play-analysis.json', 'participant_inventory': 'participant-inventory.json',
             'analysis_revision': 'analysis-revision.json', 'repair_feedback': 'repair-feedback.json',
             'repair_evidence_frames': 'repair-source-frames.json', 'candidateRef': 'candidate.json',
             'annotationMapRef': 'annotation-map.json', 'renderPlanRef': 'render-plan.json',
             'check_participant_coverage': 'coverage.json', 'check_projection': 'projection.json',
             'independent_review': 'independent-review.json', 'preview_manifest': 'preview-manifest.json',
             'provider_diagnostic': 'provider-diagnostic.json',
             'independent_review_diagnostic': 'independent-review-diagnostic.json'}
    images = {'source_frame': 'source-frame', 'repair_source_frame': 'repair-source-frame',
              'labeled_evidence': 'labeled-evidence', 'composite_preview': 'preview'}
    files, omitted, history = [], [], []
    with closing(runner.store.connect()) as db:
        rows = [dict(row) for row in db.execute('SELECT * FROM artifacts WHERE run_id=? ORDER BY id', (run_id,))]
        events = [dict(row) for row in db.execute('SELECT id,created,kind,data FROM events WHERE run_id=? ORDER BY id', (run_id,))]
    for index, operation in enumerate(run['operations'], 1):
        exported, counters = [], {}
        for row in (item for item in rows if item['operation_id'] == operation['id']):
            try:
                meta = json.loads(row['metadata'])
                if meta['artifactId'] != row['id'] or meta['producerOperationId'] != operation['id']:
                    raise ValueError('producer_mismatch')
                kind = meta['kind']
                if kind not in names and kind not in images:
                    omitted.append({'artifactId': row['id'], 'reason': 'kind_not_in_diagnostic_package'})
                    continue
                path = Path(row['path']).resolve()
                registered_root = runner.store.root / 'runs' / run_id / 'artifacts'
                if not path.is_relative_to(registered_root.resolve()) or not path.is_file():
                    raise ValueError('registered_file_unavailable')
                if file_digest(path) != meta['sha256'] or path.stat().st_size != meta['sizeBytes']:
                    raise ValueError('integrity_check_failed')
                counters[kind] = counters.get(kind, 0) + 1
                number = counters[kind]
                filename = names.get(kind) or f"{images[kind]}-{number:03d}.{'png' if kind == 'composite_preview' else 'jpg'}"
                if kind in names and number > 1:
                    filename = filename.removesuffix('.json') + f'-{number:03d}.json'
                relative = f'history/operation-{index:03d}/{filename}'
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_suffix(destination.suffix + '.tmp')
                shutil.copyfile(path, temporary)
                if file_digest(temporary) != meta['sha256']:
                    temporary.unlink()
                    raise ValueError('copy_integrity_check_failed')
                temporary.replace(destination)
                files.append({'name': relative, 'kind': kind, 'artifactId': row['id'], 'producerOperationId': operation['id'],
                              'sha256': meta['sha256'], 'sizeBytes': meta['sizeBytes'], 'accepted': False})
                exported.append(row['id'])
            except (OSError, ValueError, KeyError, TypeError):
                omitted.append({'artifactId': row['id'], 'reason': 'untrusted_or_unavailable_registered_artifact'})
        error = operation['error']
        public_error = ({**error, 'message': 'Operation stopped: ' + error['reasonCode'], 'suggestedAction': None} if error else None)
        history.append({'operationId': operation['id'], 'stage': operation['stage'], 'generation': operation['generation'],
                        'status': operation['status'], 'valid': bool(operation['valid']), 'attemptId': operation['attempt'],
                        'resultRecorded': operation['result'] is not None, 'error': public_error,
                        'exportedArtifactIds': exported})
    event_keys = {'operationId', 'attemptId', 'reasonCode', 'generation', 'previousGeneration', 'repairPass',
                  'previousWallSeconds', 'explicitRecovery', 'terminalIdleSeconds', 'status', 'kind', 'estimatedCostUsd',
                  'analysisRevision', 'failedOperationId', 'resultDigest', 'invalidatedStages'}
    safe_events = [{**{key: event[key] for key in ('id', 'created', 'kind')},
                    'data': {key: value for key, value in json.loads(event['data']).items() if key in event_keys}} for event in events]
    operation_index = {item['operationId']: item for item in history}
    checks = []
    for item in files:
        if item['kind'] not in {'check_participant_coverage', 'check_projection', 'independent_review',
                                'provider_diagnostic', 'independent_review_diagnostic'}:
            continue
        operation = operation_index[item['producerOperationId']]
        try:
            report = json.loads((target / item['name']).read_text(encoding='utf-8'))
            readable = isinstance(report, dict)
            report = report if readable else {}
        except (OSError, ValueError, UnicodeDecodeError):
            readable, report = False, {}
        checks.append({'file': item['name'], 'sha256': item['sha256'], 'kind': item['kind'],
                       'producerOperationId': operation['operationId'], 'generation': operation['generation'],
                       'operationStatus': operation['status'], 'valid': operation['valid'], 'reportReadable': readable,
                       'reportedPass': report.get('pass'), 'reportedVerdict': report.get('verdict'),
                       'diagnosticOnly': report.get('diagnosticOnly'), 'executionAccepted': report.get('executionAccepted'),
                       'candidateDigest': report.get('candidateDigest'), 'sourceRef': report.get('sourceRef'),
                       'analysisRevision': report.get('analysisRevision')})
    generated = {'run.json': {**result, 'accepted': False, 'packageType': 'diagnostic'},
                 'error.json': {'runId': run_id, 'status': result['status'], 'accepted': False,
                                'error': result['error'], 'unmetRequirements': result['unmetRequirements']},
                 'failure-history.json': {'schemaVersion': '1.0', 'runId': run_id, 'accepted': False,
                                         'operations': history, 'events': safe_events, 'omittedArtifacts': omitted},
                 'quality-report.json': {'schemaVersion': '1.0', 'runId': run_id, 'status': result['status'],
                    'accepted': False, 'finalVideo': None, 'finalDocument': None, 'checks': checks,
                    'unmetRequirements': result['unmetRequirements'], 'omittedArtifacts': omitted}}
    for name, value in generated.items():
        path = target / name
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        files.append({'name': name, 'kind': 'diagnostic_index', 'sha256': file_digest(path),
                      'sizeBytes': path.stat().st_size, 'accepted': False})
    delivery = {'schemaVersion': '1.0', 'runId': run_id, 'status': result['status'], 'accepted': False,
                'packageType': 'diagnostic', 'finalDocument': None, 'finalVideo': None,
                'unmetRequirements': result['unmetRequirements'], 'omittedArtifacts': omitted, 'files': files}
    manifest = target / 'manifest.json'
    manifest.write_text(json.dumps(delivery, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    files.append({'name': 'manifest.json', 'kind': 'diagnostic_manifest', 'sha256': file_digest(manifest),
                  'sizeBytes': manifest.stat().st_size, 'accepted': False})
    (target / 'delivery.json').write_text(json.dumps(delivery, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return delivery


def export_delivery(runner, caller, run_id, output):
    """Flatten accepted results into an explicit local delivery folder."""
    result = runner.response(caller, run_id, new_id('request'))
    if result['status'] not in {'succeeded', 'partial', 'needs_attention', 'failed', 'cancelled'}:
        raise WorkflowError('invalid_input', 'Only terminal runs can be exported')
    target = Path(output).resolve()
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise WorkflowError('version_conflict', 'Delivery output must be a new or empty directory')
    target.mkdir(parents=True, exist_ok=True)
    if result['status'] in {'needs_attention', 'failed', 'cancelled'}:
        return export_diagnostics(runner, caller, run_id, target, result)
    names = {'video': 'result.mp4', 'editable_document': 'document.json', 'manifest': 'manifest.json',
             'decode_report': 'decode-report.json', 'timing': 'timing.json',
             'check_participant_coverage': 'coverage.json', 'check_projection': 'projection.json',
             'independent_review': 'independent-review.json', 'play_analysis': 'play-analysis.json',
             'participant_inventory': 'participant-inventory.json', 'annotationMapRef': 'annotation-map.json',
             'player_evidence': 'player-evidence.json', 'analysis_revision': 'analysis-revision.json',
             'repair_feedback': 'repair-feedback.json',
             'repair_evidence_frames': 'repair-source-frames.json',
             'acceptance': 'acceptance.json'}
    selected = {}
    previews = []
    repair_sources = []
    for operation in runner.store.stage_results(caller, run_id).values():
        for metadata in (operation['result'] or {}).get('artifactRefs', []):
            if metadata['kind'] in names:
                selected[metadata['kind']] = metadata
            elif metadata['kind'] == 'composite_preview':
                previews.append(metadata)
            elif metadata['kind'] == 'repair_source_frame':
                repair_sources.append(metadata)
    files = []
    with closing(runner.store.connect()) as db:
        deliveries = [(names[kind], metadata) for kind, metadata in selected.items()]
        deliveries += [(f'preview-{index:03}.png', metadata) for index, metadata in enumerate(previews, 1)]
        repair_frames = {}
        if repair_sources and 'repair_evidence_frames' not in selected:
            raise WorkflowError('output_invalid', 'Accepted repair source images have no matching frame manifest')
        if 'repair_evidence_frames' in selected:
            metadata = selected['repair_evidence_frames']
            row = db.execute('SELECT path FROM artifacts WHERE run_id=? AND id=?', (run_id, metadata['artifactId'])).fetchone()
            if not row or file_digest(row['path']) != metadata['sha256']:
                raise WorkflowError('output_invalid', 'Repair frame manifest failed its delivery integrity check')
            manifest = json.loads(Path(row['path']).read_text(encoding='utf-8'))
            if not isinstance(manifest, dict) or not isinstance(manifest.get('frames'), list):
                raise WorkflowError('output_invalid', 'Repair frame manifest must list its exact source frames')
            remaining = list(repair_sources)
            for frame in manifest['frames']:
                if not isinstance(frame, dict) or type(frame.get('assetFrame')) is not int or frame['assetFrame'] < 0:
                    raise WorkflowError('output_invalid', 'Repair source frame has no exact asset frame index')
                match = next((item for item in remaining if item['sha256'] == frame.get('sha256')
                              and item['producerOperationId'] == metadata['producerOperationId']), None)
                filename = f"repair-source-frames/asset-{frame['assetFrame']:06d}.jpg"
                if not match or filename in repair_frames:
                    raise WorkflowError('output_invalid', 'Repair source manifest differs from its registered image artifacts')
                remaining.remove(match)
                deliveries.append((filename, match))
                # The original manifest remains byte-for-byte intact. These
                # relative delivery entries make it usable without its local
                # attempt paths; images come only from registered artifacts.
                repair_frames[filename] = {key: frame[key] for key in ('assetFrame', 'sourceFrame', 'pts', 'timeBase', 'time') if key in frame}
                repair_frames[filename]['derivedFrom'] = 'repair-source-frames.json'
            if remaining:
                raise WorkflowError('output_invalid', 'A registered repair source image is missing from its frame manifest')
        for filename, metadata in deliveries:
            row = db.execute('SELECT path FROM artifacts WHERE run_id=? AND id=?', (run_id, metadata['artifactId'])).fetchone()
            if not row or file_digest(row['path']) != metadata['sha256']:
                raise WorkflowError('output_invalid', 'An accepted artifact failed its delivery integrity check')
            destination = target / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(row['path'], destination)
            if file_digest(destination) != metadata['sha256']:
                raise WorkflowError('output_invalid', 'Delivery copy failed its integrity check')
            files.append({'name': destination.relative_to(target).as_posix(), 'kind': metadata['kind'],
                          'sha256': metadata['sha256'], 'sizeBytes': metadata['sizeBytes'], **repair_frames.get(filename, {})})
    if (target / 'document.json').is_file():
        saved = json.loads((target / 'document.json').read_text(encoding='utf-8'))
        if isinstance(saved, dict) and isinstance(saved.get('document'), dict):
            native_path = target / 'native-document.json'
            native_path.write_text(json.dumps(saved['document'], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            files.append({'name': native_path.name, 'kind': 'native_document', 'sha256': file_digest(native_path),
                          'sizeBytes': native_path.stat().st_size, 'derivedFrom': 'document.json'})
    checks = []
    for filename in ('coverage.json', 'projection.json', 'independent-review.json', 'decode-report.json'):
        path = target / filename
        if path.is_file():
            report = json.loads(path.read_text(encoding='utf-8'))
            checks.append({'file': filename, 'sha256': file_digest(path), 'pass': report.get('pass'),
                           'candidateDigest': report.get('candidateDigest'), 'sourceRef': report.get('sourceRef'),
                           'analysisRevision': report.get('analysisRevision')})
    quality_path = target / 'quality-report.json'
    quality_path.write_text(json.dumps({'schemaVersion': '1.0', 'runId': run_id, 'status': result['status'],
        'checks': checks, 'unmetRequirements': result['unmetRequirements'],
        'previews': [{'file': item['name'], 'sha256': item['sha256']} for item in files if item['kind'] == 'composite_preview']},
        ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    files.append({'name': quality_path.name, 'kind': 'quality_report', 'sha256': file_digest(quality_path), 'sizeBytes': quality_path.stat().st_size})
    (target / 'run.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    delivery = {'schemaVersion': '1.0', 'runId': run_id, 'status': result['status'],
                'documentFormats': {'document.json': 'saved version envelope containing document',
                                    'native-document.json': 'native editable document extracted from the saved envelope'},
                'unmetRequirements': result['unmetRequirements'], 'files': files}
    (target / 'delivery.json').write_text(json.dumps(delivery, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return delivery


def decoded_mapping(video):
    try:
        import av
    except ImportError as exc:
        raise WorkflowError('capability_unavailable', 'Asset registration requires PyAV in the selected runtime') from exc
    frames = []
    with av.open(str(video)) as container:
        for index, frame in enumerate(container.decode(video=0)):
            if frame.pts is None or frame.time_base is None:
                raise WorkflowError('source_mismatch', 'Decoded frame has no exact PTS')
            pts = float(frame.pts * frame.time_base)
            frames.append({'frame': index, 'time': pts, 'sourceFrame': index, 'sourceTime': pts})
    if not frames:
        raise WorkflowError('invalid_input', 'Video contains no decoded frames')
    return frames


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', default='artifacts/agent-workflows')
    parser.add_argument('--caller', default='local')
    parser.add_argument('--detector-python', help='Trusted local detector Python; alternatively AGENT_TACTICS_DETECTOR_PYTHON')
    parser.add_argument('--detector-weights', help='Trusted local weights; alternatively AGENT_TACTICS_DETECTOR_WEIGHTS')
    sub = parser.add_subparsers(dest='command', required=True)
    register = sub.add_parser('register', help='Trusted local asset registration; HTTP never accepts paths')
    register.add_argument('--asset-ref', required=True)
    register.add_argument('--video', required=True)
    register.add_argument('--metadata', help='Optional local JSON record including reviewed mapping/baselines')
    for command in ('submit', 'resume', 'cancel', 'call'):
        operation = sub.add_parser(command)
        operation.add_argument('--request', required=True, help='UTF-8 JSON file containing the canonical envelope')
        if command in ('submit', 'resume', 'call'):
            operation.add_argument('--enqueue-only', action='store_true')
        if command == 'call':
            operation.add_argument('--tool', required=True)
    for command in ('status', 'run', 'recover', 'import-diagnostics'):
        operation = sub.add_parser(command)
        operation.add_argument('run_id')
    repair = sub.add_parser('repair', help='One feedback pass in the same run, retaining spent total budgets')
    repair.add_argument('run_id')
    repair.add_argument('--recover-diagnostics', action='store_true', help='Trusted import from the DB-selected legacy failed preview attempt')
    repair.add_argument('--enqueue-only', action='store_true')
    export = sub.add_parser('export', help='Copy accepted delivery or a clearly unaccepted failure package into a new folder')
    export.add_argument('run_id')
    export.add_argument('--output', required=True)
    serve = sub.add_parser('serve', help='Bearer-authenticated thin HTTP API; credentials from environment')
    serve.add_argument('--host', default='127.0.0.1')
    serve.add_argument('--port', type=int, default=8896)
    args = parser.parse_args(argv)
    store = WorkflowStore(args.store)
    runner = WorkflowRunner(store, production_handlers(detector_python=args.detector_python, detector_weights=args.detector_weights))
    try:
        if args.command == 'register':
            record = json.loads(Path(args.metadata).read_text(encoding='utf-8-sig')) if args.metadata else {}
            record['videoPath'] = str(Path(args.video).resolve())
            actual_mapping = decoded_mapping(args.video)
            if 'sourceFrameMapping' in record:
                supplied = record['sourceFrameMapping']
                if len(supplied) != len(actual_mapping) or any(float(f.get('time', f.get('pts', -1))) != actual_mapping[i]['time'] for i, f in enumerate(supplied)):
                    raise WorkflowError('source_mismatch', 'Supplied asset PTS differ from exact decoding')
            else:
                record['sourceFrameMapping'] = actual_mapping
            result = store.register_asset(args.caller, args.asset_ref, record)
        elif args.command == 'serve':
            from agent_workflow_http import serve
            serve(runner, args.host, args.port)
            return 0
        elif args.command == 'export':
            result = export_delivery(runner, args.caller, args.run_id, args.output)
        elif args.command == 'import-diagnostics':
            result = runner.import_diagnostics(args.caller, args.run_id)
        elif args.command == 'repair':
            result = runner.repair(args.caller, args.run_id, recover_diagnostics=args.recover_diagnostics)
            if not args.enqueue_only:
                result = runner.run(args.caller, args.run_id)
        elif args.command in {'status', 'run', 'recover'}:
            if args.command == 'run':
                result = runner.run(args.caller, args.run_id)
            else:
                store.recover(args.caller, args.run_id)
                result = runner.call('get_run', args.caller, {'schemaVersion': '1.0', 'requestId': new_id('request'), 'runId': args.run_id, 'args': {}})
        else:
            request = json.loads(Path(args.request).read_text(encoding='utf-8-sig'))
            tool = args.tool if args.command == 'call' else {'submit': 'submit_workflow', 'resume': 'resume_run', 'cancel': 'cancel_run'}[args.command]
            result = runner.call(tool, args.caller, request)
            if args.command in {'submit', 'resume'} and not args.enqueue_only:
                result = runner.run(args.caller, result['runId'])
            elif args.command == 'call' and not args.enqueue_only and result.get('operationId'):
                disposition = runner.execute_operation(args.caller, result['runId'], result['operationId'])
                result = runner.run(args.caller, result['runId']) if disposition == 'repair_scheduled' else runner.response(
                    args.caller, result['runId'], request['requestId'], result['operationId'])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if args.command in {'export', 'import-diagnostics'} or result.get('status') not in {'failed', 'needs_attention', 'cancelled'} else 2
    except (WorkflowError, json.JSONDecodeError) as exc:
        error = exc.as_dict() if isinstance(exc, WorkflowError) else WorkflowError('invalid_input', 'Request is not valid JSON').as_dict()
        print(canonical({'schemaVersion': '1.0', 'error': error}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
