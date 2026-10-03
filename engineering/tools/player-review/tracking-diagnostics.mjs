// Read evidence from the current frame without changing candidates or identity.
import {personProposals} from './tracking-display.mjs';

const finiteBox = box => Array.isArray(box) && box.length >= 4 &&
  box.slice(0, 4).every(Number.isFinite) && box[2] > box[0] && box[3] > box[1];
const identifier = value => value != null && Number.isInteger(Number(value)) && Number(value) > 0
  ? Number(value) : null;
const hasPosition = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const sameBox = (left, right) => finiteBox(left) && finiteBox(right) &&
  left.slice(0, 4).every((value, index) => Math.abs(value - right[index]) < .0001);
const unverified = '身份仍需逐帧人工核验；T 编号连续或改变，都不能单独证明是否为同一人。';
const partitions = ['tracks', 'pending_detections', 'suppressed_detections'];

export function detectionRecordEvidence(record, detectorEvidence = null) {
  const proposals = personProposals(record, {}, detectorEvidence);
  const counts = Object.fromEntries(partitions.map(name => [name, proposals.filter(item => item.sourcePartition === name).length]));
  const result = {candidateCount: proposals.length, trackedCount: counts.tracks,
    pendingCount: counts.pending_detections, suppressedCount: counts.suppressed_detections,
    detectedCount: proposals.filter(item => item.detectionObserved).length, complete: false};
  const declared = detectorEvidence?.schema_version === 1 && detectorEvidence.raw_coordinates === true &&
    detectorEvidence.partition_complete === true && Array.isArray(detectorEvidence.partitions) &&
    detectorEvidence.partitions.length === 3 && partitions.every(name => detectorEvidence.partitions.includes(name));
  if (!declared) return {...result, reason: '本版本未提供经校验的检测完整性声明，未保存的低分、过滤或抑制候选无法由现有记录还原。'};
  const rawCount = record?.raw_detection_count;
  const indices = record?.detection_indices;
  const validPartitions = partitions.every(name => {
    const rows = record?.[name] ?? (name === 'suppressed_detections' ? [] : null);
    return Array.isArray(rows) && rows.length === counts[name] && Array.isArray(indices?.[name]) && indices[name].length === rows.length;
  });
  const allIndices = validPartitions ? partitions.flatMap(name => indices[name]) : [];
  const complete = Number.isInteger(rawCount) && rawCount >= 0 && rawCount === result.candidateCount && validPartitions &&
    allIndices.every(index => Number.isInteger(index) && index >= 0 && index < rawCount) &&
    new Set(allIndices).size === rawCount &&
    (record.candidate_count == null || record.candidate_count === counts.tracks + counts.pending_detections) &&
    record.tracks.every((row, index) => record.track_evidence?.[row[4]]?.raw_detection_index === indices.tracks[index]);
  return {...result, complete, reason: complete
    ? '已核对当前检测输出的三个分区和源索引；完整性仅涵盖当前类别、分数阈值及 NMS 之后的输出。'
    : '当前帧分区、总数或源索引不符合检测完整性声明，暂按证据有限处理。'};
}

export function detectionFrameSummary(record, detectorEvidence = null) {
  if (!record || typeof record !== 'object') return {label: '当前帧检测证据不可用', detail: '尚无候选记录。',
    candidateCount: 0, trackedCount: 0, pendingCount: 0, suppressedCount: 0, detectedCount: 0, complete: false};
  const evidence = detectionRecordEvidence(record, detectorEvidence);
  const {candidateCount, trackedCount, pendingCount, suppressedCount, complete} = evidence;
  const detail = `已跟踪 ${trackedCount} · 未跟踪 ${pendingCount} · 已抑制 ${suppressedCount}。${evidence.reason}`;
  if (candidateCount === 0) return {...evidence,
    label: complete ? '当前检测输出无候选框' : '当前没有候选记录 · 检测证据有限',
    detail: `${detail}${complete ? '这不代表画面中没有球员，也不能单凭此认定模型错误。' : '没有候选记录不等于 YOLO 漏检。'}`};
  return {...evidence, label: `${complete ? '检测候选' : '现有候选记录'} ${candidateCount}${complete ? ' · 分区完整' : ' · 检测证据有限'}`,
    detail: `${detail}有框、关联 T 或计数完整，均不代表球员身份已经人工确认。`};
}

function roleConflict(record, trackId) {
  return Array.isArray(record.role_conflicts)
    ? record.role_conflicts.some(item => item?.trackIds?.some(value => identifier(value) === trackId))
    : Boolean(record.role_conflicts?.[trackId]);
}

function observationEvidence(record, trackId, preview, frameConfirmed = false, detectorEvidence = null) {
  const evidence = record.track_evidence?.[trackId];
  const index = evidence?.raw_detection_index;
  const hasIndex = Number.isInteger(index) && index >= 0;
  const hasDetection = hasIndex || (detectorEvidence?.schema_version === 1 && detectorEvidence.raw_coordinates === true);
  const source = {
    detection: '检测观测',
    low_confidence_continuation: '低分续接',
    full_body_detection_recovery: '完整人体检测框恢复',
  }[evidence?.source];
  let detail = hasIndex
    ? `本帧检测候选 #${index + 1} → 跟踪 T${trackId}${source ? `（${source}）` : ''}。检测候选序号只属于当前帧，不是球员身份编号。`
    : hasDetection ? `当前 T${trackId} 使用本帧检测框，但本帧候选源索引不可用。`
    : `当前 T${trackId} 有跟踪框；本版本未提供有效的逐框检测对应证据，无法进一步区分检测与跟踪环节。`;
  const nativeIndex = evidence?.native_detection_index;
  if (hasIndex && Number.isInteger(nativeIndex) && nativeIndex >= 0 && nativeIndex !== index) {
    detail += `原跟踪关联使用检测候选 #${nativeIndex + 1}，显示框经过候选替换。`;
  }
  const warnings = [];
  if (preview?.roleConflict || roleConflict(record, trackId)) warnings.push('人物角色冲突');
  if (evidence?.color_conflict) warnings.push('衣着颜色冲突');
  if (evidence?.identity_review_required) warnings.push('模型标记身份待核对');
  if (warnings.length) detail += `当前证据提示：${warnings.join('、')}；这些提示需要人工核对。`;
  const label = warnings.length ? '当前关联有风险提示 · 待复核'
    : hasDetection ? '有检测与跟踪观测 · 待复核' : '有跟踪框 · 检测证据有限';
  return {label: frameConfirmed ? `当前帧身份已人工确认${warnings.length ? ' · 模型仍有风险提示' : ''}` : label,
    detail: detail + (frameConfirmed ? '人工确认仅覆盖当前帧的身份，其他帧、脚点及球场位置仍需核对。' : unverified)};
}

export function trackingDiagnostic(record, point, previewProposal = null, detectorEvidence = null) {
  if (!record || typeof record !== 'object') return {
    label: '当前帧证据不可用',
    detail: '尚无当前帧候选记录，无法判断检测或跟踪状态。',
  };
  const preview = previewProposal && typeof previewProposal === 'object' ? previewProposal : null;
  const target = preview || point;
  const trackId = identifier(target?.trackId);
  const tracks = Array.isArray(record.tracks) ? record.tracks : [];
  const observed = trackId != null && tracks.some(row => finiteBox(row) && identifier(row[4]) === trackId);
  const frameConfirmed = !preview && point?.frameIdentityConfirmed === true;

  if (!preview && point?.reviewExcluded) return {
    label: '当前区间已取消关联',
    detail: '这是人工取消后的空白状态，不表示 YOLO 漏检或跟踪器失败。可重新选择该帧候选。',
  };
  if (!preview && (point?.source === 'conflict' || point?.identitySource === 'reassigned')) return {
    label: point.source === 'conflict' ? '球员归属冲突 · 待处理' : '当前轨迹已改归其他球员',
    detail: '这是审核中的球员与轨迹归属问题，不能据此认定 YOLO 或跟踪器出错。请核对同帧的球员关联。',
  };
  if (!preview && point?.source === 'out_of_view') return {
    label: '当前标记为出画',
    detail: '出画标记是当前审核状态；它本身不能证明检测或跟踪环节发生错误。',
  };
  if (!preview && ['interpolated', 'manual_path'].includes(point?.source)) return {
    label: '估计位置 · 待复核',
    detail: `${point.source === 'manual_path' ? '当前位置来自手绘路径' : '当前位置来自插值'}，不是当前帧的检测证据，不能用于判断 YOLO 是否检出了该球员。`,
  };
  if (!preview && point?.source === 'manual' && hasPosition(point)) {
    if (observed) {
      const result = observationEvidence(record, trackId, null, frameConfirmed, detectorEvidence);
      return {label: frameConfirmed ? '当前帧身份已人工确认 · 人工位置' : '人工位置 · 跟踪来源待复核', detail: '当前位置来自人工标点或修正。' + result.detail};
    }
    return {
      label: frameConfirmed ? '当前帧身份已人工确认 · 无跟踪观测' : '人工位置 · 当前无跟踪观测',
      detail: `${frameConfirmed ? '人工确认仅覆盖当前帧的身份。' : ''}当前位置来自人工标点${trackId == null ? '，未关联临时 T 编号' : `，当前 T${trackId} 没有观测`}。人工位置不等于模型检出结果，不能单凭此判断检测或跟踪是否出错。`,
    };
  }
  if (observed) return observationEvidence(record, trackId, preview, frameConfirmed, detectorEvidence);
  if (trackId != null) return {
    label: `T${trackId} 当前没有观测`,
    detail: '当前编号没有观测，可能涉及漏检、遮挡、过滤或跟踪中断，单凭此不能归因。请对照原图，必要时重新关联其他 T 编号。',
  };
  if (preview) {
    const candidates = personProposals(record, {}, detectorEvidence).filter(item => item.trackId == null && sameBox(item.box, preview.box));
    const candidate = preview.sourcePartition ? candidates.find(item => item.sourcePartition === preview.sourcePartition &&
      (preview.sourceIndex == null || item.sourceIndex === preview.sourceIndex)) : candidates[0];
    if (candidate) {
      const origin = candidate.detectionIndex == null ? '' : `本帧检测候选 #${candidate.detectionIndex + 1}；该序号不是球员身份编号。`;
      return candidate.suppressed ? {
        label: '有检测框 · 已被后处理抑制',
        detail: `${origin}检测产生了这个框，后处理将其放入抑制分区，未给它独立 T 编号。它可能是重复候选，是否对应真实球员仍需人工核对；查看或选择该框不会让它自动变成跟踪轨迹。`,
      } : {
        label: '有检测框 · 尚无跟踪编号',
        detail: `${origin}当前候选保存在本帧未关联检测结果中，检测已产生框，但尚未获得临时 T 编号。仅凭这一帧不能认定跟踪器匹配错误，球员身份仍待人工确认。`,
      };
    }
  }
  if (preview) return {
    label: '当前候选缺少来源证据',
    detail: '当前帧记录中没有与预览候选对应的跟踪框、未编号检测框或抑制框，暂不能判断它来自哪个环节。',
  };
  const summary = detectionFrameSummary(record, detectorEvidence);
  if (summary.candidateCount === 0 && summary.complete) return {label: summary.label, detail: summary.detail};
  return {
    label: '当前球员尚未关联观测',
    detail: `先选择当前画面的候选框查看检测与跟踪来源；未关联球员不等于 YOLO 漏检。${summary.candidateCount === 0 ? summary.reason : ''}`,
  };
}
