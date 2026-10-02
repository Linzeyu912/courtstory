"""Optional basketball constraints around the installed BoT-SORT hooks.

This does not modify Ultralytics or change detector/NMS thresholds. The runtime
must register this class explicitly for an optimized run.
"""
from collections import Counter
from types import SimpleNamespace

import numpy as np
from ultralytics.trackers.basetrack import TrackState
from ultralytics.trackers.bot_sort import BOTSORT, BOTrack
from ultralytics.trackers.utils import matching
from ultralytics.trackers.utils.stracks import parse_bboxes

from basketball_tracking import TorsoEvidence, box_overlap, teams_compatible, torso_evidence, postprocess_assignments


class BasketballTrack(BOTrack):
    def __init__(self, xywh, score, cls, feat=None, evidence=None, minimum=3):
        self.team_evidence = evidence or TorsoEvidence()
        self.team_votes = Counter()
        self.team_label = None
        self.team_minimum = minimum
        self.identity_review_required = False
        self.color_conflict = False
        super().__init__(xywh, score, cls, feat)
        if not self.team_evidence.appearance_safe:
            self.smooth_feat = None
        self._observe(self.team_evidence)

    def _observe(self, evidence):
        if evidence.template_safe and evidence.label and teams_compatible(self.team_label, evidence.label):
            self.team_votes["blue" if evidence.label in {"dark", "blue"} else evidence.label] += 1
            label, count = self.team_votes.most_common(1)[0]
            if self.team_label is None and count >= self.team_minimum:
                self.team_label = label
        self.team_evidence = evidence

    def update(self, new_track, frame_id):
        self._accept_observation(new_track)
        self.observation_kind = "full_body_detection_recovery" if getattr(new_track, "recovery_for_id", None) else "detection"
        super().update(new_track, frame_id)

    def re_activate(self, new_track, frame_id, new_id=False):
        self._accept_observation(new_track)
        super().re_activate(new_track, frame_id, new_id)

    def _accept_observation(self, detection):
        evidence = detection.team_evidence
        self.color_conflict = bool(self.team_label and evidence.reliable and
                                   not teams_compatible(self.team_label, evidence.label))
        if self.color_conflict:
            self.identity_review_required = True
            detection.curr_feat = None  # An unresolved opponent cannot poison appearance.
        elif evidence.template_safe and teams_compatible(self.team_label, evidence.label):
            self.identity_review_required = False
        if not evidence.appearance_safe:
            detection.curr_feat = None
        self._observe(evidence)


class BasketballBOTSORT(BOTSORT):
    """Reject clear opposing jerseys in both association stages and keep weak boxes.

    The color template is locked after repeated clear observations. Overlapping
    torsos and weak detections do not update appearance or color templates.
    Duplicate suppression requires a supported incumbent track and a weaker,
    nested, same-color detection without a separate previous track.
    """
    def __init__(self, args):
        super().__init__(args)
        self._image = None
        self._all_boxes = []
        self.suppressed_indices = []
        self.team_rejections = 0
        self.duplicate_events = []
        self._recovery_boxes = {}
        self._export_supported = []

    def update(self, results, img=None, feats=None, **kwargs):
        self._image = img
        self._all_boxes = results.xyxy
        self._recovery_boxes = {}
        previous_event_count = len(self.duplicate_events)
        self.suppressed_indices = self._duplicates(results, img) if getattr(self.args, "duplicate_filter", False) else []
        self.frame_duplicate_events = self.duplicate_events[previous_event_count:]
        if getattr(self.args, "association_core", "guarded") == "upstream":
            # Output-only policy: do not filter detections, change Kalman geometry,
            # or withhold features from the native ReID association.
            output = super().update(results, img, feats, **kwargs)
            for track in self.tracked_stracks:
                if track.frame_id != self.frame_id:
                    continue
                index = int(track.idx)
                observed = torso_evidence(img, results.xyxy[index], results.conf[index], self._all_boxes,
                                          getattr(self.args, "team_detection_min_conf", .15))
                if not hasattr(track, "team_votes"):
                    track.team_votes, track.team_label = Counter(), None
                    track.team_minimum = getattr(self.args, "team_min_observations", 3)
                    track.identity_review_required = False
                track.color_conflict = bool(track.team_label and observed.reliable and
                                            not teams_compatible(track.team_label, observed.label))
                if track.color_conflict:
                    track.identity_review_required = True
                elif observed.template_safe and teams_compatible(track.team_label, observed.label):
                    track.identity_review_required = False
                BasketballTrack._observe(track, observed)
            native = {int(row[-1]): int(row[4]) for row in output}
            exported, _, _ = postprocess_assignments(native, self.frame_duplicate_events)
            # The next output-only decision uses previous exported observations.
            # Otherwise a duplicate native track started in a repeated nested
            # box would falsely make the same physical observation ambiguous.
            self._export_supported = [SimpleNamespace(track_id=identity, xyxy=results.xyxy[index].copy(),
                is_activated=True, frame_id=self.frame_id) for index, identity in exported.items()]
            return output
        keep = np.ones(len(results), dtype=bool)
        keep[self.suppressed_indices] = False
        filtered = results[keep]
        filtered_feats = feats[keep] if feats is not None and len(feats) else feats
        output = super().update(filtered, img, filtered_feats, **kwargs)
        indices = np.flatnonzero(keep)
        # Return indices in the original detector set, including when suppressed.
        for track in self.tracked_stracks:
            if track.frame_id == self.frame_id:
                track.idx = int(indices[int(track.idx)])
        if len(output):
            output[:, -1] = indices[output[:, -1].astype(int)]
        return output

    def init_track(self, results, img=None):
        if getattr(self.args, "association_core", "guarded") == "upstream":
            return super().init_track(results, img)
        if not len(results):
            return []
        bboxes = parse_bboxes(results)
        features = [None] * len(results)
        if self.args.with_reid and self.encoder is not None and img is not None:
            features = self.encoder(img, bboxes)
        tracks = []
        for xywh, box, score, cls, feature in zip(bboxes, results.xyxy, results.conf, results.cls, features):
            track = BasketballTrack(xywh, score, cls, feature,
                                    torso_evidence(self._image, box, score, self._all_boxes,
                                                   getattr(self.args, "team_detection_min_conf", .15)),
                                    getattr(self.args, "team_min_observations", 3))
            track.recovery_for_id = self._recovery_boxes.get(tuple(box))
            tracks.append(track)
        return tracks

    def _gate(self, distances, tracks, detections):
        if not getattr(self.args, "team_gating", False) or getattr(self.args, "association_core", "guarded") == "upstream":
            return distances
        for i, track in enumerate(tracks):
            for j, detection in enumerate(detections):
                evidence = detection.team_evidence
                if track.team_label and evidence.reliable and not teams_compatible(evidence.label, track.team_label):
                    mode = getattr(self.args, "team_gating_mode", "hard")
                    if mode == "audit":
                        continue  # Preserve ReID continuity; expose matched conflicts for review.
                    disagree = False
                    a, b = track.smooth_feat, detection.curr_feat
                    if a is not None and b is not None:
                        divisor = np.linalg.norm(a) * np.linalg.norm(b)
                        disagree = divisor > 1e-8 and float(np.dot(a, b) / divisor) < .85
                    if mode == "hard" or (disagree and evidence.dominance >= .70):
                        if distances[i, j] < .99:
                            self.team_rejections += 1
                        distances[i, j] = 1.
                    elif distances[i, j] < .30:
                        # A small tie-break preserves strong ReID continuity.
                        # Actual conflicting matches remain explicitly unverified.
                        distances[i, j] += .02
        return distances

    def get_dists(self, tracks, detections):
        distances = super().get_dists(tracks, detections)
        for i, track in enumerate(tracks):
            for j, detection in enumerate(detections):
                if getattr(detection, "recovery_for_id", None) == track.track_id:
                    distances[i, j] = min(distances[i, j], .05)
        return self._gate(distances, tracks, detections)

    def _second_association(self, pool, unmatched, detections, activated, refind, lost):
        remaining = [pool[i] for i in unmatched if pool[i].state == TrackState.Tracked]
        if remaining and detections:
            distances = matching.iou_distance(remaining, detections)
            for i, track in enumerate(remaining):
                for j, detection in enumerate(detections):
                    if getattr(detection, "recovery_for_id", None) == track.track_id:
                        distances[i, j] = min(distances[i, j], .05)
            distances = self._gate(distances, remaining, detections)
            matches, unmatched, _ = matching.linear_assignment(distances, thresh=.5)
            self._apply_matches(matches, remaining, detections, activated, refind)
        else:
            unmatched = list(range(len(remaining)))
        for index in unmatched:
            track = remaining[index]
            track.mark_lost()
            lost.append(track)

    def _duplicates(self, results, image):
        prior = self._export_supported if getattr(self.args, "association_core", "guarded") == "upstream" else self.tracked_stracks
        supported = [track for track in prior
                     if track.is_activated and track.frame_id >= self.frame_id - 2]
        suppress = []
        scores, boxes = results.conf, results.xyxy
        for weak in range(len(results)):
            if scores[weak] > .45 or weak in suppress:
                continue
            for strong in range(len(results)):
                if strong in suppress or scores[strong] < .65 or scores[strong] - scores[weak] < .25:
                    continue
                iou, containment = box_overlap(boxes[weak], boxes[strong])
                if iou < .42 or containment < .75:
                    continue
                a = torso_evidence(image, boxes[strong], scores[strong])
                b = torso_evidence(image, boxes[weak], scores[weak])
                incumbent = [track for track in supported if box_overlap(track.xyxy, boxes[strong])[0] > .45]
                if len(incumbent) != 1:
                    continue
                # A second prior track makes an overlap ambiguous, even for teammates.
                peers = [track for track in supported if track.track_id != incumbent[0].track_id
                         and box_overlap(track.xyxy, boxes[weak])[0] > .35]
                # A composite extra box can cover two known people. Suppress it
                # only when BOTH people already have separate stronger boxes;
                # this never removes the sole weaker box for a neighboring person.
                peers_represented = bool(peers) and all(any(
                    other != weak and scores[other] >= .65 and
                    box_overlap(peer.xyxy, boxes[other])[0] > .55
                    for other in range(len(results))) for peer in peers)
                same_color = a.reliable and b.reliable and a.label == b.label
                if (peers and not peers_represented) or (not same_color and not peers_represented):
                    continue
                def contains(outer, inner):
                    return (outer[0] <= inner[0] + 2 and outer[1] <= inner[1] + 2
                            and outer[2] >= inner[2] - 2 and outer[3] >= inner[3] - 2)
                fully_nested = containment >= .96 and (contains(boxes[weak], boxes[strong])
                                                       or contains(boxes[strong], boxes[weak]))
                if not fully_nested and not peers_represented:
                    # Equal-size nearby people can overlap heavily. Color and
                    # confidence alone do not make the new person a duplicate.
                    continue
                weak_height = boxes[weak][3] - boxes[weak][1]
                strong_height = boxes[strong][3] - boxes[strong][1]
                # Prefer an observed full-body box to a truncated upper-body box
                # when the same supported person is clear and nobody else overlaps.
                recovered_body = (same_color and not peers and containment > .9
                                  and weak_height > 1.5 * strong_height
                                  and abs(boxes[weak][1] - boxes[strong][1]) < .15 * weak_height
                                  and .75 < (boxes[weak][2] - boxes[weak][0]) / (boxes[strong][2] - boxes[strong][0]) < 1.4)
                removed_index, kept_index = (strong, weak) if recovered_body else (weak, strong)
                suppress.append(removed_index)
                if recovered_body:
                    self._recovery_boxes[tuple(boxes[weak])] = incumbent[0].track_id
                self.duplicate_events.append({"frame": self.frame_id, "raw_index": weak,
                                              "kept_index": kept_index, "suppressed_index": removed_index,
                                              "incumbent_track_id": incumbent[0].track_id,
                                              "reason": "full-body-recovery" if recovered_body else "supported-nested-same-color"})
                break
        return suppress
