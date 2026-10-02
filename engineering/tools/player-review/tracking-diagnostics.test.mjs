import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingDiagnostic} from './tracking-diagnostics.mjs';

const box = [130, 235, 195, 439];
const record = {
  frame: 7, time: .333, tracks: [[...box, 12, .19, 2]], pending_detections: [],
  track_evidence: {12: {source: 'low_confidence_continuation', raw_detection_index: 4,
    native_detection_index: 4, native_detection_confidence: .19, identity_verified: false}},
};
const point = {source: 'tracked', trackId: 12, x: 162.5, y: 439,
  identitySource: 'manual_range', identityConfirmed: true};

test('THY evidence distinguishes this-frame detection indices from tracker IDs and audit status', () => {
  const result = trackingDiagnostic(record, point);
  assert.match(result.label, /有检测与跟踪观测.*待复核/);
  assert.match(result.detail, /检测候选 #5 → 跟踪 T12（低分续接）/);
  assert.match(result.detail, /只属于当前帧，不是球员身份编号/);
  assert.match(result.detail, /逐帧人工核验/);
  assert.match(result.detail, /编号连续或改变，都不能单独证明是否为同一人/);
});

test('native detection replacement and conflict evidence remain explicit and unverified', () => {
  const frame = structuredClone(record);
  Object.assign(frame.track_evidence[12], {source: 'full_body_detection_recovery',
    native_detection_index: 8, color_conflict: true, identity_review_required: true});
  frame.role_conflicts = [{trackIds: [12, 19]}];
  const result = trackingDiagnostic(frame, point);
  assert.match(result.label, /风险提示/);
  for (const detail of ['完整人体检测框恢复', '原跟踪关联使用检测候选 #9', '人物角色冲突', '衣着颜色冲突', '模型标记身份待核对']) {
    assert.ok(result.detail.includes(detail));
  }
  assert.match(result.detail, /需要人工核对/);
});

test('a tracked box in an old schema does not invent a detector observation', () => {
  const {track_evidence, ...legacy} = record;
  const result = trackingDiagnostic(legacy, point);
  assert.match(result.label, /检测证据有限/);
  assert.match(result.detail, /未提供有效的逐框检测对应证据/);
  assert.doesNotMatch(result.detail, /检测候选 #/);
  assert.match(result.detail, /逐帧人工核验/);
});

test('pending detection preview takes precedence over selected player and is checked against the frame', () => {
  const frame = {...record, pending_detections: [[10, 20, 50, 90, .8, 2]]};
  const result = trackingDiagnostic(frame, point, {trackId: null, box: [10, 20, 50, 90]});
  assert.match(result.label, /有检测框.*尚无跟踪编号/);
  assert.match(result.detail, /不能认定跟踪器匹配错误/);
  assert.doesNotMatch(result.detail, /T12/);
  assert.match(trackingDiagnostic(frame, point, {trackId: null, box}).label, /缺少来源证据/);
});

test('missing tracked observations do not conflate tracking gaps and missed detections', () => {
  const result = trackingDiagnostic({...record, tracks: []}, {...point, source: 'missing', x: null, y: null});
  assert.equal(result.label, 'T12 当前没有观测');
  for (const possibility of ['漏检', '遮挡', '过滤', '跟踪中断', '单凭此不能归因']) assert.ok(result.detail.includes(possibility));
  assert.doesNotMatch(result.detail, /检测候选 #/);
});

test('manual marks with no model evidence are distinct from detection failure', () => {
  const result = trackingDiagnostic({tracks: []}, {source: 'manual', trackId: null, x: 3, y: 6});
  assert.match(result.label, /人工位置/);
  assert.match(result.detail, /未关联临时 T 编号/);
  assert.match(result.detail, /人工位置不等于模型检出结果/);
  assert.match(trackingDiagnostic(record, {...point, source: 'manual'}).detail, /人工标点或修正/);
  assert.match(trackingDiagnostic({tracks: []}, {...point, source: 'manual'}).detail, /当前 T12 没有观测/);
});

test('estimation, unassignment, out-of-view and owner conflicts describe review states', () => {
  for (const source of ['interpolated', 'manual_path']) {
    assert.match(trackingDiagnostic(record, {...point, source}).label, /估计位置/);
  }
  assert.match(trackingDiagnostic(record, {...point, reviewExcluded: true}).label, /取消关联/);
  assert.match(trackingDiagnostic(record, {...point, source: 'out_of_view'}).label, /标记为出画/);
  assert.match(trackingDiagnostic(record, {...point, source: 'conflict'}).detail, /不能据此认定/);
  assert.match(trackingDiagnostic(record, {...point, identitySource: 'reassigned'}).label, /改归其他球员/);
});

test('empty or unavailable frames and absent targets do not imply a missed player', () => {
  assert.match(trackingDiagnostic(undefined, null).label, /证据不可用/);
  assert.match(trackingDiagnostic({}, null).label, /尚未关联观测/);
  assert.match(trackingDiagnostic({tracks: []}, {source: 'missing', trackId: null}).detail, /不等于 YOLO 漏检/);
  assert.match(trackingDiagnostic(record, null, {trackId: 999}).label, /T999 当前没有观测/);
});

test('diagnostics neither mutate input nor trust invalid raw detector indices', () => {
  const frame = structuredClone(record);
  frame.track_evidence[12].raw_detection_index = -1;
  const before = structuredClone({frame, point});
  assert.match(trackingDiagnostic(frame, point).label, /检测证据有限/);
  assert.deepEqual({frame, point}, before);
  frame.track_evidence[12].raw_detection_index = 0;
  assert.match(trackingDiagnostic(frame, point).detail, /检测候选 #1/);
});
