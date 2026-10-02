"""Visible torso evidence and conservative offline track-segment suggestions.

Color labels describe the image only; they are not team names or player identities.
No position is interpolated or extrapolated by this module.
"""
from collections import defaultdict
from dataclasses import asdict, dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class TorsoEvidence:
    label: str | None = None
    reliable: bool = False
    template_safe: bool = False
    appearance_safe: bool = False
    dominance: float = 0.
    overlap: float = 0.
    reason: str = "unknown"

    def as_dict(self):
        return asdict(self)


def teams_compatible(a, b):
    """A blue jersey becoming brighter is not evidence of another team."""
    return not a or not b or a == b or {a, b} <= {"dark", "blue"}


def box_overlap(a, b):
    """Return IoU and intersection / smaller-box area for xyxy boxes."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    area_a = max(0., a[2] - a[0]) * max(0., a[3] - a[1])
    area_b = max(0., b[2] - b[0]) * max(0., b[3] - b[1])
    intersection = max(0., min(a[2], b[2]) - max(a[0], b[0])) * max(
        0., min(a[3], b[3]) - max(a[1], b[1]))
    return (intersection / max(1., area_a + area_b - intersection),
            intersection / max(1., min(area_a, area_b)))


def postprocess_assignments(native_assignment, events):
    """Export observed boxes without changing upstream association/Kalman inputs.

    Full-body recovery transfers an existing ID to a separately observed raw
    detection; its actual confidence remains the confidence of that raw box.
    """
    exported = dict(native_assignment)
    suppressed, sources = set(), {}
    for event in events:
        removed, kept = int(event["suppressed_index"]), int(event["kept_index"])
        if event["reason"] == "full-body-recovery":
            if removed not in exported:
                continue  # An unsupported partial box cannot confer an identity.
            identity = exported.pop(removed)
            exported[kept] = identity
            sources[identity] = {"native_index": removed, "exported_index": kept,
                                 "source": "full_body_detection_recovery"}
        else:
            exported.pop(removed, None)
        suppressed.add(removed)
    if len(set(exported.values())) != len(exported):
        raise ValueError("Postprocessing produced duplicate IDs within a frame.")
    return exported, suppressed, sources


def torso_evidence(image, xyxy, score, all_boxes=(), min_conf=.15):
    """Reject tiny/clipped/occluded/mixed crops before using color for association.

    The central upper torso avoids head, arms and shorts. Strong image evidence
    may reject a cross-color match at low confidence, but template/ReID updates
    require score >= .35 and a clear crop.
    """
    x1, y1, x2, y2 = map(float, xyxy)
    width, height = x2 - x1, y2 - y1
    if image is None or height < 40 or width < 14 or not .15 <= width / height <= .95:
        return TorsoEvidence(reason="small-or-implausible-box")
    if score < min_conf:
        return TorsoEvidence(reason="weak-detection")
    h, w = image.shape[:2]
    torso = [x1 + .26 * width, y1 + .23 * height,
             x1 + .74 * width, y1 + .53 * height]
    tx1, ty1, tx2, ty2 = map(int, torso)
    if tx1 < 1 or ty1 < 1 or tx2 >= w - 1 or ty2 >= h - 1:
        return TorsoEvidence(reason="clipped-torso")
    overlap = 0.
    torso_area = max(1., (torso[2] - torso[0]) * (torso[3] - torso[1]))
    for other in all_boxes:
        if np.max(np.abs(np.asarray(other[:4]) - np.asarray(xyxy[:4]))) < .01:
            continue
        ox1, oy1, ox2, oy2 = map(float, other[:4])
        intersection = max(0., min(torso[2], ox2) - max(torso[0], ox1)) * max(
            0., min(torso[3], oy2) - max(torso[1], oy1))
        overlap = max(overlap, intersection / torso_area)
    crop = image[ty1:ty2, tx1:tx2]
    if crop.size < 90:
        return TorsoEvidence(reason="small-torso")
    appearance_safe = bool(score >= .35 and overlap <= .15 and width / height <= .75)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).astype(float)
    hue, saturation, value = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    fractions = {
        "white": np.mean((saturation < 65) & (value > 170)),
        "dark": np.mean(value < 105),
        "yellow": np.mean((hue >= 18) & (hue <= 40) & (saturation > 110) & (value > 125)),
        "blue": np.mean((hue >= 85) & (hue <= 125) & (saturation > 100) & (value >= 105)),
        "red": np.mean(((hue < 9) | (hue > 168)) & (saturation > 110) & (value > 125)),
    }
    ordered = sorted(fractions, key=fractions.get, reverse=True)
    label, dominance = ordered[0], float(fractions[ordered[0]])
    margin = float(dominance - fractions[ordered[1]])
    strict = dominance >= .52 and margin >= .20
    chromatic_dark = float(np.mean((value < 105) & (saturation > 80) &
                                  ((hue >= 70) | (hue < 7))))
    if label == "dark" and (fractions["white"] >= .20 or chromatic_dark < .25):
        strict = False  # Neutral printed numbers cannot establish an opponent.
    # White jerseys include dark numbers and arms. With a strong detector and a
    # clear torso rectangle, that mixed image can reject a dark template without
    # becoming strong enough to update an appearance template.
    white_number = (score >= .65 and overlap <= .15 and fractions["white"] >= .34
                    and fractions["dark"] < .52)
    if white_number:
        label, dominance = "white", float(fractions["white"])
    # A box overlap does not necessarily occlude the foreground person's torso.
    # Only a very pure visible color may reject a match in this case; it still
    # cannot update templates or ReID appearance.
    foreground = strict and dominance >= .70
    if not (strict or white_number) or (overlap > .15 and not foreground):
        return TorsoEvidence(appearance_safe=appearance_safe,
                             dominance=round(dominance, 3), overlap=round(overlap, 3),
                             reason="torso-overlap" if overlap > .15 else "mixed-torso")
    return TorsoEvidence(label=label, reliable=True,
                         template_safe=bool(score >= .35 and overlap <= .15 and strict),
                         appearance_safe=appearance_safe,
                         dominance=round(dominance, 3), overlap=round(overlap, 3),
                         reason="clear-torso" if overlap <= .15 and strict else "rejection-only-torso")


def build_identity_suggestions(records, cuts=(), max_entities=10, track_summaries=None, max_gap_frames=10):
    """Seed aliases from one common frame, then link only unique short recoveries.

    A model fragment cannot consume a new person slot merely by being long. A
    proposed recovery needs matching clear color, native appearance, short time
    and small image displacement, with a unique match in both directions. This
    is still a suggestion: same-team similarity and occlusion remain unresolved.
    """
    observations = defaultdict(list)
    for record in records:
        for row in record["tracks"]:
            evidence = record.get("track_evidence", {}).get(str(int(row[4])), {})
            if evidence.get("identity_review_required"):
                continue
            observations[int(row[4])].append((int(record["frame"]), row))
    if not observations:
        return {"version": 1, "method": "conservative-common-frame-segments", "verified": False,
                "entities": [], "unassignedTrackIds": []}
    eligible_records = [{"frame": record["frame"], "tracks": [row for row in record["tracks"]
                         if not record.get("track_evidence", {}).get(str(int(row[4])), {}).get("identity_review_required")]}
                        for record in records]
    seed = max(eligible_records, key=lambda record: min(max_entities, len(record["tracks"])))
    selected = [int(row[4]) for row in sorted(seed["tracks"], key=lambda row: row[0])[:max_entities]]
    groups = [[track_id] for track_id in selected]
    unassigned = set(observations) - set(selected)
    summaries = {int(key): value for key, value in (track_summaries or {}).items()}
    links, cut_set = [], set(cuts)

    def possible_link(older, newer):
        end, old_box = observations[older][-1]
        start, new_box = observations[newer][0]
        gap = start - end - 1
        if not 0 <= gap <= max_gap_frames or any(end < cut <= start for cut in cut_set):
            return None
        old_summary, new_summary = summaries.get(older, {}), summaries.get(newer, {})
        label = old_summary.get("team_label")
        if not label or not new_summary.get("team_label") or not teams_compatible(label, new_summary.get("team_label")):
            return None
        old_feature, new_feature = old_summary.get("last_feature"), new_summary.get("first_feature")
        if not old_feature or not new_feature:
            return None
        if end - old_feature["frame"] > 5 or new_feature["frame"] - start > 5:
            return None
        a, b = np.asarray(old_feature["embedding"]), np.asarray(new_feature["embedding"])
        divisor = np.linalg.norm(a) * np.linalg.norm(b)
        if divisor < 1e-8:
            return None
        cosine = float(np.dot(a, b) / divisor)
        old_center = np.array([(old_box[0] + old_box[2]) / 2, (old_box[1] + old_box[3]) / 2])
        new_center = np.array([(new_box[0] + new_box[2]) / 2, (new_box[1] + new_box[3]) / 2])
        displacement = float(np.linalg.norm(new_center - old_center) / max(1., old_box[3] - old_box[1]))
        if cosine < .96 or displacement > .60:
            return None
        return {"fromTrackId": older, "toTrackId": newer, "gapFrames": gap,
                "cosine": round(cosine, 6), "normalizedDisplacement": round(displacement, 6),
                "cost": displacement + 2 * (1 - cosine) + gap / max(1, max_gap_frames) * .1}

    while unassigned:
        edges = []
        for group_index, group in enumerate(groups):
            group_frames = {frame for track_id in group for frame, _ in observations[track_id]}
            for candidate in unassigned:
                if any(frame in group_frames for frame, _ in observations[candidate]):
                    continue
                candidates = [edge for member in group for edge in
                              (possible_link(member, candidate), possible_link(candidate, member)) if edge]
                if candidates:
                    edges.append((group_index, candidate, min(candidates, key=lambda item: item["cost"])))
        accepted = []
        for group_index, candidate, edge in edges:
            competing_groups = sorted((item for item in edges if item[1] == candidate), key=lambda item: item[2]["cost"])
            competing_candidates = sorted((item for item in edges if item[0] == group_index), key=lambda item: item[2]["cost"])
            if competing_groups[0][0] != group_index or competing_candidates[0][1] != candidate:
                continue
            if any(len(items) > 1 and items[1][2]["cost"] - items[0][2]["cost"] < .15
                   for items in (competing_groups, competing_candidates)):
                continue
            accepted.append((group_index, candidate, edge))
        if not accepted:
            break
        for group_index, candidate, edge in accepted:
            groups[group_index].append(candidate)
            unassigned.remove(candidate)
            links.append({key: value for key, value in edge.items() if key != "cost"})

    entities = []
    for alias, group in enumerate(groups, 1):
        bindings = []
        observed_group = sorted((frame, track_id) for track_id in group for frame, _ in observations[track_id])
        for frame, track_id in observed_group:
            if not bindings or frame != bindings[-1]["end"] + 1 or frame in cut_set or track_id != bindings[-1]["trackId"]:
                bindings.append({"start": frame, "end": frame, "trackId": track_id})
            else:
                bindings[-1]["end"] = frame
        entities.append({"id": f"P{alias}", "bindings": bindings,
                         "reviewRequired": True, "source": "model_suggestion"})
    return {"version": 1, "method": "conservative-common-frame-segments", "verified": False,
            "entities": entities, "seedFrame": seed["frame"], "links": links,
            "unassignedTrackIds": sorted(unassigned)}
