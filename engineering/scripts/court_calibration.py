"""Initialise reviewable NBA floor geometry using hoop-constrained keypoints.

The hoop supplies orientation evidence only. Every homography uses named floor
intersections; no result confirms ground contact or independent metric accuracy.
"""
import copy
import hashlib
import os
import time
from pathlib import Path

from scene_profiles import validate_court_candidates


DEFAULT_COURT_MODEL = 'tmp/court-models-v2/best.pt'
COURT_MODEL_SHA256 = '68e5faf5fb5388cf83477238abe22e9824a69fb33a4cf34f79ab61858f410064'


def file_sha256(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


class CourtModelUnavailable(RuntimeError):
    """The optional, local-only court model has not been prepared."""


class CourtKeypointModel:
    """Lazily load the pinned local model, without downloads or package installs."""
    def __init__(self, path=DEFAULT_COURT_MODEL, imgsz=640):
        self.path = Path(path)
        if imgsz not in (640, 960):
            raise ValueError('场地模型输入尺寸只支持 640 或 960。')
        self.imgsz = imgsz
        self.model = None
        self.device = None
        self.metadata = {'name': 'yolo11n-court48', 'sha256': COURT_MODEL_SHA256, 'inputSize': imgsz}

    def __call__(self, image):
        if self.model is None:
            if not self.path.is_file():
                raise CourtModelUnavailable('缺少本机场地模型，请按工程说明准备权重或使用 --court-model 指定路径。')
            if file_sha256(self.path) != COURT_MODEL_SHA256:
                raise CourtModelUnavailable('场地模型哈希与已核验的48点权重不符。')
            os.environ.update(TORCH_FORCE_WEIGHTS_ONLY_LOAD='1', YOLO_AUTOINSTALL='false',
                              YOLO_OFFLINE='true', YOLO_CONFIG_DIR=str(Path('tmp/vision-benchmark-settings').resolve()))
            try:
                import torch
                from ultralytics import YOLO
                from ultralytics.nn import modules
                from ultralytics.nn.modules import block
                from ultralytics.nn.tasks import PoseModel
            except ImportError as error:
                raise CourtModelUnavailable('当前环境缺少场地推理依赖，请使用已准备的视觉环境。') from error
            names = ['Bottleneck', 'SPPF', 'Conv', 'DWConv', 'DFL', 'C3k', 'C3k2',
                     'PSABlock', 'C2PSA', 'Attention', 'Pose', 'Concat']
            allowed = [PoseModel, *(getattr(modules, name) if hasattr(modules, name) else getattr(block, name) for name in names),
                       torch.nn.BatchNorm2d, torch.nn.MaxPool2d, torch.nn.Conv2d,
                       torch.nn.Upsample, torch.nn.Identity, torch.nn.Sequential,
                       torch.nn.ModuleList, torch.nn.SiLU]
            expected = {f'{item.__module__}.{item.__name__}' for item in allowed}
            unknown = set(torch.serialization.get_unsafe_globals_in_checkpoint(self.path)) - expected
            if unknown:
                raise CourtModelUnavailable('场地权重含未经核验的模型类型。')
            with torch.serialization.safe_globals(allowed):
                self.model = YOLO(str(self.path))
            self.device = 0 if torch.cuda.is_available() else 'cpu'
        import numpy as np
        result = self.model.predict(image, imgsz=self.imgsz, conf=.25, device=self.device,
                                    half=self.device == 0, verbose=False)[0]
        if result.keypoints is None or result.boxes is None or len(result.boxes) == 0:
            return np.zeros((48, 3), dtype=float)
        index = int(result.boxes.conf.argmax())
        return result.keypoints.data[index].cpu().numpy()


def object_source_payload(clip, variant):
    """Use registered E-BARD hoops even while reviewing the generic detector."""
    import json
    selected = json.loads(clip['payloads'][variant])
    if variant != 'ebard' and 'ebard' in clip['payloads']:
        return json.loads(clip['payloads']['ebard'])
    return selected


def calibrate_court(video, payload, frame, predictor, cuts=(), propagate=False,
                    object_payload=None, max_fallback_frames=12):
    """Return the existing courtCandidates schema; never write browser drafts."""
    try:
        import av
        from court_orientation import estimate_court
    except ImportError as error:
        raise CourtModelUnavailable('当前环境缺少视频或场地几何依赖，请使用已准备的视觉环境。') from error

    started = time.perf_counter()
    records = payload.get('frames')
    if payload.get('supportsCourtCalibration') is False:
        raise ValueError('该视频没有启用 NBA 球场标定。')
    if not isinstance(records, list) or type(frame) is not int or not 0 <= frame < len(records):
        raise ValueError('标定帧必须是当前视频内的整数帧号。')
    if type(propagate) is not bool:
        raise ValueError('propagate 必须为布尔值。')
    if not isinstance(cuts, (list, tuple)) or any(type(c) is not int or not 0 <= c <= len(records) for c in cuts):
        raise ValueError('切镜边界超出视频范围。')
    if type(max_fallback_frames) is not int or not 0 <= max_fallback_frames <= 120:
        raise ValueError('光流回退上限必须在0到120帧之间。')
    width, height = payload['width'], payload['height']
    objects_from = object_payload if object_payload is not None else payload
    object_records = objects_from.get('frames')
    if (objects_from.get('video_sha256') != payload.get('video_sha256') or
            objects_from.get('width') != width or objects_from.get('height') != height or
            not isinstance(object_records, list) or len(object_records) != len(records) or
            any(a.get('frame') != i or b.get('frame') != i or abs(a['time'] - b['time']) > .001
                for i, (a, b) in enumerate(zip(records, object_records)))):
        raise ValueError('篮筐检测与当前视频的哈希、尺寸、帧或时间不一致。')
    if file_sha256(video) != payload.get('video_sha256'):
        raise ValueError('视频已变化，请重新加载检测数据。')
    image = None
    with av.open(str(video)) as container:
        for index, picture in enumerate(container.decode(video=0)):
            if index == frame:
                if abs(float(picture.time) - records[frame]['time']) > .001:
                    raise ValueError('视频帧时间与检测记录不一致。')
                image = picture.to_ndarray(format='bgr24')
                break
    if image is None or image.shape[:2] != (height, width):
        raise ValueError('无法解码匹配的标定帧。')
    keypoints = predictor(image)
    estimate = estimate_court(keypoints, object_records[frame].get('objects', []), width, height)
    import cv2
    import numpy as np
    from court_propagation import LANDMARKS, LENGTH, project, refine_from_court_lines
    scale = min(1., 960/width)
    dimensions = (round(width*scale), round(height*scale))
    scaled = np.diag([scale, scale, 1.])
    inverse_scaled = np.linalg.inv(scaled)
    gray = cv2.cvtColor(cv2.resize(image, dimensions), cv2.COLOR_BGR2GRAY)
    h_scaled = scaled @ np.asarray(estimate['courtToImage'], np.float64).reshape(3, 3) if estimate['courtToImage'] else None
    line_fit = None
    if h_scaled is not None:
        refined, line_fit = refine_from_court_lines(gray, h_scaled, estimate['side'],
            records[frame]['tracks'], scale, estimate.get('points', []))
        if line_fit.get('refinementApplied'):
            h_full = inverse_scaled @ refined
            h_full /= h_full[2, 2]
            image_to_court = np.linalg.inv(h_full)
            image_to_court /= image_to_court[2, 2]
            estimate['courtToImage'] = h_full.reshape(-1).tolist()
            estimate['imageToCourt'] = image_to_court.reshape(-1).tolist()
            for point in estimate['points']:
                point['modelImage'] = list(point['image'])
                x, y = LANDMARKS[point['id']]
                if estimate['side'] == 'right':
                    x = LENGTH-x
                point['image'] = project(h_full, [(x, y)])[0].tolist()
    source_frame = records[frame].get('source_frame', frame)
    source_time = records[frame].get('source_time', records[frame]['time'])
    orientation = {**copy.deepcopy(estimate['orientation']), 'sourceFrame': source_frame, 'sourceTime': source_time,
                   'objectTrackingFingerprint': objects_from.get('tracking_fingerprint'),
                   'objectVariant': objects_from.get('variant'),
                   'coordinateConvention': 'same_sideline_broadcast_view', 'reviewRequired': True,
                   'courtLineFit': line_fit}
    initial = {'frame': frame, 'sourceFrame': source_frame, 'sourceTime': source_time,
               'side': estimate['side'], 'status': estimate['status'], 'reason': estimate.get('reason'),
               'orientation': orientation, 'model': copy.deepcopy(getattr(predictor, 'metadata', {}))}
    result = {'schemaVersion': 1, 'videoHash': payload['video_sha256'], 'template': 'NBA',
              'source': 'hoop_constrained_court48', 'label': '篮筐方向约束场地点 · 待复核',
              'referenceFrame': frame, 'keyframes': [], 'invalidFrames': [], 'maxKeyframeGapSeconds': 0,
              'reviewRequired': True, 'metricAccuracyValidated': False,
              'trackingFingerprint': payload.get('tracking_fingerprint'),
              'initialization': initial,
              'summary': {'startFrame': frame, 'endFrame': frame, 'validFrames': 0, 'totalFrames': 1},
              'notes': ['篮筐仅用于判断方向；透视计算只使用具名地面交点。',
                        '方向按同侧主转播视角解释；反向机位和镜像需人工核对。',
                        '场地点、脚地接触和米制位置仍需独立核验。']}
    if estimate['status'] == 'needs_review' and estimate['side'] in ('left', 'right'):
        seed = {'frame': frame, 'side': estimate['side'], 'points': estimate['points'],
                'source': 'hoop_constrained_court48', 'status': 'needs_review', 'reviewRequired': True,
                'courtToImage': estimate['courtToImage'], 'imageToCourt': estimate['imageToCourt'],
                'orientation': orientation,
                'quality': {'method': 'hoop_constrained_court48_point_line_fit', 'referenceFrame': frame,
                            'cameraSupportFrame': frame, 'courtLineFit': line_fit,
                            'projectedLines': line_fit, 'independentAccuracyValidated': False}}
        if propagate:
            from court_propagation import propagate_court
            propagated = propagate_court(video, payload, seed, cuts, max_fallback_frames=max_fallback_frames,
                predictor=predictor, object_records=object_records, unavailable_error=CourtModelUnavailable)
            result.update({key: propagated[key] for key in ('keyframes', 'invalidFrames', 'summary')})
            result['notes'].extend(propagated.get('notes', []))
            result['propagationSource'] = propagated['source']
        else:
            result['keyframes'] = [seed]
            result['summary']['validFrames'] = 1
    else:
        # A missing orientation cannot be expressed as a left/right keyframe.
        # Keep diagnostics separately, without inventing a side or calibration.
        result['unresolvedFrames'] = [frame]
    result['summary']['processingSeconds'] = time.perf_counter() - started
    validate_court_candidates(result, payload['video_sha256'], len(records))
    return result
