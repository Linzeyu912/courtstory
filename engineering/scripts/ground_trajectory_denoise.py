"""Small, time-aware denoising helpers for one player's court-space path."""
from __future__ import annotations

import math
from statistics import median
from typing import Any, Iterable


DEFAULT_CONFIG = {
    "profile": "balanced",
    "window_seconds": 0.16,
    "outlier_min_distance": 1.25,
    "outlier_mad_scale": 5.0,
    "max_displacement": 1.0,
    "anchor_weight": 12.0,
    "robust_passes": 2,
    "turn_mode": "macro",
    "turn_window_seconds": 0.08,
    "turn_min_displacement": 0.12,
    "turn_cosine_threshold": 0.20,
    "turn_window_scale": 0.45,
    "min_smoothing_points": 7,
}

PROFILES = {
    "conservative": {"window_seconds": 0.10, "max_displacement": 0.55, "outlier_min_distance": 1.8},
    "balanced": {"window_seconds": 0.16, "max_displacement": 1.0, "outlier_min_distance": 1.25},
    "strong": {"window_seconds": 0.24, "max_displacement": 1.6, "outlier_min_distance": 1.0},
}


def _xy(p: dict[str, Any]) -> tuple[float, float] | None:
    x, y = p.get("x"), p.get("y")
    if isinstance(x, (int, float)) and isinstance(y, (int, float)) and math.isfinite(x) and math.isfinite(y):
        return float(x), float(y)
    return None


def _anchor_map(anchors: Iterable[dict[str, Any]] | dict[Any, Any]) -> dict[int, list[dict[str, Any]]]:
    result: dict[int, list[dict[str, Any]]] = {}
    if isinstance(anchors, dict):
        items = []
        for frame, value in anchors.items():
            if isinstance(value, dict):
                items.append({"frame": frame, **value})
            elif isinstance(value, (list, tuple)) and len(value) >= 2:
                items.append({"frame": frame, "x": value[0], "y": value[1]})
    else:
        items = list(anchors or [])
    for a in items:
        try:
            frame = int(a["frame"])
            x, y = float(a["x"]), float(a["y"])
            if math.isfinite(x) and math.isfinite(y):
                result.setdefault(frame, []).append({**a, "x": x, "y": y})
        except (KeyError, TypeError, ValueError):
            continue
    return result


def _solve3(a: list[list[float]], b: list[float]) -> list[float] | None:
    m = [row[:] + [rhs] for row, rhs in zip(a, b)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda row: abs(m[row][col]))
        if abs(m[pivot][col]) < 1e-12:
            return None
        m[col], m[pivot] = m[pivot], m[col]
        scale = m[col][col]
        m[col] = [v / scale for v in m[col]]
        for row in range(3):
            if row == col:
                continue
            factor = m[row][col]
            m[row] = [v - factor * u for v, u in zip(m[row], m[col])]
    return [m[i][3] for i in range(3)]


def _poly_at(samples: list[tuple[float, float, float, float]], t0: float, bandwidth: float,
             robust_passes: int, target_frame: int) -> tuple[float, float] | None:
    """Centered tricube-weighted quadratic fit, with a few residual reweight passes."""
    chosen = [(t, x, y, w) for t, x, y, w in samples if abs(t - t0) <= bandwidth * 1.001]
    if not chosen:
        return None
    if len(chosen) < 3:
        return min(chosen, key=lambda s: abs(s[0] - t0))[1:3]
    u = [(t - t0) / bandwidth for t, _, _, _ in chosen]
    base = []
    for z, (_, _, _, confidence) in zip(u, chosen):
        q = max(0.0, 1.0 - abs(z) ** 3) ** 3
        base.append(q * confidence)
    robust = [1.0] * len(chosen)
    fitx = fity = None
    for _ in range(max(1, robust_passes + 1)):
        weights = [a * b for a, b in zip(base, robust)]
        ata = [[0.0] * 3 for _ in range(3)]
        bx = [0.0] * 3
        by = [0.0] * 3
        for z, (t, x, y, _), w in zip(u, chosen, weights):
            terms = (1.0, z, z * z)
            for i in range(3):
                bx[i] += w * terms[i] * x
                by[i] += w * terms[i] * y
                for j in range(3):
                    ata[i][j] += w * terms[i] * terms[j]
        fitx, fity = _solve3(ata, bx), _solve3(ata, by)
        if fitx is None or fity is None:
            return min(chosen, key=lambda s: abs(s[0] - t0))[1:3]
        if _ == robust_passes:
            break
        residuals = [math.hypot(x - (fitx[0] + fitx[1] * z + fitx[2] * z * z),
                                y - (fity[0] + fity[1] * z + fity[2] * z * z))
                     for z, (_, x, y, _) in zip(u, chosen)]
        scale = max(0.015, 1.4826 * median(residuals))
        robust = [min(1.0, (2.5 * scale / max(r, 1e-12))) for r in residuals]
    return fitx[0], fity[0]


def denoise_player(points: Iterable[dict[str, Any]], anchors: Iterable[dict[str, Any]] = (),
                   cuts: Iterable[int] = (), config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Denoise one player's 2D path without filling gaps or changing its timeline.

    A cut frame starts a new segment. `anchors` accepts frame/x/y objects (the
    Qwen ground-anchor shape is accepted); anchors are soft, high-weight samples.
    Locked input points are copied exactly and remain unchanged.
    """
    rows = [dict(p) for p in points]
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    profile = PROFILES.get(str(cfg.get("profile", "balanced")), {})
    for k, value in profile.items():
        if k not in (config or {}):
            cfg[k] = value
    cutset = {int(c) for c in (cuts or [])}
    anchor_by_frame = _anchor_map(anchors)
    original = [_xy(p) for p in rows]
    times = [float(p.get("time", p.get("frame", i))) for i, p in enumerate(rows)]
    frames = [int(p.get("frame", i)) for i, p in enumerate(rows)]
    frame_index = {f: i for i, f in enumerate(frames)}
    diagnostics: dict[str, Any] = {"profile": cfg["profile"], "config": {k: cfg[k] for k in
        ("window_seconds", "outlier_min_distance", "outlier_mad_scale", "max_displacement", "anchor_weight", "robust_passes",
         "turn_mode", "turn_window_seconds", "turn_min_displacement", "turn_cosine_threshold", "turn_window_scale",
         "min_smoothing_points")},
        "pointCount": len(rows), "validInputPoints": sum(p is not None for p in original),
        "outlierFrames": [], "anchorReview": [], "turnWindowReductions": 0,
        "displacement": {"count": 0, "mean": 0.0, "median": 0.0, "p95": 0.0, "max": 0.0}}
    anchor_at_index: dict[int, list[dict[str, Any]]] = {}
    for frame, anchors_here in anchor_by_frame.items():
        if frame in frame_index:
            anchor_at_index[frame_index[frame]] = anchors_here
    # Segment only at nulls, frame discontinuities, and explicit cuts.
    segments: list[list[int]] = []
    current: list[int] = []
    for i, p in enumerate(rows):
        if original[i] is None:
            if current:
                segments.append(current); current = []
            continue
        if current and (frames[i] != frames[current[-1]] + 1 or frames[i] in cutset or p.get("breakBefore")):
            segments.append(current); current = []
        current.append(i)
    if current:
        segments.append(current)

    displaced: list[float] = []
    for segment in segments:
        # Represent anchor disagreements as high-weight evidence and expose them for review.
        values = {i: original[i] for i in segment}
        anchor_confidence = {}
        for i in segment:
            if i in anchor_at_index:
                a = anchor_at_index[i][-1]
                values[i] = (a["x"], a["y"])
                anchor_confidence[i] = float(cfg["anchor_weight"])
        # Detect only extreme, isolated one-frame spikes. Chord support and a high
        # floor avoid treating ordinary turns or basketball stops as speed violations.
        outliers: set[int] = set()
        for pos in range(1, len(segment) - 1):
            i, before, after = segment[pos], segment[pos - 1], segment[pos + 1]
            if rows[i].get("locked") or i in anchor_at_index:
                continue
            a, b, c = values[before], values[i], values[after]
            dt = times[after] - times[before]
            if dt <= 0:
                continue
            ratio = (times[i] - times[before]) / dt
            interp = (a[0] + ratio * (c[0] - a[0]), a[1] + ratio * (c[1] - a[1]))
            residual = math.dist(b, interp)
            side_support = math.dist(a, c)
            local_steps = [math.dist(values[segment[j]], values[segment[j + 1]]) /
                           max(1e-9, times[segment[j + 1]] - times[segment[j]])
                           for j in range(max(0, pos - 3), min(len(segment) - 1, pos + 3))
                           if j not in (pos - 1, pos)]
            if not local_steps:
                local_steps = [math.dist(values[segment[j]], values[segment[j + 1]]) /
                               max(1e-9, times[segment[j + 1]] - times[segment[j]])
                               for j in range(max(0, pos - 3), min(len(segment) - 1, pos + 3))]
            scale = 1.4826 * median(local_steps) * max(0.001, dt) * 0.5
            threshold = max(float(cfg["outlier_min_distance"]), float(cfg["outlier_mad_scale"]) * scale)
            # Need additional neighboring support: a real reversal has directional
            # evidence across a wider neighborhood; a one-frame isolated spike does not.
            if residual > threshold and side_support < max(0.55, residual * 0.32):
                outliers.add(i)
        diagnostics["outlierFrames"].extend(frames[i] for i in sorted(outliers))
        corrected = dict(values)
        for i in outliers:
            pos = segment.index(i)
            left, right = segment[pos - 1], segment[pos + 1]
            dt = times[right] - times[left]
            ratio = (times[i] - times[left]) / dt if dt > 0 else 0.5
            corrected[i] = (values[left][0] + ratio * (values[right][0] - values[left][0]),
                            values[left][1] + ratio * (values[right][1] - values[left][1]))

        bandwidth0 = max(0.001, float(cfg["window_seconds"]))
        samples = [(times[i], corrected[i][0], corrected[i][1],
                    1e6 if rows[i].get("locked") else anchor_confidence.get(i, 1.0)) for i in segment]
        for pos, i in enumerate(segment):
            source = original[i]
            if rows[i].get("locked"):
                result = source
                method = "locked"
            elif len(segment) < int(cfg["min_smoothing_points"]):
                # Keep short real maneuvers intact, while still correcting a
                # spike that passed the strict isolated-outlier evidence test.
                result = corrected[i] if i in outliers else source
                method = "short_segment_outlier" if i in outliers else "short_segment"
            else:
                # Reduce the centered window at supported direction changes. The
                # default compares a wider time neighborhood and ignores tiny jitter.
                bandwidth = bandwidth0
                is_turn = False
                if cfg.get("turn_mode", "macro") == "adjacent":
                    if 0 < pos < len(segment) - 1:
                        p0, p1, p2 = (corrected[segment[j]] for j in (pos - 1, pos, pos + 1))
                        v1, v2 = (p1[0] - p0[0], p1[1] - p0[1]), (p2[0] - p1[0], p2[1] - p1[1])
                        n1, n2 = math.hypot(*v1), math.hypot(*v2)
                        if n1 > 1e-7 and n2 > 1e-7:
                            turn = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
                            is_turn = turn < 0.35
                else:
                    radius = max(0.001, float(cfg["turn_window_seconds"]))
                    left_pos = next((j for j in range(pos - 1, -1, -1)
                                     if times[i] - times[segment[j]] >= radius), None)
                    right_pos = next((j for j in range(pos + 1, len(segment))
                                      if times[segment[j]] - times[i] >= radius), None)
                    if left_pos is not None and right_pos is not None:
                        left, right = segment[left_pos], segment[right_pos]
                        p0, p1, p2 = corrected[left], corrected[i], corrected[right]
                        v1 = (p1[0] - p0[0], p1[1] - p0[1])
                        v2 = (p2[0] - p1[0], p2[1] - p1[1])
                        n1, n2 = math.hypot(*v1), math.hypot(*v2)
                        if n1 >= float(cfg["turn_min_displacement"]) and n2 >= float(cfg["turn_min_displacement"]):
                            turn = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
                            is_turn = turn < float(cfg["turn_cosine_threshold"])
                if is_turn:
                    bandwidth *= float(cfg["turn_window_scale"])
                    diagnostics["turnWindowReductions"] += 1
                fitted = _poly_at(samples, times[i], bandwidth, int(cfg["robust_passes"]), frames[i])
                result = fitted or source
                # Bound movement for reviewability and avoid smoothing away real events.
                delta = math.dist(source, result)
                limit = float(cfg["max_displacement"])
                if i not in outliers and delta > limit > 0:
                    result = (source[0] + (result[0] - source[0]) * limit / delta,
                              source[1] + (result[1] - source[1]) * limit / delta)
                method = "robust_smooth"
            rows[i]["rawX"], rows[i]["rawY"] = source
            rows[i]["x"], rows[i]["y"] = result
            move = math.dist(source, result)
            rows[i]["displacement"] = move
            rows[i]["method"] = method
            rows[i]["processedState"] = "unchanged" if move < 1e-9 else "denoised"
            if move >= 1e-9:
                displaced.append(move)
            if i in anchor_at_index:
                for anchor in anchor_at_index[i]:
                    diagnostics["anchorReview"].append({"frame": frames[i], "basis": anchor.get("basis"),
                        "evidenceFrames": anchor.get("evidenceFrames"),
                        "inputDistanceFromCandidate": math.dist(source, (anchor["x"], anchor["y"])),
                        "outputDistanceFromCandidate": math.dist(result, (anchor["x"], anchor["y"]))})
    segment_indices = {i for segment in segments for i in segment}
    for i, p in enumerate(rows):
        if original[i] is None:
            p["rawX"] = p["rawY"] = p["x"] = p["y"] = None
            p["displacement"] = 0.0
            p["method"] = "missing"
            p["processedState"] = "missing"
        elif i not in segment_indices:
            p["rawX"], p["rawY"] = original[i]
    if displaced:
        ordered = sorted(displaced)
        diagnostics["displacement"] = {"count": len(ordered), "mean": sum(ordered) / len(ordered),
            "median": median(ordered), "p95": ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))], "max": ordered[-1]}
    diagnostics["segments"] = len(segments)
    diagnostics["outlierCount"] = len(diagnostics["outlierFrames"])
    return {"points": rows, "diagnostics": diagnostics}
