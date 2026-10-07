"""Versioned JSON contracts for the external tactics workflow.

The bundled validator intentionally implements only the JSON Schema keywords used
by these schemas. Unsupported keywords fail closed; this is not a general JSON
Schema implementation and does not add a dependency to the workbench runtime.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1] / 'agent-workflows' / 'tactics-v1'
SCHEMA_VERSION = '1.0'
WORKFLOW_VERSION = 'tactics-v1.0.0'


class WorkflowError(Exception):
    def __init__(self, reason_code, message, retryable=False, affected_ranges=None,
                 evidence_refs=None, suggested_action=None):
        super().__init__(message)
        self.reason_code = reason_code
        self.retryable = retryable
        self.affected_ranges = affected_ranges or []
        self.evidence_refs = evidence_refs or []
        self.suggested_action = suggested_action

    def as_dict(self):
        return {'reasonCode': self.reason_code, 'message': str(self), 'retryable': self.retryable,
                'affectedRanges': self.affected_ranges, 'evidenceRefs': self.evidence_refs,
                'suggestedAction': self.suggested_action}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def native_digest(value):
    """Use the existing JavaScript canonicalizer for native document bindings.

    Python and ECMAScript format finite doubles differently. In particular, a
    Python JSON digest is not the native sourceFrameMapping digest.
    """
    node = shutil.which('node')
    if not node:
        raise WorkflowError('capability_unavailable', 'Node is required to bind native frame mappings')
    module = Path(__file__).resolve().parents[1] / 'tools' / 'tactical-overlay' / 'binding.mjs'
    script = ("import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';"
              "const {canonicalJSON}=await import(process.argv[1]);"
              "process.stdout.write(createHash('sha256').update(canonicalJSON(JSON.parse(readFileSync(0,'utf8')))).digest('hex'));")
    result = subprocess.run([node, '--input-type=module', '-e', script, module.as_uri()],
                            input=canonical(value), text=True, encoding='utf-8', capture_output=True, timeout=30,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode or not re.fullmatch('[a-f0-9]{64}', result.stdout):
        raise WorkflowError('invalid_input', 'Native source canonicalization failed')
    return result.stdout


def business_digest(request):
    # Optimistic revision and correlation ID are transport acceptance fields.
    return digest({k: v for k, v in request.items() if k not in {'requestId', 'expectedRunRevision'}})


def obj(properties, required=()):
    return {'type': 'object', 'properties': properties, 'required': list(required), 'additionalProperties': False}


TEXT = {'type': 'string', 'minLength': 1, 'maxLength': 4096}
ID = {'type': 'string', 'minLength': 1, 'maxLength': 160, 'pattern': r'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'}
REF = ID
HASH = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}
NONNEG = {'type': 'integer', 'minimum': 0}
RANGE = obj({'startFrame': NONNEG, 'endFrameExclusive': {'type': 'integer', 'minimum': 1}}, ['startFrame', 'endFrameExclusive'])
FRAMES = {'type': 'array', 'items': NONNEG, 'minItems': 1, 'maxItems': 40, 'uniqueItems': True}
SOURCE = obj({'videoSha256': HASH, 'trackingFingerprint': {'type': ['string', 'null']},
              'trackingRevision': {'type': ['string', 'integer', 'null']}, 'frameMappingDigest': HASH,
              'snapshotId': ID}, ['videoSha256', 'trackingFingerprint', 'trackingRevision', 'frameMappingDigest', 'snapshotId'])
DOC = obj({'documentId': ID, 'version': NONNEG, 'digest': HASH, 'storeRef': REF}, ['documentId', 'version', 'digest', 'storeRef'])
NULL_DOC = {'anyOf': [DOC, {'type': 'null'}]}
REFS = {'type': 'array', 'items': REF, 'minItems': 1}
OUTPUT = obj({'video': {'type': 'boolean'}, 'editableDocument': {'type': 'boolean'}, 'fps': {'enum': [24, 25, 30, 60]},
              'audioPreservation': {'type': 'boolean'}}, ['video', 'editableDocument', 'fps'])


ARG_SCHEMAS = {
    'submit_workflow': obj({'assetRef': REF, 'goal': TEXT, 'profile': {'const': 'richer_players_v1'}, 'output': OUTPUT,
                            'geometryRequirement': {'enum': ['auto', 'required', 'none']}, 'allowPartial': {'type': 'boolean'},
                            'parentRunRef': REF}, ['assetRef', 'goal', 'profile', 'output', 'geometryRequirement', 'allowPartial']),
    'get_run': obj({'afterRevision': NONNEG}),
    'resume_run': obj({'retryStages': {'type': 'array', 'items': ID, 'uniqueItems': True}, 'reason': TEXT}, ['reason']),
    'cancel_run': obj({'reason': TEXT}, ['reason']),
    'inspect_clip': obj({'assetRef': REF, 'baseDocumentRef': NULL_DOC, 'evidenceFrames': FRAMES}, ['assetRef']),
    'prepare_players': obj({'snapshotRef': REF, 'range': RANGE, 'playerIds': {'type': 'array', 'items': ID, 'uniqueItems': True},
                             'refinementReason': TEXT, 'upstreamEvidenceRef': REF}, ['snapshotRef', 'range']),
    'prepare_geometry': obj({'snapshotRef': REF, 'range': RANGE, 'playerEvidenceRef': REF,
                              'requestedSpace': {'const': 'court_meters'}, 'courtTemplateRef': REF},
                             ['snapshotRef', 'range', 'playerEvidenceRef', 'requestedSpace', 'courtTemplateRef']),
    'analyze_play': obj({'snapshotRef': REF, 'playerEvidenceRef': REF, 'goal': TEXT, 'range': RANGE,
                          'frameRefs': REFS}, ['snapshotRef', 'playerEvidenceRef', 'goal', 'range']),
    'build_player_annotations': obj({'playAnalysisRef': REF, 'playerEvidenceRef': REF, 'calibrationRef': REF,
                                      'profile': {'const': 'richer_players_v1'}, 'baseDocumentRef': DOC},
                                     ['playAnalysisRef', 'playerEvidenceRef', 'profile', 'baseDocumentRef']),
    'check_participant_coverage': obj({'candidateRef': REF, 'participantInventoryRef': REF, 'playerEvidenceRef': REF,
                                       'renderPlanRef': REF}, ['candidateRef', 'participantInventoryRef', 'playerEvidenceRef', 'renderPlanRef']),
    'check_projection': obj({'candidateRef': REF, 'playerEvidenceRef': REF, 'calibrationRef': REF, 'renderPlanRef': REF},
                             ['candidateRef', 'playerEvidenceRef', 'renderPlanRef']),
    'preview_projection': obj({'candidateRef': REF, 'renderPlanRef': REF, 'frameSelection': FRAMES, 'qualityRefs': REFS},
                               ['candidateRef', 'renderPlanRef', 'frameSelection', 'qualityRefs']),
    'commit_candidate': obj({'candidateRef': REF, 'candidateDigest': HASH, 'baseDocumentRef': DOC, 'expectedVersion': NONNEG,
                              'qualityRefs': REFS, 'reviewRef': REF, 'acceptancePolicyRef': REF},
                             ['candidateRef', 'candidateDigest', 'baseDocumentRef', 'expectedVersion', 'qualityRefs', 'reviewRef', 'acceptancePolicyRef']),
    'render_projected_video': obj({'savedDocumentRef': DOC, 'savedDigest': HASH, 'fps': {'enum': [24, 25, 30, 60]},
                                    'renderPlanRef': REF}, ['savedDocumentRef', 'savedDigest', 'fps', 'renderPlanRef'])
}


def request_schema(name):
    fields = {'schemaVersion': {'const': SCHEMA_VERSION}, 'requestId': ID, 'args': ARG_SCHEMAS[name]}
    required = ['schemaVersion', 'requestId', 'args']
    if name != 'get_run':
        fields['idempotencyKey'] = ID
        required.append('idempotencyKey')
    if name != 'submit_workflow':
        fields['runId'] = ID
        required.append('runId')
    if name not in {'submit_workflow', 'get_run'}:
        fields['expectedRunRevision'] = NONNEG
        required.append('expectedRunRevision')
    if name not in {'get_run', 'resume_run', 'cancel_run'}:
        fields.update({'range': RANGE, 'policyRef': {'const': 'tactics-default-v1'}})
        required += ['range', 'policyRef']
    if name not in {'submit_workflow', 'get_run', 'resume_run', 'cancel_run', 'inspect_clip'}:
        fields.update({'sourceRef': SOURCE, 'docRef': NULL_DOC})
        required.append('sourceRef')
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': name + '.schema.json', **obj(fields, required)}


ARTIFACT_SCHEMA = obj({'artifactId': ID, 'kind': ID, 'sha256': HASH, 'sizeBytes': NONNEG, 'mediaType': TEXT,
                       'createdAt': TEXT, 'producerOperationId': ID},
                      ['artifactId', 'kind', 'sha256', 'sizeBytes', 'mediaType', 'createdAt', 'producerOperationId'])
ERROR_SCHEMA = obj({'reasonCode': ID, 'message': TEXT, 'retryable': {'type': 'boolean'},
                    'affectedRanges': {'type': 'array', 'items': RANGE}, 'evidenceRefs': {'type': 'array', 'items': REF},
                    'suggestedAction': {'type': ['string', 'null']}},
                   ['reasonCode', 'message', 'retryable', 'affectedRanges', 'evidenceRefs', 'suggestedAction'])
RESPONSE_SCHEMA = obj({'schemaVersion': {'const': SCHEMA_VERSION}, 'requestId': ID, 'runId': {'type': ['string', 'null']},
                       'runRevision': NONNEG, 'operationId': {'type': ['string', 'null']},
                       'status': {'enum': ['queued', 'running', 'succeeded', 'partial', 'needs_attention', 'failed', 'cancelled']},
                       'artifactRefs': {'type': 'array', 'items': ARTIFACT_SCHEMA},
                       'warnings': {'type': 'array', 'items': TEXT}, 'error': {'anyOf': [ERROR_SCHEMA, {'type': 'null'}]},
                       'generation': NONNEG, 'currentStage': {'type': ['string', 'null']},
                       'budget': obj({'modelCalls': NONNEG, 'trackingCalls': NONNEG, 'repairPasses': NONNEG,
                                      'costUsd': {'type': ['number', 'null'], 'minimum': 0},
                                      'wallSeconds': {'type': 'number', 'minimum': 0}}, ['modelCalls', 'trackingCalls', 'repairPasses', 'costUsd', 'wallSeconds']),
                       'unmetRequirements': {'type': 'array', 'items': TEXT}, 'nextActions': {'type': 'array', 'items': TEXT}},
                      ['schemaVersion', 'requestId', 'runId', 'runRevision', 'operationId', 'status', 'artifactRefs', 'warnings', 'error'])

KEYWORDS = {'$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties',
            'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'anyOf'}


def _validate(value, schema, path='$'):
    unsupported = set(schema) - KEYWORDS
    if unsupported:
        raise RuntimeError('Unsupported contract schema keywords: ' + ', '.join(sorted(unsupported)))
    if 'anyOf' in schema:
        for option in schema['anyOf']:
            try:
                _validate(value, option, path)
                break
            except WorkflowError:
                pass
        else:
            raise WorkflowError('invalid_input', path + ': no allowed shape matches')
    types = schema.get('type', [])
    types = [types] if isinstance(types, str) else types
    matches = {'null': value is None, 'boolean': type(value) is bool, 'integer': type(value) is int,
               'number': type(value) in (int, float) and math.isfinite(value), 'string': isinstance(value, str),
               'object': isinstance(value, dict), 'array': isinstance(value, list)}
    if types and not any(matches.get(t, False) for t in types):
        raise WorkflowError('invalid_input', path + ': incorrect type')
    # bool is not a numeric JSON enum/const value.
    equal = lambda a, b: type(a) is type(b) and a == b
    if 'const' in schema and not equal(value, schema['const']):
        raise WorkflowError('invalid_input', path + ': incorrect constant')
    if 'enum' in schema and not any(equal(value, item) for item in schema['enum']):
        raise WorkflowError('invalid_input', path + ': unsupported value')
    if isinstance(value, dict):
        missing = set(schema.get('required', [])) - set(value)
        unknown = set(value) - set(schema.get('properties', {}))
        if missing or (unknown and schema.get('additionalProperties') is False):
            raise WorkflowError('invalid_input', path + ': missing ' + ','.join(sorted(missing)) + '; unknown ' + ','.join(sorted(unknown)))
        for key, item in value.items():
            if key in schema.get('properties', {}):
                _validate(item, schema['properties'][key], path + '.' + key)
    elif isinstance(value, list):
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', float('inf')):
            raise WorkflowError('invalid_input', path + ': invalid array length')
        if schema.get('uniqueItems') and len({canonical(v) for v in value}) != len(value):
            raise WorkflowError('invalid_input', path + ': duplicates are not allowed')
        for index, item in enumerate(value):
            _validate(item, schema.get('items', {}), f'{path}[{index}]')
    elif isinstance(value, str):
        if len(value) < schema.get('minLength', 0) or len(value) > schema.get('maxLength', float('inf')):
            raise WorkflowError('invalid_input', path + ': invalid string length')
        if 'pattern' in schema and not re.search(schema['pattern'], value):
            raise WorkflowError('invalid_input', path + ': invalid identifier or digest')
    elif type(value) in (int, float):
        if not math.isfinite(value) or value < schema.get('minimum', -float('inf')) or value > schema.get('maximum', float('inf')):
            raise WorkflowError('invalid_input', path + ': invalid numeric value')
    if isinstance(value, dict) and set(value) >= {'startFrame', 'endFrameExclusive'}:
        if value['startFrame'] >= value['endFrameExclusive']:
            raise WorkflowError('invalid_input', path + ': range must be nonempty and half-open')


def validate_request(name, request):
    if name not in ARG_SCHEMAS:
        raise WorkflowError('capability_unavailable', 'Tool is not registered')
    if isinstance(request, dict) and request.get('schemaVersion') != SCHEMA_VERSION:
        raise WorkflowError('unsupported_schema', 'Only schemaVersion 1.0 is supported')
    _validate(request, request_schema(name))
    if 'range' in request.get('args', {}) and request['args']['range'] != request.get('range'):
        raise WorkflowError('invalid_input', 'Envelope and tool ranges must be identical')


def write_schemas():
    directory = ROOT / 'schemas'
    directory.mkdir(parents=True, exist_ok=True)
    schemas = {name: request_schema(name) for name in ARG_SCHEMAS}
    schemas.update({'response': RESPONSE_SCHEMA, 'artifact': ARTIFACT_SCHEMA, 'source-ref': SOURCE, 'document-ref': DOC})
    for name, schema in schemas.items():
        schema = {'$schema': 'https://json-schema.org/draft/2020-12/schema', **schema}
        (directory / (name + '.schema.json')).write_text(json.dumps(schema, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    write_schemas()
