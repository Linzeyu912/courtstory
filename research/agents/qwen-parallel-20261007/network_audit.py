"""Summarize network diagnostics for jobs named by a Qwen run manifest; never calls the API."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics
import uuid

ROOT = Path(__file__).resolve().parents[3]


def latest_manifest():
    base = ROOT/'artifacts/qwen-parallel-20261007/single-player-v1'
    paths = [base/f'official-training-{case}'/'run.json' for case in ('001', '002')]
    paths = [path for path in paths if path.is_file()]
    if not paths:
        raise FileNotFoundError('No official-training run.json manifest found.')
    return max(paths, key=lambda path: path.stat().st_mtime_ns)


def percentile(values, fraction):
    if not values:
        return None
    rows = sorted(values)
    return rows[max(0, math.ceil(fraction*len(rows))-1)]


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def summarize(manifest_path):
    data = json.loads(manifest_path.read_text(encoding='utf-8'))
    requested = data.get('requestedPlayerIds')
    requested = set(requested) if isinstance(requested, list) else None
    manifest_time = parse_time(data.get('createdAt'))
    candidates, jobs = [], []
    for player, record in data.get('players', {}).items():
        for job_id in record.get('jobs', []):
            # Manifest membership excludes cache/old job directories not used by this run.
            try:
                if str(uuid.UUID(job_id)) != job_id:
                    continue
            except (ValueError, TypeError, AttributeError):
                continue
            candidates.append((player, job_id))

    excluded = {'unrequestedPlayer': 0, 'olderThanRun': 0, 'missingCreatedAt': 0}
    for player, job_id in candidates:
        if requested is not None and player not in requested:
            excluded['unrequestedPlayer'] += 1
            continue
        directory = manifest_path.parent/'jobs'/job_id
        try:
            job = json.loads((directory/'job.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            job = {}
        job_time = parse_time(job.get('createdAt'))
        if job_time is not None and manifest_time is not None and job_time < manifest_time:
            excluded['olderThanRun'] += 1
            continue
        if requested is None and job_time is None:
            excluded['missingCreatedAt'] += 1
            continue
        jobs.append((player, job_id, job))

    attempts, audit_responses, job_statuses = [], [], {}
    missing_logs = []
    for player, job_id, job in jobs:
        directory = manifest_path.parent/'jobs'/job_id
        job_path, log_path = directory/'job.json', directory/'worker.stderr.log'
        if job_path.is_file():
            status = job.get('status', 'unreadable')
            job_statuses[status] = job_statuses.get(status, 0)+1
            for event in job.get('audit', []):
                if event.get('tool') == 'model_response':
                    audit_responses.append({'player': player, 'jobId': job_id,
                        'request': event.get('request'), 'stopReason': event.get('stopReason'),
                        'toolCalls': event.get('toolCalls', [])})
        else:
            job_statuses['missing_job_json'] = job_statuses.get('missing_job_json', 0)+1
        if not log_path.is_file():
            missing_logs.append(job_id)
            continue
        for line in log_path.read_text(encoding='utf-8', errors='replace').splitlines():
            try:
                item = json.loads(line)
            except ValueError:
                continue
            kind = item.get('type')
            if kind == 'qwen_request_headers':
                attempts.append({'player': player, 'jobId': job_id, 'kind': 'headers',
                    'status': item.get('status'), 'headersLatencyMs': item.get('elapsedMs'),
                    'bodyBytes': item.get('bodyBytes')})
            elif kind == 'qwen_connection_error':
                attempts.append({'player': player, 'jobId': job_id, 'kind': 'connection_error',
                    'totalElapsedMs': item.get('elapsedMs'), 'bodyBytes': item.get('bodyBytes'),
                    'causes': [{'name': cause.get('name'), 'code': cause.get('code')}
                               for cause in item.get('causes', []) if isinstance(cause, dict)]})

    statuses, causes = {}, {}
    for attempt in attempts:
        if attempt['kind'] == 'headers':
            key = str(attempt.get('status', 'unknown'))
            statuses[key] = statuses.get(key, 0)+1
        else:
            chain = attempt.get('causes', [])
            if chain:
                cause = chain[-1]
                key = cause.get('code') or cause.get('name') or 'unknown'
                causes[key] = causes.get(key, 0)+1
    header_times = [a['headersLatencyMs'] for a in attempts
                    if a['kind'] == 'headers' and isinstance(a.get('headersLatencyMs'), (int, float))]
    failure_times = [a['totalElapsedMs'] for a in attempts
                     if a['kind'] == 'connection_error' and isinstance(a.get('totalElapsedMs'), (int, float))]
    body_sizes = [a['bodyBytes'] for a in attempts if isinstance(a.get('bodyBytes'), (int, float))]
    return {
        'run': {'runId': data.get('runId'), 'status': data.get('status'),
                'createdAt': data.get('createdAt'), 'manifest': manifest_path.relative_to(ROOT).as_posix()},
        'jobs': {'manifestCandidates': len(candidates), 'includedThisRun': len(jobs),
                 'excluded': excluded, 'requestedPlayerIds': sorted(requested) if requested is not None else None,
                 'statuses': job_statuses, 'missingStderrLogs': missing_logs},
        'network': {'attempts': attempts, 'httpStatusCounts': statuses, 'connectionCauseCounts': causes,
            'headersLatencyMs': {'count': len(header_times), 'min': min(header_times) if header_times else None,
                'median': statistics.median(header_times) if header_times else None,
                'p95': percentile(header_times, .95), 'max': max(header_times) if header_times else None},
            'connectionFailureTotalElapsedMs': {'count': len(failure_times),
                'min': min(failure_times) if failure_times else None,
                'median': statistics.median(failure_times) if failure_times else None,
                'p95': percentile(failure_times, .95), 'max': max(failure_times) if failure_times else None},
            'requestBodyBytes': {'count': len(body_sizes), 'min': min(body_sizes) if body_sizes else None,
                'max': max(body_sizes) if body_sizes else None}},
        'audit': {'modelResponses': audit_responses},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', nargs='?', type=Path, help='Run manifest path; omit to use newest 001/002 run.json.')
    parser.add_argument('--output', type=Path, help='Output JSON path (default: ignored artifacts beside the manifest).')
    args = parser.parse_args()
    manifest = args.manifest or latest_manifest()
    if not manifest.is_absolute():
        manifest = ROOT/manifest
    manifest = manifest.resolve()
    result = summarize(manifest)
    output = args.output or (manifest.parent/f"network-audit-{result['run']['runId']}.json")
    if not output.is_absolute():
        output = ROOT/output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

    network = result['network']
    print(f"run {result['run']['runId']} ({result['run']['status']}): "
          f"{result['jobs']['includedThisRun']}/{result['jobs']['manifestCandidates']} jobs included; "
          f"excluded {result['jobs']['excluded']}; "
          f"HTTP {network['httpStatusCounts'] or 'none'}; "
          f"connection causes {network['connectionCauseCounts'] or 'none'}.")
    print(f"Header latency ms (fetch resolved at headers): {network['headersLatencyMs']}; "
          f"failed-attempt total elapsed ms: {network['connectionFailureTotalElapsedMs']}; "
          f"request body bytes: {network['requestBodyBytes']}. JSON: {output.relative_to(ROOT).as_posix()}")


if __name__ == '__main__':
    main()
