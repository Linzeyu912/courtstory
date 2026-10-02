"""Run basketball-specific player tracking on local media, preserving decoded PTS.

Example (repository root, optional GPU environment)::

    python engineering/scripts/basketball_run.py --variant optimized \
      --video data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4 \
      --weights tmp/player-identity-test/models/BODD_yolov8n_0001.pt \
      --output artifacts/player-tracking-workbench-20261002/optimized.json

The output is raw unverified candidates. Existing source video/audio are read only.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import statistics
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("YOLO_CONFIG_DIR", str(ROOT / "tmp/player-identity-test/yolo-config"))
os.environ.setdefault("TORCH_HOME", str(ROOT / "tmp/player-identity-test/torch-cache"))


def player_class_id(names):
    mapping = dict(enumerate(names)) if isinstance(names, list) else names
    matches = [int(key) for key, value in mapping.items() if str(value).strip().casefold() == "player"]
    if len(matches) != 1:
        raise ValueError(f"Expected one explicit basketball player class, found {mapping}")
    return matches[0]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_output_paths(source, weights, output):
    """Reject input aliases before inference, including the derived metadata path."""
    protected = {Path(source).resolve(), Path(weights).resolve()}
    for destination in (Path(output).resolve(), Path(output).with_suffix(".meta.json").resolve()):
        if destination in protected or (destination.exists() and any(
                item.exists() and os.path.samefile(destination, item) for item in protected)):
            raise ValueError(f"Output path aliases protected source/model input: {destination}")


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def run(args):
    # Path protection is independent of optional vision/GPU dependencies.
    validate_output_paths(args.video, args.weights, args.output)
    import av
    import numpy as np
    import torch
    import ultralytics
    from ultralytics import YOLO
    from ultralytics.nn.modules.head import Detect
    from ultralytics.trackers import track as tracker_registration
    from ultralytics.trackers.bot_sort import BOTSORT
    from ultralytics.utils import YAML

    from basketball_tracker import BasketballBOTSORT
    from basketball_tracking import build_identity_suggestions, torso_evidence, postprocess_assignments

    source, weights, output = args.video.resolve(), args.weights.resolve(), args.output.resolve()
    source_hash, weight_hash = sha256(source), sha256(weights)
    if not torch.cuda.is_available():
        raise RuntimeError("This measured runner requires a CUDA GPU; CPU fallback is disabled.")
    torch.cuda.set_device(0)
    torch.cuda.reset_peak_memory_stats(0)
    started = time.perf_counter()
    model = YOLO(str(weights))
    model.to("cuda:0")
    names = {int(key): str(value) for key, value in model.names.items()}
    player_class = player_class_id(names)
    reid = args.variant in {"reid", "optimized"}
    head = model.model.model[-1]
    if reid and not (isinstance(head, Detect) and not head.end2end):
        raise RuntimeError("Native detector features unavailable; no implicit extra model download is allowed.")
    config_name = "basketball-optimized.yaml" if args.variant == "optimized" else (
        "basketball-reid.yaml" if reid else "basketball-baseline.yaml")
    config_path = ROOT / "engineering/configs/tracking" / config_name
    configuration = YAML.load(str(config_path))
    detector_conf = .25 if args.variant == "baseline" else .10
    previous_botsort = tracker_registration.TRACKER_MAP["botsort"]
    tracker_registration.TRACKER_MAP["botsort"] = BasketballBOTSORT if args.variant == "optimized" else BOTSORT
    raw_holder = {}

    def retain_raw(predictor):
        result = predictor.results[0]
        raw_holder["boxes"] = result.boxes.data.detach().cpu().numpy().copy()
        raw_holder["native_features"] = getattr(result, "feats", None) is not None

    model.add_callback("on_predict_postprocess_end", retain_raw)
    records, pts_values, count_distribution, all_ids, track_summaries = [], [], [], set(), {}
    evidence_frames = set(args.evidence_frames)
    decode_infer_start = None
    try:
        with av.open(str(source)) as container:
            stream = container.streams.video[0]
            width, height = stream.codec_context.width, stream.codec_context.height
            fps = float(stream.average_rate) if stream.average_rate else None
            time_base = [stream.time_base.numerator, stream.time_base.denominator]
            audio = [{"codec": a.codec_context.name, "start_seconds": float(a.start_time * a.time_base)
                      if a.start_time is not None else None,
                      "duration_seconds": float(a.duration * a.time_base) if a.duration is not None else None}
                     for a in container.streams.audio]
            for frame_index, decoded in enumerate(container.decode(stream)):
                if decoded.pts is None:
                    raise RuntimeError("Decoded frame lacks source PTS; refusing to guess timing.")
                image = decoded.to_ndarray(format="bgr24")
                if decode_infer_start is None:
                    # Warm the exact detector settings before persistent tracking.
                    model.predict(image, device=0, quantize=16, imgsz=args.imgsz, conf=detector_conf,
                                  iou=.5, classes=[player_class], verbose=False)
                    model.predictor = None
                    torch.cuda.synchronize(0)
                    initialization_seconds = time.perf_counter() - started
                    decode_infer_start = time.perf_counter()
                raw_holder.clear()
                result = model.track(image, persist=True, tracker=str(config_path), classes=[player_class],
                                     device=0, quantize=16, imgsz=args.imgsz, conf=detector_conf, iou=.5,
                                     verbose=False)[0]
                devices = {str(parameter.device) for parameter in model.model.parameters()}
                if not devices or devices != {"cuda:0"}:
                    raise RuntimeError(f"Actual model device is not CUDA: {devices}")
                if reid and not raw_holder.get("native_features"):
                    raise RuntimeError("ReID requested but detector-native features were not delivered.")
                raw = raw_holder.get("boxes")
                if raw is None or raw.ndim != 2 or raw.shape[1] != 6:
                    raise RuntimeError("Raw pre-tracker detection callback did not provide six-column boxes.")
                tracker = model.predictor.trackers[0]
                ids = set(int(value) for value in result.boxes.id.tolist()) if result.boxes.id is not None else set()
                assignment, evidence, native_tracks = {}, {}, {}
                for track in tracker.tracked_stracks:
                    if int(track.track_id) not in ids:
                        continue
                    index, track_id = int(track.idx), int(track.track_id)
                    if not 0 <= index < len(raw) or index in assignment:
                        raise RuntimeError("Track index is invalid or one detection has multiple IDs.")
                    if abs(float(raw[index, 4]) - float(track.score)) > 1e-5 or int(raw[index, 5]) != int(track.cls):
                        raise RuntimeError("Track index does not match raw detection confidence/class.")
                    assignment[index] = track_id
                    native_tracks[track_id] = track
                if set(assignment.values()) != ids:
                    raise RuntimeError("Could not map all returned track IDs to original detection indices.")
                exported_sources = {}
                suppressed_indices = set(getattr(tracker, "suppressed_indices", []))
                if args.variant == "optimized" and configuration.get("association_core") == "upstream":
                    assignment, suppressed_indices, exported_sources = postprocess_assignments(
                        assignment, tracker.frame_duplicate_events)
                for index, track_id in assignment.items():
                    track = native_tracks[track_id]
                    observed = getattr(track, "team_evidence", None) or torso_evidence(
                        image, raw[index, :4], float(raw[index, 4]), raw[:, :4])
                    provenance = exported_sources.get(track_id)
                    if provenance:
                        observed = torso_evidence(image, raw[index, :4], float(raw[index, 4]),
                                                  [row[:4] for i, row in enumerate(raw) if i not in suppressed_indices])
                    evidence[str(track_id)] = {
                        "source": provenance["source"] if provenance else (
                            "low_confidence_continuation" if float(raw[index, 4]) < .25 else
                            getattr(track, "observation_kind", "detection")),
                        "raw_detection_index": index,
                        "native_detection_index": provenance["native_index"] if provenance else index,
                        "native_detection_confidence": float(raw[provenance["native_index"], 4]) if provenance else float(raw[index, 4]),
                        "team_label": getattr(track, "team_label", None), "torso": observed.as_dict(),
                        "color_conflict": getattr(track, "color_conflict", False),
                        "identity_review_required": getattr(track, "identity_review_required", False),
                        "identity_verified": False,
                    }
                    summary = track_summaries.setdefault(track_id, {"start": frame_index, "observed_frames": 0})
                    summary.update({"end": frame_index, "team_label": getattr(track, "team_label", None)})
                    summary["observed_frames"] += 1
                    feature = getattr(track, "curr_feat", None)
                    if not provenance and observed.appearance_safe and feature is not None and not getattr(track, "identity_review_required", False):
                        snapshot = {"frame": frame_index, "embedding": np.asarray(feature).astype(float).tolist()}
                        summary.setdefault("first_feature", snapshot)
                        summary["last_feature"] = snapshot
                tracks, pending, suppressed = [], [], []
                for index, row in enumerate(raw):
                    values = [round(float(v), 6) for v in row]
                    values[5] = int(row[5])
                    if int(row[5]) != player_class:
                        raise RuntimeError("Unexpected class in player-only inference output.")
                    if index in suppressed_indices:
                        suppressed.append(values)
                    elif index in assignment:
                        tracks.append([*values[:4], assignment[index], values[4], values[5]])
                    else:
                        pending.append(values)
                pts_seconds = float(decoded.pts * decoded.time_base)
                if pts_values and pts_seconds <= pts_values[-1]:
                    raise RuntimeError("Non-monotonic decoded video PTS.")
                pts_values.append(pts_seconds)
                record = {"frame": frame_index, "time": round(pts_seconds, 9),
                          "source_frame_pts": decoded.pts, "source_time_base": time_base,
                          "tracks": tracks, "pending_detections": pending,
                          "candidate_count": len(tracks) + len(pending), "track_evidence": evidence}
                if suppressed:
                    record["suppressed_detections"] = suppressed
                records.append(record)
                count_distribution.append(record["candidate_count"])
                all_ids.update(assignment.values())
                if frame_index in evidence_frames:
                    import cv2
                    from basketball_render import draw_candidates
                    directory = output.parent / "evidence" / output.stem
                    directory.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(directory / f"frame_{frame_index:06d}.jpg"),
                                draw_candidates(image, record, output.stem))
        torch.cuda.synchronize(0)
        loop_seconds = time.perf_counter() - decode_infer_start
        if not records:
            raise RuntimeError("No video frames decoded.")
        if sha256(source) != source_hash:
            raise RuntimeError("Source media changed during inference.")
        meta = {
            "version": 1, "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "variant": args.variant, "video": str(source.relative_to(ROOT)), "video_sha256": source_hash,
            "frames": len(records), "frame_count": len(records), "width": width, "height": height, "fps": fps,
            "frame_time_basis": "decoded_container_pts", "video_start_seconds": pts_values[0],
            "decoded_pts_seconds": pts_values, "source_time_base": time_base, "source_audio": audio,
            "model": weights.name, "model_names": names, "player_class_id": player_class,
            "weights": str(weights.relative_to(ROOT)), "weights_sha256": weight_hash,
            "tracker": "BoT-SORT", "configuration_path": str(config_path.relative_to(ROOT)),
            "configuration_sha256": sha256(config_path), "config": configuration,
            "implementation_sha256": {name: sha256(Path(__file__).with_name(name))
                for name in ("basketball_run.py", "basketball_tracker.py", "basketball_tracking.py")},
            "detection": {"conf": detector_conf, "iou": .5, "imgsz": args.imgsz, "half_requested": True},
            "device": {"name": torch.cuda.get_device_name(0), "actual_model_parameter_device": "cuda:0",
                       "parameter_dtype": str(next(model.model.parameters()).dtype),
                       "torch_version": torch.__version__, "torch_cuda_version": torch.version.cuda,
                       "ultralytics_version": ultralytics.__version__, "pyav_version": av.__version__,
                       "native_reid_features_observed": reid,
                       "peak_allocated_bytes": torch.cuda.max_memory_allocated(0)},
            "timing_seconds": {"initialization_and_warmup": initialization_seconds,
                               "decode_infer_candidates_evidence": loop_seconds},
            "statistics": {"candidate_count_min_median_max": [min(count_distribution), statistics.median(count_distribution),
                                                               max(count_distribution)],
                           "candidate_count_distribution": dict(sorted(Counter(count_distribution).items())),
                           "unique_track_ids": sorted(all_ids),
                           "pending_detections": sum(len(r["pending_detections"]) for r in records),
                           "low_confidence_continuations": sum(row[5] < .25 for r in records for row in r["tracks"]),
                           "suppressed_detections": sum(len(r.get("suppressed_detections", [])) for r in records),
                           "team_gate_rejections": getattr(tracker, "team_rejections", 0)},
            "identity_verified": False, "metric_accuracy_validated": False,
            "limitations": ["Candidate counts and track counts are not ground-truth accuracy.",
                            "Torso colors and detector ReID cannot establish same-team player identity.",
                            "No hidden positions are filled; gaps and out-of-view frames have no coordinates.",
                            "Weight training provenance beyond the recorded source card and SHA is not independently verified."],
        }
        if args.variant == "optimized":
            meta["basketball_policy"] = {"association_core": configuration.get("association_core", "guarded"),
                                         "native_tracker_features_modified": configuration.get("association_core") != "upstream",
                                         "team_gating": configuration.get("association_core") != "upstream",
                                         "color_conflict_review_flags": True,
                                         "proposal_feature_snapshot_min_conf": .35,
                                         "duplicate_processing": "export_only" if configuration.get("association_core") == "upstream" else "pre_association",
                                         "torso_overlap_limit": .15, "team_min_observations": 3,
                                         "pure_foreground_rejection_min_dominance": .70,
                                         "white_with_number_rejection_min_fraction": .34,
                                         "white_with_number_rejection_min_detector_conf": .65,
                                         "chromatic_dark_min_fraction": .25,
                                         "team_gating_mode": configuration.get("team_gating_mode", "hard"),
                                         "dark_and_blue_compatible": True,
                                         "duplicate_filter": True}
            meta["track_summaries"] = track_summaries
            meta["identitySuggestions"] = build_identity_suggestions(
                records, track_summaries=track_summaries, max_gap_frames=max(1, round((fps or 25) * 1.2)))
            meta["alias_definition"] = "Tentative common-frame seeds with conservative fragment suggestions; unresolved tracks are unassigned."
            meta["statistics"]["relinked_track_fragments"] = len(meta["identitySuggestions"]["links"])
            meta["duplicate_events"] = getattr(tracker, "duplicate_events", [])
        save_json(output, records)
        save_json(output.with_suffix(".meta.json"), meta)
        print(json.dumps({"output": str(output), "frames": len(records),
                          "statistics": meta["statistics"], "device": meta["device"]["name"],
                          "seconds": loop_seconds}, ensure_ascii=False))
    finally:
        tracker_registration.TRACKER_MAP["botsort"] = previous_botsort


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--variant", choices=["baseline", "low", "reid", "optimized"], default="optimized")
    parser.add_argument("--imgsz", type=int, default=704)
    parser.add_argument("--evidence-frames", type=int, nargs="*", default=[0, 53, 100, 106, 159, 212, 266])
    run(parser.parse_args())


if __name__ == "__main__":
    main()
