"""Experimental, explicitly scene-configured player candidate filtering."""

import cv2
import numpy as np
import torch
from torchvision.ops import nms


def candidate_polygon(profile, frame_index):
    keyframes = profile["keyframes"]
    before = keyframes[0]
    for after in keyframes[1:]:
        if frame_index <= after["frame"]:
            fraction = np.clip((frame_index - before["frame"]) / (after["frame"] - before["frame"]), 0, 1)
            return (np.asarray(before["polygon"]) * (1 - fraction)
                    + np.asarray(after["polygon"]) * fraction).astype(np.float32)
        before = after
    return np.asarray(before["polygon"], dtype=np.float32)


def merge_detections(arrays):
    nonempty = [array for array in arrays if len(array)]
    if not nonempty:
        return np.empty((0, 6), dtype=np.float32)
    boxes = np.concatenate(nonempty).astype(np.float32)
    indices = nms(torch.from_numpy(boxes[:, :4]), torch.from_numpy(boxes[:, 4]), 0.55).numpy()
    chosen = []
    for box in boxes[indices]:
        # Reject smaller, almost-contained fragments of a stronger detection.
        area = (box[2] - box[0]) * (box[3] - box[1])
        duplicate = False
        for previous in chosen:
            previous_area = (previous[2] - previous[0]) * (previous[3] - previous[1])
            overlap = np.maximum(0, np.minimum(box[2:4], previous[2:4]) - np.maximum(box[:2], previous[:2])).prod()
            if area < 0.75 * previous_area and overlap / max(area, 1) > 0.85:
                duplicate = True
                break
        if not duplicate:
            chosen.append(box)
    return np.asarray(chosen, dtype=np.float32).reshape(-1, 6)


def detect_multiscale(model, frame, imgsz=1280):
    height, width = frame.shape[:2]
    regions = [(0, width), (0, round(width * 0.6)), (round(width * 0.4), width)]
    arrays = []
    for left, right in regions:
        crop = frame[:, left:right]
        result = model.predict(crop, device=0, half=True, classes=[0], conf=0.07,
                               imgsz=imgsz, verbose=False, save=False)[0]
        boxes = result.boxes.data.cpu().numpy().copy()
        if len(boxes):
            valid = np.ones(len(boxes), dtype=bool)
            if left > 0:
                valid &= boxes[:, 0] > 4
            if right < width:
                valid &= boxes[:, 2] < crop.shape[1] - 4
            boxes = boxes[valid]
            boxes[:, [0, 2]] += left
        arrays.append(boxes)
    return merge_detections(arrays)


def clothing_features(frame, box):
    x1, y1, x2, y2 = box[:4]
    width, height = x2 - x1, y2 - y1
    measurements = {}
    for name, top, bottom in (("torso", 0.18, 0.48), ("shorts", 0.46, 0.67)):
        left = max(0, round(x1 + 0.22 * width))
        right = min(frame.shape[1], round(x1 + 0.78 * width))
        upper = max(0, round(y1 + top * height))
        lower = min(frame.shape[0], round(y1 + bottom * height))
        region = frame[upper:lower, left:right]
        if region.size == 0:
            measurements.update({name + suffix: 0.0 for suffix in ("_yellow", "_white", "_dark")})
            continue
        hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
        hue, saturation, value = cv2.split(hsv)
        measurements[name + "_yellow"] = float(((hue >= 17) & (hue <= 39) & (saturation > 100) & (value > 90)).mean())
        measurements[name + "_white"] = float(((saturation < 65) & (value > 125)).mean())
        measurements[name + "_dark"] = float((value < 90).mean())
    return measurements


def filter_candidates(frame, boxes, polygon, profile):
    selected, observations = [], []
    for box in boxes:
        x1, y1, x2, y2, score, _ = [float(value) for value in box]
        width, height = x2 - x1, y2 - y1
        distance = cv2.pointPolygonTest(polygon, ((x1 + x2) / 2, y2), True)
        color = clothing_features(frame, box)
        reason, team = "accepted", None
        if distance < -profile["polygon_margin_pixels"]:
            reason = "outside_candidate_area"
        elif height < profile["min_height_intercept"] + profile["min_height_per_bottom_y"] * y2 or height / max(width, 1) < 1.05:
            reason = "partial_or_implausible_body"
        elif max(color["torso_yellow"], color["shorts_yellow"]) > 0.12:
            team = "yellow"
        elif color["torso_white"] > 0.20 and color["shorts_white"] > 0.18 and color["shorts_dark"] < 0.55:
            team = "white"
        else:
            reason = "clothing_not_supported"
        record = {"box": box.tolist(), "reason": reason, "team_hint": team,
                  "polygon_distance": distance, **color}
        observations.append(record)
        if reason == "accepted":
            selected.append(box)
    return np.asarray(selected, dtype=np.float32).reshape(-1, 6), observations


def draw_pending_candidates(canvas, candidates):
    """Show current detections without inventing a confirmed track identity."""
    color = (0, 195, 255)
    for box in candidates:
        x1, y1, x2, y2 = [round(float(value)) for value in box[:4]]
        for left, top, right, bottom in ((x1, y1, x2, y1), (x1, y2, x2, y2),
                                        (x1, y1, x1, y2), (x2, y1, x2, y2)):
            length = max(abs(right - left), abs(bottom - top))
            for position in range(0, length, 14):
                end = min(position + 8, length)
                start_point = (round(left + (right - left) * position / max(length, 1)),
                               round(top + (bottom - top) * position / max(length, 1)))
                end_point = (round(left + (right - left) * end / max(length, 1)),
                             round(top + (bottom - top) * end / max(length, 1)))
                cv2.line(canvas, start_point, end_point, color, 2, cv2.LINE_AA)
        cv2.putText(canvas, "ID pending", (x1, max(18, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA)
