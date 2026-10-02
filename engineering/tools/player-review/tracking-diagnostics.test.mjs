import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingDiagnostic,detectionRecordEvidence,detectionFrameSummary} from './tracking-diagnostics.mjs';
import {personProposals} from './tracking-display.mjs';

const box = [130, 235, 195, 439];
const record = {
  frame: 7, time: .333, tracks: [[...box, 12, .19, 2]], pending_detections: [],
  track_evidence: {12: {source: 'low_confidence_continuation', raw_detection_index: 4,
    native_detection_index: 4, native_detection_confidence: .19, identity_verified: false}},
};
const point = {source: 'tracked', trackId: 12, x: 162.5, y: 439,
  identitySource: 'manual_range', identityConfirmed: true};
const declaration={schema_version:1,raw_coordinates:true,partition_complete:true,
  partitions:['tracks','pending_detections','suppressed_detections']};
const completeFrame=()=>({tracks:[[...box,12,.19,2]],pending_detections:[[1,2,20,40,.12,2]],
  suppressed_detections:[[...box,.14,2]],candidate_count:2,raw_detection_count:3,
  detection_indices:{tracks:[1],pending_detections:[0],suppressed_detections:[2]},
  track_evidence:{12:{raw_detection_index:1,source:'low_confidence_continuation'}}});

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

test('frame summary counts every partition and only validated complete evidence supports an empty detector output',()=>{
  const record=completeFrame(),summary=detectionFrameSummary(record,declaration);
  assert.deepEqual([summary.candidateCount,summary.trackedCount,summary.pendingCount,summary.suppressedCount,summary.detectedCount], [3,1,1,1,3]);
  assert.equal(summary.complete,true);assert.match(summary.detail,/类别、分数阈值及 NMS 之后/);
  const empty={tracks:[],pending_detections:[],raw_detection_count:0,candidate_count:0,
    detection_indices:{tracks:[],pending_detections:[],suppressed_detections:[]}};
  assert.equal(detectionFrameSummary(empty,declaration).label,'当前检测输出无候选框');
  assert.match(detectionFrameSummary(empty,declaration).detail,/不能单凭此认定模型错误/);
  assert.equal(trackingDiagnostic(empty,null,null,declaration).label,'当前检测输出无候选框');
  assert.equal(detectionFrameSummary(empty).complete,false);
  assert.match(detectionFrameSummary(empty).label,/检测证据有限/);
  assert.match(detectionFrameSummary(empty).detail,/不等于 YOLO 漏检/);
});

test('legacy THY raw indices preserve observed boxes but never imply complete detector output',()=>{
  const summary=detectionFrameSummary({...record,suppressed_detections:[[...box,.1,2]],candidate_count:1});
  assert.equal(summary.complete,false);assert.equal(summary.detectedCount,2);
  assert.equal(summary.trackedCount,1);assert.equal(summary.suppressedCount,1);
  assert.match(summary.detail,/未提供经校验的检测完整性声明/);
});

test('bad counts, partitions, duplicate indices and mismatched track sources reject completeness',()=>{
  const mutations=[
    frame=>frame.raw_detection_count++,
    frame=>frame.candidate_count++,
    frame=>frame.detection_indices.suppressed_detections=[0],
    frame=>delete frame.detection_indices.pending_detections,
    frame=>frame.track_evidence[12].raw_detection_index=0,
    frame=>frame.pending_detections[0][4]=NaN,
  ];
  for(const mutate of mutations){const frame=completeFrame();mutate(frame);assert.equal(detectionRecordEvidence(frame,declaration).complete,false);}
  for(const invalid of [{...declaration,partition_complete:false},{...declaration,raw_coordinates:false},
    {...declaration,schema_version:2},{...declaration,partitions:['tracks','pending_detections']}]){
    assert.equal(detectionRecordEvidence(completeFrame(),invalid).complete,false);
  }
});

test('suppressed preview remains detector evidence even when its box exactly overlaps a tracked observation',()=>{
  const frame=completeFrame(),suppressed=personProposals(frame).find(p=>p.suppressed),before=structuredClone(frame);
  const diagnostic=trackingDiagnostic(frame,point,suppressed,declaration);
  assert.match(diagnostic.label,/有检测框.*已被后处理抑制/);
  assert.match(diagnostic.detail,/本帧检测候选 #3/);
  assert.match(diagnostic.detail,/未给它独立 T 编号/);
  assert.equal(suppressed.trackId,null);
  assert.deepEqual(frame,before);
  const stale={...suppressed,sourceIndex:5};
  assert.match(trackingDiagnostic(frame,point,stale,declaration).label,/缺少来源证据/);
});

test('only explicit frame confirmation distinguishes reviewed identity from propagated track association',()=>{
  assert.match(trackingDiagnostic(record,{...point,frameIdentityConfirmed:false}).label,/待复核/);
  assert.match(trackingDiagnostic(record,{...point,frameIdentityConfirmed:true}).label,/当前帧身份已人工确认/);
  assert.match(trackingDiagnostic(record,{...point,frameIdentityConfirmed:true}).detail,/仅覆盖当前帧/);
  const manual={source:'manual',trackId:null,x:20,y:30,frameIdentityConfirmed:true};
  assert.match(trackingDiagnostic({tracks:[]},manual).label,/已人工确认.*无跟踪观测/);
  assert.match(trackingDiagnostic(record,{...point,frameIdentityConfirmed:true},personProposals(record)[0]).label,/待复核/,
    'previewing a candidate must not inherit the selected player confirmation');
});
