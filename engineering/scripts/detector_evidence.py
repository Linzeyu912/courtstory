"""Validate the declared partition of post-NMS detector observations.

This contract covers configured person classes after detector confidence and
NMS filtering. It makes no claim about recall or detections before those filters.
"""

from copy import deepcopy


PARTITIONS = ('tracks', 'pending_detections', 'suppressed_detections')
SCOPE = 'post_nms_person_detections'


def _integer(value):
    return type(value) is int and value >= 0


def validate_frame_evidence(record, context, require_complete=False):
    raw_count = record.get('raw_detection_count')
    if 'raw_detection_count' in record and not _integer(raw_count):
        raise ValueError(f'{context}: raw_detection_count must be a nonnegative integer')
    evidence = record.get('track_evidence', {})
    if not isinstance(evidence, dict):
        raise ValueError(f'{context}: track_evidence must be an object')
    track_ids = {str(int(row[4])) for row in record.get('tracks', [])}
    raw_indices = []
    for track_id, item in evidence.items():
        if track_id not in track_ids or not isinstance(item, dict):
            raise ValueError(f'{context}: track evidence must refer to an observed track ID')
        for field in ('raw_detection_index', 'native_detection_index'):
            if field in item and (not _integer(item[field]) or raw_count is not None and item[field] >= raw_count):
                raise ValueError(f'{context}: {field} must index a raw detection')
        if 'raw_detection_index' in item:
            raw_indices.append(item['raw_detection_index'])
        if 'source' in item and (not isinstance(item['source'], str) or not item['source']):
            raise ValueError(f'{context}: evidence source must be nonempty text')
        if 'native_detection_confidence' in item and (type(item['native_detection_confidence']) not in (int, float)
                or not 0 <= item['native_detection_confidence'] <= 1):
            raise ValueError(f'{context}: native detection confidence must be in [0,1]')
        for field in ('color_conflict', 'identity_review_required', 'identity_verified'):
            if field in item and type(item[field]) is not bool:
                raise ValueError(f'{context}: {field} must be a boolean')
    if len(raw_indices) != len(set(raw_indices)):
        raise ValueError(f'{context}: two tracks cannot claim one raw detection index')
    indices = record.get('detection_indices')
    if indices is not None:
        if not isinstance(indices, dict) or set(indices) != set(PARTITIONS):
            raise ValueError(f'{context}: detection_indices must contain the three detector partitions')
        all_indices = []
        for field in PARTITIONS:
            values = indices[field]
            if (not isinstance(values, list) or len(values) != len(record.get(field, [])) or
                    any(not _integer(value) or raw_count is not None and value >= raw_count for value in values)):
                raise ValueError(f'{context}: {field} detection indices do not match their observations')
            all_indices.extend(values)
        if len(all_indices) != len(set(all_indices)):
            raise ValueError(f'{context}: detector partition indices overlap')
        for row, index in zip(record.get('tracks', []), indices['tracks']):
            item = evidence.get(str(int(row[4])), {})
            if item.get('raw_detection_index') != index:
                raise ValueError(f'{context}: tracked raw index does not match track_evidence')
    if require_complete:
        if (raw_count is None or indices is None or
                any(field not in record for field in PARTITIONS) or
                set(evidence) != track_ids):
            raise ValueError(f'{context}: complete detector evidence requires counts, all partitions and original indices')
        if (raw_count != sum(len(indices[field]) for field in PARTITIONS) or
                sorted(value for field in PARTITIONS for value in indices[field]) != list(range(raw_count))):
            raise ValueError(f'{context}: detector partitions do not cover every raw detection exactly once')
        if (not _integer(record.get('candidate_count')) or
                record['candidate_count'] != len(record['tracks']) + len(record['pending_detections'])):
            raise ValueError(f'{context}: candidate_count must exclude suppressed detections')


def evidence_counts(records):
    return {'frame_count': len(records),
            'raw_detection_count': sum(record['raw_detection_count'] for record in records),
            'tracked_detection_count': sum(len(record['tracks']) for record in records),
            'pending_detection_count': sum(len(record['pending_detections']) for record in records),
            'suppressed_detection_count': sum(len(record['suppressed_detections']) for record in records)}


def build_detector_evidence(records):
    """Declare completeness only for a producer that retained all raw indices."""
    for index, record in enumerate(records):
        validate_frame_evidence(record, f'Detector output frame {index}', require_complete=True)
    return {'schema_version': 1, 'raw_coordinates': True, 'partition_complete': True,
            'partitions': list(PARTITIONS), 'scope': SCOPE,
            'stage': 'after_confidence_and_nms_before_tracking', **evidence_counts(records)}


def detector_evidence_for_clip(records, metadata, context):
    """Derive an API declaration without altering historical data or fingerprints."""
    declaration = metadata.get('detector_evidence')
    unavailable = {'schema_version': 1, 'raw_coordinates': None, 'partition_complete': False,
                   'partitions': list(PARTITIONS), 'scope': SCOPE, 'status': 'unknown',
                   'reason': 'legacy_missing_completeness_declaration'}
    if declaration is None:
        return unavailable
    if (not isinstance(declaration, dict) or type(declaration.get('schema_version')) is not int or
            declaration['schema_version'] != 1 or declaration.get('partitions') != list(PARTITIONS) or
            declaration.get('scope') != SCOPE or type(declaration.get('raw_coordinates')) is not bool or
            type(declaration.get('partition_complete')) is not bool):
        raise ValueError(f'{context}: detector_evidence must use the supported version 1 partition schema')
    if not declaration['partition_complete']:
        return {**unavailable, 'raw_coordinates': declaration['raw_coordinates'], 'reason': 'producer_declares_partial'}
    if not declaration['raw_coordinates']:
        raise ValueError(f'{context}: complete detector evidence must preserve raw coordinates')
    for index, record in enumerate(records):
        validate_frame_evidence(record, f'{context}: frame {index}', require_complete=True)
    counts = evidence_counts(records)
    if any(not _integer(declaration.get(field)) or declaration[field] != count for field, count in counts.items()):
        raise ValueError(f'{context}: detector_evidence counts disagree with saved observations')
    return {**deepcopy(declaration), 'status': 'complete', 'validation': 'partition_indices_and_counts'}
