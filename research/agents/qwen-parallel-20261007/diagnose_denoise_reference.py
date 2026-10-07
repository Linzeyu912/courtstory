"""Compare denoising profiles against independent image-space contact references.

Example:
  python research/agents/qwen-parallel-20261007/diagnose_denoise_reference.py \
    --case 001 --source artifacts/qwen-parallel-20261007/single-player-v1 \
    --output artifacts/qwen-parallel-20261007/denoise-qa/001-current.json

Scores are paired on the same visible reference frames. The evaluator reports
AI visual-reference uncertainty and does not treat smoothness as accuracy.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "engineering" / "scripts"))
from ground_trajectory_denoise import denoise_player  # noqa: E402
from ground_trajectory_parallel import with_binding_boundaries  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate_reference import image_point, summary  # noqa: E402


PROFILES = ("conservative", "balanced", "strong")
TURN_MODES = ("adjacent", "macro")
CUSTOM_CONFIGS = {
    # Match the conservative-guarded export without changing production defaults.
    "candidate-0.08-0.25-0.6": {
        "window_seconds": 0.08, "outlier_min_distance": 1.8, "outlier_mad_scale": 5.0,
        "max_displacement": 0.25, "anchor_weight": 12.0, "robust_passes": 2,
        "turn_window_seconds": 0.08, "turn_min_displacement": 0.12,
        "turn_cosine_threshold": 0.6, "turn_window_scale": 0.45, "min_smoothing_points": 7,
    }
}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def classify_snapshot(run, merged):
    """Separate an incomplete candidate snapshot from terminal network failure."""
    run_status = run.get("status")
    if run_status == "running":
        return "transient", [], []
    failed_jobs = []
    for pid, player in merged.get("players", {}).items():
        for job in player.get("jobs", []):
            if job.get("status") == "failed":
                failed_jobs.append({"entityId": pid, "job": job})
    errors = run.get("errors", []) or []
    network_pattern = re.compile(r"timeout|timed out|connect|socket|network|econn|und_err|connection|dns|reset by peer")
    network_failures = failed_jobs if network_pattern.search(json.dumps(failed_jobs, ensure_ascii=False).lower()) else []
    has_network_error = bool(network_pattern.search(json.dumps(errors, ensure_ascii=False).lower()))
    if run_status == "partial" and (network_failures or has_network_error):
        return "network_partial", failed_jobs, errors
    if run_status == "partial":
        return "candidate_partial", failed_jobs, errors
    return "complete_snapshot", failed_jobs, errors


def xy(point):
    if not isinstance(point, dict):
        return None
    x, y = point.get("x"), point.get("y")
    if all(isinstance(n, (int, float)) and math.isfinite(n) for n in (x, y)):
        return float(x), float(y)
    return None


def speed(a, b, dt):
    return math.dist(a, b) / dt if a is not None and b is not None and dt > 0 else None


def angle_degrees(a, b):
    na, nb = math.hypot(*a), math.hypot(*b)
    if na < 1e-8 or nb < 1e-8:
        return None
    cosine = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (na * nb)))
    return math.degrees(math.acos(cosine))


def get_frame_point(points, frame):
    if frame < 0 or frame >= len(points):
        return None
    return xy(points[frame])


def summarize_config(sample_id, refs, frames_by_idx, raw_by_player, refined_by_player,
                     final_by_player, output_missing, input_missing):
    errors = {"raw": [], "refined": [], "final": []}
    paired_all = []
    missing_by_method = {m: 0 for m in errors}
    missing_references = {m: [] for m in errors}
    per_player = {}
    per_player_paired = {}
    large_errors = {m: [] for m in errors}
    for ref in refs:
        pid, idx = ref["entityId"], ref["frame"]
        frame_row = frames_by_idx.get(idx)
        mapping = frame_row.get("toImage") if frame_row else None
        expected = ref["imagePoint"]
        player_sets = {
            "raw": raw_by_player.get(pid),
            "refined": refined_by_player.get(pid),
            "final": final_by_player.get(pid),
        }
        row_err = {}
        for method, trajectories in player_sets.items():
            p = get_frame_point(trajectories or [], idx)
            projected = image_point(mapping, p) if p is not None else None
            if projected is None:
                missing_by_method[method] += 1
                missing_references[method].append({"frame": idx, "entityId": pid,
                                                   "reason": "missing player point or toImage mapping"})
                row_err[method] = None
                continue
            error = math.hypot(projected[0] - expected["x"], projected[1] - expected["y"])
            errors[method].append(error)
            row_err[method] = error
            player = per_player.setdefault(pid, {m: [] for m in errors})
            player[method].append(error)
            if error >= 50:
                large_errors[method].append({"frame": idx, "entityId": pid, "errorPixels": round(error, 2),
                                             "uncertaintyPixels": ref.get("uncertaintyPixels")})
        if all(row_err[m] is not None for m in errors):
            paired_all.append({"frame": idx, "entityId": pid, "errors": row_err,
                               "uncertaintyPixels": ref.get("uncertaintyPixels")})
            per_player_paired.setdefault(pid, {m: [] for m in errors})
            for method in errors:
                per_player_paired[pid][method].append(row_err[method])
    paired_errors = {m: [r["errors"][m] for r in paired_all] for m in errors}
    paired_uncertainty = [r["uncertaintyPixels"] for r in paired_all
                          if isinstance(r.get("uncertaintyPixels"), (int, float))]
    return {
        "sampleId": sample_id,
        "referenceCount": len(refs),
        "missingReferencesByMethod": missing_by_method,
        "missingReferenceFramesByMethod": missing_references,
        "availableOnly": {m: summary(errors[m]) for m in errors},
        "allMethodsPairedCount": len(paired_all),
        "allMethodsPairedReferenceUncertaintyPixels": summary(paired_uncertainty),
        "allMethodsPaired": {m: summary(paired_errors[m]) for m in errors},
        "pairedDeltasAgainstRaw": {
            m: {"n": len(paired_all), "medianDeltaPixels": round(median([r["errors"][m] - r["errors"]["raw"] for r in paired_all]), 2)
                if paired_all else None,
                "medianAbsoluteDeltaPixels": round(median([abs(r["errors"][m] - r["errors"]["raw"]) for r in paired_all]), 2)
                if paired_all else None,
                "referenceUncertaintyMedianPixels": round(median(paired_uncertainty), 2) if paired_uncertainty else None,
                "improved": sum(r["errors"][m] < r["errors"]["raw"] for r in paired_all),
                "worsened": sum(r["errors"][m] > r["errors"]["raw"] for r in paired_all)}
            for m in ("refined", "final")},
        "pairedDeltaFinalAgainstRefined": {
            "n": len(paired_all),
            "medianDeltaPixels": round(median([r["errors"]["final"] - r["errors"]["refined"] for r in paired_all]), 2)
            if paired_all else None,
            "improved": sum(r["errors"]["final"] < r["errors"]["refined"] for r in paired_all),
            "worsened": sum(r["errors"]["final"] > r["errors"]["refined"] for r in paired_all),
        },
        "largeErrorFrames": large_errors,
        "byPlayerPaired": {pid: {m: summary(vals) for m, vals in methods.items()}
                           for pid, methods in per_player.items()},
        "byPlayerAllMethodsPaired": {pid: {m: summary(vals) for m, vals in methods.items()}
                                     for pid, methods in per_player_paired.items()},
        "inputNullPoints": input_missing,
        "outputNullPoints": output_missing,
        "nullsFilled": max(0, input_missing - output_missing),
        "nullsIntroduced": max(0, output_missing - input_missing),
    }


def event_diagnostics(refs, times, source_by_player, finals_by_case):
    """Check turning-event shape retention; no independent stop labels exist."""
    annotated_turns = [r for r in refs if r.get("kind") == "turnback"]
    turns = []
    for ref in annotated_turns:
        frame, pid = ref["frame"], ref["entityId"]
        src = source_by_player.get(pid, [])
        seg_start = frame
        while seg_start > 0 and get_frame_point(src, seg_start - 1) is not None \
                and get_frame_point(src, seg_start) is not None and not src[seg_start].get("breakBefore"):
            seg_start -= 1
        seg_end = frame
        while seg_end + 1 < len(src) and get_frame_point(src, seg_end + 1) is not None \
                and get_frame_point(src, seg_end) is not None and not src[seg_end + 1].get("breakBefore"):
            seg_end += 1
        def nearest_valid(target_time, points, excluded=None):
            options = [(abs(t - target_time), i) for i, t in enumerate(times)
                       if i != excluded and abs(t - target_time) <= 0.8 and get_frame_point(points, i) is not None
                       and (excluded is None or not any(points[j].get("breakBefore")
                            for j in range(min(i, excluded) + 1, max(i, excluded) + 1)))]
            return min(options)[1] if options else None
        center = nearest_valid(times[frame], src)
        before = nearest_valid(times[frame] - 0.25, src, center)
        after = nearest_valid(times[frame] + 0.25, src, center)
        a, b, c = (get_frame_point(src, i) if i is not None else None for i in (before, center, after))
        base_angle = angle_degrees((b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])) if a and b and c else None
        row = {"entityId": pid, "frame": frame, "inputAngleDegrees": round(base_angle, 1) if base_angle is not None else None,
               "supportSegmentFrames": [seg_start, seg_end], "supportPointCount": seg_end - seg_start + 1,
               "boundaryLimitedWindow": (times[frame] - times[seg_start] < 0.25 or times[seg_end] - times[frame] < 0.25),
               "profiles": {}}
        for key, series in finals_by_case.items():
            points = series.get(pid, [])
            center_out = nearest_valid(times[frame], points)
            before_out = nearest_valid(times[frame] - 0.25, points, center_out)
            after_out = nearest_valid(times[frame] + 0.25, points, center_out)
            x, y, z = (get_frame_point(points, i) if i is not None else None
                       for i in (before_out, center_out, after_out))
            theta = angle_degrees((y[0] - x[0], y[1] - x[1]), (z[0] - y[0], z[1] - y[1])) if x and y and z else None
            row["profiles"][key] = {"angleDegrees": round(theta, 1) if theta is not None else None,
                                     "angleChangeDegrees": round(theta - base_angle, 1) if theta is not None and base_angle is not None else None}
        turns.append(row)

    # No manually labeled stop references exist. Report only low-motion source
    # intervals and their speed changes as a preservation diagnostic, not truth.
    low_motion = {}
    for pid, points in source_by_player.items():
        valid_speeds = []
        for i in range(1, len(points)):
            a, b = xy(points[i - 1]), xy(points[i])
            dt = times[i] - times[i - 1] if i < len(times) else 0
            v = speed(a, b, dt)
            if v is not None:
                valid_speeds.append((i, v))
        if not valid_speeds:
            continue
        q20 = sorted(v for _, v in valid_speeds)[max(0, math.ceil(.2 * len(valid_speeds)) - 1)]
        candidates = [(i, v) for i, v in valid_speeds if v <= q20]
        for key, series in finals_by_case.items():
            output_speeds = []
            for idx, _ in candidates:
                a, b = get_frame_point(series.get(pid, []), idx - 1), get_frame_point(series.get(pid, []), idx)
                out_speed = speed(a, b, times[idx] - times[idx - 1]) if idx > 0 else None
                if out_speed is not None:
                    output_speeds.append(out_speed)
            input_speeds = [v for _, v in candidates]
            low_motion.setdefault(key, {})[pid] = {
                "candidateFrames": len(candidates),
                "inputMedianMetersPerSecond": round(median(input_speeds), 3) if input_speeds else None,
                "outputMedianMetersPerSecond": round(median(output_speeds), 3) if output_speeds else None,
                "outputCoverage": len(output_speeds),
            }
    for key, players in low_motion.items():
        input_values = [v["inputMedianMetersPerSecond"] for v in players.values() if v["inputMedianMetersPerSecond"] is not None]
        output_values = [v["outputMedianMetersPerSecond"] for v in players.values() if v["outputMedianMetersPerSecond"] is not None]
        low_motion[key] = {"byPlayer": players, "inputMedianAcrossPlayers": round(median(input_values), 3) if input_values else None,
                           "outputMedianAcrossPlayers": round(median(output_values), 3) if output_values else None}
    return {"annotatedTurnFrames": turns, "candidateLowMotionChecks": low_motion,
            "stopGroundTruthAvailable": False,
            "interpretation": "Turn angles and low-motion speeds describe event-shape retention only; sparse AI image references are the positional check. No independent stop labels were available."}


def qwen_coverage(raw_by_player, refined_by_player, people, mapping_rows):
    """Summarize model output, explicit unknown ranges, and real coordinate edits."""
    result = {}
    total = {k: 0 for k in ("rawValid", "refinedValid", "qwenRefinedSourceFrames", "rawValidToRefinedMissing",
                            "rawMissingToRefinedValid", "changedAny", "changedOver5cm", "unknownFrames",
                            "rawMissingInsideUnknown", "rawMissingOutsideUnknown",
                            "anchors", "jobReady", "jobPartial", "jobFailed")}
    for pid, row in people.items():
        raw = raw_by_player.get(pid, [])
        refined = refined_by_player.get(pid, [])
        n = max(len(raw), len(refined))
        valid_raw = valid_refined = source_qwen = removed = added = changed = changed_5cm = 0
        removed_frames = []
        metre_displacements, pixel_displacements = [], []
        for i in range(n):
            a = raw[i] if i < len(raw) else {}
            b = refined[i] if i < len(refined) else {}
            ap, bp = xy(a), xy(b)
            valid_raw += ap is not None
            valid_refined += bp is not None
            source_qwen += b.get("source") == "qwen_refined"
            if ap is not None and bp is None:
                removed += 1
                removed_frames.append(i)
            elif ap is None and bp is not None:
                added += 1
            elif ap is not None and bp is not None:
                displacement = math.dist(ap, bp)
                if displacement > 1e-6:
                    changed += 1
                    metre_displacements.append(displacement)
                if displacement >= 0.05:
                    changed_5cm += 1
                if displacement > 1e-6:
                    mapping = mapping_rows[i].get("toImage") if i < len(mapping_rows) and mapping_rows[i] else None
                    pa, pb = image_point(mapping, ap), image_point(mapping, bp)
                    if pa is not None and pb is not None:
                        pixel_displacements.append(math.dist(pa, pb))
        unknown_frames = set()
        for interval in row.get("unknownRanges", []):
            start = max(0, int(interval.get("startFrame", 0)))
            end = min(n, int(interval.get("endFrameExclusive", start)))
            unknown_frames.update(range(start, max(start, end)))
        jobs = [j.get("status") for j in row.get("jobs", [])]
        missing_inside_unknown = sum(i in unknown_frames for i in removed_frames)
        counts = {
            "rawValid": valid_raw, "refinedValid": valid_refined,
            "qwenRefinedSourceFrames": source_qwen,
            "rawValidToRefinedMissing": removed, "rawMissingToRefinedValid": added,
            "changedAny": changed, "changedOver5cm": changed_5cm,
            "changedDisplacementMeters": summary(metre_displacements),
            "changedDisplacementPixels": summary(pixel_displacements),
            "unknownFrames": len(unknown_frames),
            "rawMissingInsideUnknown": missing_inside_unknown,
            "rawMissingOutsideUnknown": removed - missing_inside_unknown,
            "unknownReasons": {str(reason): sum(1 for x in row.get("unknownRanges", []) if str(x.get("reason")) == str(reason))
                               for reason in sorted({x.get("reason") for x in row.get("unknownRanges", [])}, key=str)},
            "anchors": len(row.get("anchors", [])),
            "jobs": {state: jobs.count(state) for state in ("ready", "partial", "failed")},
        }
        result[pid] = counts
        for key in total:
            if key in ("jobReady", "jobPartial", "jobFailed"):
                total[key] += counts["jobs"][key[3:].lower()]
            else:
                total[key] += counts[key]
    return {"totals": total, "byPlayer": result,
            "interpretation": "rawValidToRefinedMissing is a potential deletion/miss, not proof of incorrect removal; Qwen unknown ranges and failed jobs remain distinct. Coordinate-change coverage compares raw versus Qwen refined before denoising."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("001", "002"), required=True)
    parser.add_argument("--source", type=Path, default=ROOT / "artifacts/qwen-parallel-20261007/single-player-v1")
    parser.add_argument("--reference-file", type=Path, default=Path(__file__).with_name("visual_reference.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    folder = args.source / f"official-training-{args.case}"
    result_path = folder / "result.json"
    if not result_path.exists():
        parser.error(f"Missing merged result: {result_path}")
    merged, session, clip = read(result_path), read(folder / "input-session.json"), read(folder / "input-clip.json")
    run_path = folder / "run.json"
    run = read(run_path) if run_path.exists() else {}
    sample_id = f"official-training-{args.case}"
    reference = read(args.reference_file)
    refs = [r for r in reference.get("references", []) if r.get("sampleId") == sample_id
            and r.get("contact") == "visible" and r.get("imagePoint")]
    frames = clip.get("frames", [])
    times = [float(r.get("time", i)) for i, r in enumerate(frames)]
    mapping_rows = session.get("courtPreparation", {}).get("maps", [])
    frames_by_idx = {i: {"frame": i, "toImage": mapping_rows[i].get("toImage") if i < len(mapping_rows) and mapping_rows[i] else None}
                     for i in range(len(frames))}
    raw_by_player = session.get("courtPreparation", {}).get("rawByPlayer", {})
    people = merged.get("players", {})
    entities = {e["id"]: e for e in session.get("entities", [])}
    refined_by_player = {pid: with_binding_boundaries(row.get("refined", []), entities[pid])
                         if pid in entities else row.get("refined", [])
                         for pid, row in people.items()}
    binding_boundaries = {pid: [i for i, point in enumerate(points) if point.get("breakBefore")]
                          for pid, points in refined_by_player.items()}
    input_missing = {pid: sum(xy(p) is None for p in points) for pid, points in refined_by_player.items()}
    configs = {}
    finals_for_turns = {}
    source_for_turns = refined_by_player
    for profile in (*PROFILES, *CUSTOM_CONFIGS):
        turn_modes = ("macro",) if profile in CUSTOM_CONFIGS else TURN_MODES
        for turn_mode in turn_modes:
            key = f"{profile}-{turn_mode}"
            finals = {}
            diagnostics = {}
            missing = 0
            for pid, player in people.items():
                points = refined_by_player[pid]
                if len(points) != len(frames):
                    points = [dict(p) for p in points[:len(frames)]] + [{} for _ in range(max(0, len(frames) - len(points)))]
                denoise_input = []
                for i, p in enumerate(points):
                    denoise_input.append({**p, "frame": i, "time": times[i] if i < len(times) else i})
                config = {"profile": profile, "turn_mode": turn_mode, **CUSTOM_CONFIGS.get(profile, {})}
                out = denoise_player(denoise_input, anchors=player.get("anchors", []),
                                     cuts=session.get("cuts", []), config=config)
                finals[pid] = out["points"]
                diagnostics[pid] = out["diagnostics"]
                missing += sum(xy(p) is None for p in out["points"])
            finals_for_turns[key] = finals
            configs[key] = summarize_config(sample_id, refs, frames_by_idx, raw_by_player,
                                             refined_by_player, finals, missing,
                                             sum(input_missing.values()))
            configs[key]["denoiseDiagnostics"] = {
                "outlierCount": sum(d["outlierCount"] for d in diagnostics.values()),
                "turnWindowReductions": sum(d["turnWindowReductions"] for d in diagnostics.values()),
                "minSmoothingPoints": next(iter(diagnostics.values()))["config"].get("min_smoothing_points") if diagnostics else None,
                "shortSegmentPointsPreserved": sum(sum(point.get("method") == "short_segment" for point in points)
                                                   for points in finals.values()),
                "profile": profile, "turnMode": turn_mode,
            }
    run_status = run.get("status")
    snapshot_status, terminal_failed_jobs, manifest_errors = classify_snapshot(run, merged)
    report = {
        "status": snapshot_status, "accuracyAccepted": False,
        "runStatus": run.get("status"), "runId": run.get("runId"),
        "terminalFailedJobCount": len(terminal_failed_jobs),
        "manifestErrorCount": len(manifest_errors),
        "resultLastWriteTime": result_path.stat().st_mtime,
        "sampleId": sample_id, "sourceDigest": merged.get("sourceDigest"),
        "bindingBoundaryCounts": {pid: len(indices) for pid, indices in binding_boundaries.items()},
        "qwenCoverage": qwen_coverage(raw_by_player, refined_by_player, people, mapping_rows),
        "referenceSource": reference.get("source"), "referenceStatus": reference.get("referenceStatus"),
        "visibleReferenceCount": len(refs),
        "referenceUncertaintyPixels": summary([r.get("uncertaintyPixels", 0) for r in refs]),
        "pairedPolicy": "raw/refined/final are compared on each config's identical rows; paired deltas never exclude a method-specific miss. Cross-config comparisons must use the minimum common frame set.",
        "configs": configs,
        "turnAndStopRetention": event_diagnostics(refs, times, source_for_turns, finals_for_turns),
        "limitations": [
            "Reference points are sparse independent AI visual estimates, not human labels.",
            "Uncertain/airborne references are excluded from numeric position error; missing projected outputs remain counted.",
            f"This is a {snapshot_status} source snapshot; status is not accuracy acceptance.",
            "No independently annotated stop frames exist; low-motion checks are candidate intervals, not verified stops.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "status": report["status"], "visibleReferenceCount": len(refs),
                      "configNames": list(configs)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
