"""Strict, local provenance checks for the one-pass visual-review repair path."""
import json
import math
from pathlib import Path

from agent_workflow_contract import WorkflowError, native_digest
from agent_workflow_store import file_digest

REVIEW_METHOD = 'separate_provider_call_with_source_and_production_composites'
CHECKS = {'participantCoverage', 'correctPeople', 'positions', 'observedActionsOnly', 'readability', 'semantics'}


def read_ref(ref, root):
    if not isinstance(ref, dict) or not isinstance(ref.get('path'), str) or not isinstance(ref.get('sha256'), str):
        raise WorkflowError('source_mismatch', 'Feedback requires a server-produced SHA-bound reference')
    path = Path(ref['path']).resolve()
    if not path.is_relative_to(Path(root).resolve()) or not path.is_file() or file_digest(path) != ref['sha256']:
        raise WorkflowError('source_mismatch', 'Feedback reference is outside this run or changed')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, UnicodeDecodeError) as exc:
        raise WorkflowError('output_invalid', 'Feedback reference must contain valid JSON') from exc


def validate_feedback(run, operation, result, successful, run_root):
    """Return a feedback envelope only for a localized, single-phase failure.

    This deliberately excludes machine-check failures and multi-phase analysis:
    neither authorizes regenerating unaffected analysis or downgrading evidence.
    """
    if operation['stage'] != 'preview_projection' or operation['generation'] != run['generation']:
        raise WorkflowError('stale_generation', 'Only the current independent visual review can supply feedback')
    outputs = result.get('outputs', {})
    report = read_ref(outputs.get('reviewRef'), run_root)
    if not isinstance(report, dict):
        raise WorkflowError('output_invalid', 'Independent review must be an object')
    if report != outputs.get('independentReview'):
        raise WorkflowError('source_mismatch', 'Stored review and review reference differ')
    if (report.get('pass') is not False or report.get('verdict') != 'fail' or report.get('independent') is not True
            or report.get('reviewMethod') != REVIEW_METHOD or report.get('producerOperationId') != operation['id']):
        raise WorkflowError('capability_unavailable', 'Feedback requires a failed independent provider review')
    checks = report.get('checks', {})
    if not isinstance(checks, dict) or set(checks) != CHECKS or any(type(v) is not bool for v in checks.values()) or all(checks.values()):
        raise WorkflowError('capability_unavailable', 'Review does not contain a structured repairable defect')
    if checks['correctPeople'] is not True:
        raise WorkflowError('identity_conflict', 'Identity rebinding requires explicit evidence repair, not whole-phase regeneration')
    analysis_op = successful.get('analyze_play')
    built_op = successful.get('build_player_annotations')
    if not analysis_op or not built_op:
        raise WorkflowError('source_mismatch', 'Feedback has no accepted analysis and candidate provenance')
    analysis_output, built = analysis_op['result']['outputs'], built_op['result']['outputs']
    analysis = read_ref(analysis_output.get('playAnalysisRef'), run_root)
    inventory = read_ref(analysis_output.get('participantInventoryRef'), run_root)
    if not isinstance(analysis, dict) or not isinstance(inventory, dict):
        raise WorkflowError('output_invalid', 'Frozen analysis and inventory must be objects')
    read_ref(built.get('candidateRef'), run_root)
    revision = analysis_output.get('analysisRevision')
    if type(revision) is not int or revision < 1 or any(value.get('analysisRevision') != revision for value in (analysis, inventory, built, report)):
        raise WorkflowError('version_conflict', 'Feedback analysis revisions do not match')
    if any(value.get('sourceRef') != run['source'] for value in (analysis, inventory, report)) or report.get('candidateDigest') != built.get('candidateDigest'):
        raise WorkflowError('source_mismatch', 'Feedback refers to another source or candidate')
    manifest = read_ref(outputs.get('previewManifestRef'), run_root)
    previews = outputs.get('previewRefs')
    if (not isinstance(manifest, dict) or not isinstance(previews, list) or not previews
            or any(not isinstance(p, dict) for p in previews) or manifest.get('previews') != previews
            or manifest.get('sourceRef') != run['source'] or manifest.get('candidateDigest') != built['candidateDigest']
            or manifest.get('reviewRef') != outputs['reviewRef'] or report.get('previewDigests') != [p.get('sha256') for p in previews]):
        raise WorkflowError('source_mismatch', 'Review preview manifest is not bound to the candidate')
    preview_frames = set()
    for preview in previews:
        path = Path(preview.get('path', '')).resolve()
        attempt = Path(run_root) / 'attempts' / operation['attempt']
        if not path.is_relative_to(attempt.resolve()) or not path.is_file() or file_digest(path) != preview.get('sha256'):
            raise WorkflowError('source_mismatch', 'Reviewed preview bytes changed or left their attempt')
        frame = preview.get('assetFrame')
        if type(frame) is not int:
            raise WorkflowError('output_invalid', 'Preview has no exact asset frame')
        preview_frames.add(frame)
    phases = analysis.get('phases', [])
    frozen = inventory.get('phases', [])
    if (not isinstance(phases, list) or not isinstance(frozen, list) or len(phases) != 1 or len(frozen) != 1
            or not isinstance(phases[0], dict) or not isinstance(frozen[0], dict) or not phases[0].get('id')
            or phases[0].get('range') != run['request']['range'] or analysis.get('range') != run['request']['range']
            or frozen[0].get('phaseId') != phases[0]['id'] or frozen[0].get('range') != phases[0]['range']
            or inventory.get('frozenBeforeGraphics') is not True):
        raise WorkflowError('capability_unavailable', 'Feedback repair supports only one explicitly affected full-range phase')
    phase_id, bounds = phases[0]['id'], phases[0]['range']
    inspect = successful.get('inspect_clip', {}).get('result', {}).get('outputs', {})
    snapshot = read_ref(inspect.get('snapshotRef'), run_root)
    mapping = snapshot.get('sourceFrameMapping', []) if isinstance(snapshot, dict) else []
    start, end = bounds['startFrame'], bounds['endFrameExclusive']
    if not isinstance(mapping, list) or len(mapping) < end or not isinstance(mapping[start], dict):
        raise WorkflowError('source_mismatch', 'Feedback scope requires the inspected exact frame clock')
    begin_time = mapping[start].get('time')
    end_time = mapping[end].get('time') if end < len(mapping) else snapshot.get('clip', {}).get('mediaEndTime')
    configured_maximum = run['policy'].get('maxRepairSeconds', 8)
    if type(configured_maximum) not in (int, float) or not math.isfinite(configured_maximum) or configured_maximum <= 0:
        raise WorkflowError('invalid_input', 'Feedback duration policy must be positive and finite')
    maximum = min(8, configured_maximum)
    if (type(begin_time) not in (int, float) or type(end_time) not in (int, float)
            or not math.isfinite(begin_time) or not math.isfinite(end_time) or end_time <= begin_time
            or end_time - begin_time > maximum):
        raise WorkflowError('capability_unavailable', 'Feedback repair is limited to an exactly timed phase of at most eight seconds')
    issues = report.get('issues')
    if not isinstance(issues, list) or not issues:
        raise WorkflowError('capability_unavailable', 'Unlocalized review failures cannot trigger automatic repair')
    for issue in issues:
        frames = issue.get('evidenceFrames') if isinstance(issue, dict) else None
        if (not isinstance(issue, dict) or issue.get('phaseId') != phase_id or not isinstance(issue.get('playerId'), str)
                or not issue['playerId'].strip() or not isinstance(issue.get('reason'), str) or not issue['reason'].strip()
                or not isinstance(frames, list) or not frames
                or any(type(f) is not int or f not in preview_frames or not bounds['startFrame'] <= f < bounds['endFrameExclusive'] for f in frames)):
            raise WorkflowError('capability_unavailable', 'Every feedback issue must identify the affected phase, person and reviewed frames')
    return {'schemaVersion': '1.0', 'repairPass': 1, 'reason': 'independent_review_feedback',
            'failedOperationId': operation['id'], 'reviewRef': outputs['reviewRef'], 'candidateRef': built['candidateRef'],
            'candidateDigest': built['candidateDigest'], 'sourceRef': run['source'], 'analysisRevision': revision,
            'priorAnalysisRef': analysis_output['playAnalysisRef'], 'priorInventoryRef': analysis_output['participantInventoryRef'],
            'failedPhaseIds': [phase_id], 'range': bounds, 'issues': issues,
            'unmetRequirements': report.get('unmetRequirements', [])}


def recover_preview_result(run_root, operation):
    """Read only DB-selected legacy attempt paths, never caller-supplied paths."""
    attempt = (Path(run_root) / 'attempts' / operation['attempt']).resolve()
    if not attempt.is_relative_to(Path(run_root).resolve()):
        raise WorkflowError('source_mismatch', 'Legacy attempt left its run directory')
    def ref(path):
        return {'path': str(path), 'sha256': file_digest(path)}
    try:
        report_path, manifest_path = attempt / 'independent-review.json', attempt / 'preview-manifest.json'
        report = read_ref(ref(report_path), attempt)
        manifest = read_ref(ref(manifest_path), attempt)
        # The structured provider response must agree with the finalized report.
        response_path = attempt / 'independent-review-model' / 'response.json'
        response = read_ref(ref(response_path), attempt)
        if any(report.get(key) != response.get(key) for key in ('verdict', 'checks', 'summary', 'issues', 'unmetRequirements')):
            raise WorkflowError('source_mismatch', 'Legacy provider response differs from its failed report')
        previews = manifest.get('previews', [])
        artifacts = [{'path': str(report_path), 'kind': 'independent_review'},
                     {'path': str(manifest_path), 'kind': 'preview_manifest'},
                     {'path': str(response_path), 'kind': 'model_response'}]
        artifacts += [{'path': p['path'], 'kind': 'composite_preview', 'mediaType': 'image/png'} for p in previews]
        return {'outputs': {'reviewRef': ref(report_path), 'previewManifestRef': ref(manifest_path),
                           'previewRefs': previews, 'pass': False, 'independentReview': report},
                'artifacts': artifacts, 'unmetRequirements': report.get('unmetRequirements', [])}
    except (OSError, KeyError) as exc:
        raise WorkflowError('output_invalid', 'Legacy preview diagnostics are incomplete') from exc


def validate_failed_diagnostics(run, operation, result, successful, run_root):
    """Diagnostics from an incomplete provider execution never grant acceptance."""
    if operation['stage'] != 'preview_projection' or operation['generation'] != run['generation'] or not operation['valid']:
        raise WorkflowError('stale_generation', 'Only the current preview attempt can register failed diagnostics')
    output = result.get('outputs', {}) if isinstance(result, dict) else {}
    if not isinstance(output, dict) or any(output.get(key) is not expected for key, expected in
            (('diagnosticOnly', True), ('executionAccepted', False), ('pass', False))):
        raise WorkflowError('output_invalid', 'Provider failure output must remain explicitly unaccepted')
    built = successful.get('build_player_annotations', {}).get('result', {}).get('outputs', {})
    analyzed = successful.get('analyze_play', {}).get('result', {}).get('outputs', {})
    candidate = read_ref(built.get('candidateRef'), run_root)
    analysis = read_ref(analyzed.get('playAnalysisRef'), run_root)
    revision = analyzed.get('analysisRevision')
    if (not isinstance(analysis, dict) or type(revision) is not int or revision < 1
            or analysis.get('analysisRevision') != revision or analysis.get('sourceRef') != run['source']
            or built.get('analysisRevision') != revision or native_digest(candidate) != built.get('candidateDigest')):
        raise WorkflowError('source_mismatch', 'Failed diagnostics require the unchanged candidate and analysis binding')
    attempt = (Path(run_root) / 'attempts' / operation['attempt']).resolve()
    reports = {}
    for key, kind in (('providerDiagnosticRef', 'provider_diagnostic'),
                      ('independentReviewDiagnosticRef', 'independent_review_diagnostic')):
        if key not in output and key == 'independentReviewDiagnosticRef':
            continue
        ref = output.get(key)
        report = read_ref(ref, attempt)
        if (not isinstance(report, dict) or report.get('sourceRef') != run['source']
                or report.get('candidateDigest') != built['candidateDigest'] or report.get('analysisRevision') != revision
                or report.get('producerOperationId') != operation['id'] or report.get('diagnosticOnly') is not True
                or report.get('executionAccepted') is not False or report.get('pass') is not False):
            raise WorkflowError('source_mismatch', 'Diagnostic report is not bound to this failed attempt')
        reports[str(Path(ref['path']).resolve())] = (kind, ref['sha256'])
    artifacts = result.get('artifacts', [])
    if not isinstance(artifacts, list) or not artifacts:
        raise WorkflowError('output_invalid', 'Failed diagnostics have no registerable reports')
    previews = output.get('previewRefs', [])
    if not isinstance(previews, list) or any(not isinstance(p, dict) for p in previews):
        raise WorkflowError('output_invalid', 'Diagnostic previews must be structured references')
    preview_hashes = []
    for preview in previews:
        path = Path(preview.get('path', '')).resolve()
        if not path.is_relative_to(attempt) or not path.is_file() or file_digest(path) != preview.get('sha256'):
            raise WorkflowError('source_mismatch', 'Diagnostic preview changed or left its producer attempt')
        preview_hashes.append(preview['sha256'])
    for key in ('providerDiagnosticRef', 'independentReviewDiagnosticRef'):
        if key in output and read_ref(output[key], attempt).get('previewDigests') != preview_hashes:
            raise WorkflowError('source_mismatch', 'Diagnostic report does not bind its preview bytes')
    seen = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict) or artifact.get('kind') not in {
                'provider_diagnostic', 'independent_review_diagnostic', 'composite_preview', 'preview_manifest'}:
            raise WorkflowError('output_invalid', 'Raw provider output is not an exportable failed diagnostic')
        path = Path(artifact.get('path', '')).resolve()
        if not path.is_relative_to(attempt) or not path.is_file():
            raise WorkflowError('source_mismatch', 'Diagnostic artifact must belong to its producer attempt')
        if artifact['kind'] in {'provider_diagnostic', 'independent_review_diagnostic'}:
            if reports.get(str(path)) != (artifact['kind'], file_digest(path)):
                raise WorkflowError('source_mismatch', 'Diagnostic artifact differs from its bound report')
            seen.add(str(path))
        elif artifact['kind'] == 'composite_preview' and file_digest(path) not in preview_hashes:
            raise WorkflowError('source_mismatch', 'Diagnostic artifact is not a bound preview')
        elif artifact['kind'] == 'preview_manifest':
            manifest = read_ref({'path': str(path), 'sha256': file_digest(path)}, attempt)
            if (not isinstance(manifest, dict) or manifest.get('sourceRef') != run['source']
                    or manifest.get('candidateDigest') != built['candidateDigest'] or manifest.get('previews') != previews):
                raise WorkflowError('source_mismatch', 'Diagnostic preview manifest has another source or candidate')
    if seen != set(reports):
        raise WorkflowError('output_invalid', 'A bound diagnostic report is missing from its registered artifacts')
