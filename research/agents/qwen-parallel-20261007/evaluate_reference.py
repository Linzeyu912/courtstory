"""Compare replay ground points with independent image-space foot references."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from statistics import median


METHODS = ("raw", "refined", "qwen")


def image_point(matrix, point):
    if not matrix or not point or len(matrix) != 9 or len(point) < 2:
        return None
    x, y = point[:2]
    w = matrix[6] * x + matrix[7] * y + matrix[8]
    if not math.isfinite(w) or abs(w) < 1e-9:
        return None
    result = ((matrix[0] * x + matrix[1] * y + matrix[2]) / w,
              (matrix[3] * x + matrix[4] * y + matrix[5]) / w)
    return result if all(math.isfinite(v) for v in result) else None


def percentile90(values):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)]


def summary(values):
    return {"n": len(values), "medianPixels": round(median(values), 2) if values else None,
            "p90Pixels": round(percentile90(values), 2) if values else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-file", type=Path, default=Path(__file__).with_name("visual_reference.json"))
    parser.add_argument("--replay", action="append", default=[], metavar="SAMPLE_ID=PATH",
                        help="Replay JSON from the observer export; pass once per sample.")
    parser.add_argument("--large-error-pixels", type=float, default=50)
    args = parser.parse_args()
    reference = json.loads(args.reference_file.read_text(encoding="utf-8"))
    replays = {}
    for item in args.replay:
        sample_id, sep, raw_path = item.partition("=")
        if not sep:
            parser.error("--replay must be SAMPLE_ID=PATH")
        replays[sample_id] = json.loads(Path(raw_path).read_text(encoding="utf-8"))

    refs = [row for row in reference["references"] if row.get("contact") == "visible" and row.get("imagePoint")
            and row.get("sampleId") in replays]
    uncertainties = [row["uncertaintyPixels"] for row in refs if isinstance(row.get("uncertaintyPixels"), (int, float))]
    report = {"referenceSource": reference.get("source"), "visibleReferenceCount": len(refs),
              "referenceUncertaintyPixels": summary(uncertainties),
              "referenceUncertaintyNote": "These are independent AI visual estimates, not human ground truth; pixel errors should be interpreted relative to the stated uncertainty.",
              "largeErrorThresholdPixels": args.large_error_pixels, "methods": {}, "bySample": {}}
    records = {method: [] for method in METHODS}
    paired = []
    by_sample = {}
    for ref in refs:
        sample_id = ref["sampleId"]
        sample_values = by_sample.setdefault(sample_id, {method: {"errors": [], "missing": 0} for method in METHODS})
        replay = replays.get(sample_id)
        if replay is None:
            continue
        frames = replay.get("frames", [])
        frame_row = next((row for row in frames if row.get("frame") == ref["frame"]), None)
        row_errors = {}
        for method in METHODS:
            player_row = (frame_row.get("players") or {}).get(ref["entityId"], frame_row) if frame_row else {}
            projected = image_point(frame_row.get("toImage"), player_row.get(method)) if frame_row else None
            if projected is None:
                record = {"sampleId": sample_id, "frame": ref["frame"], "entityId": ref["entityId"], "error": None}
                records[method].append(record)
                sample_values[method]["missing"] += 1
                row_errors[method] = None
                continue
            expected = ref["imagePoint"]
            error = math.hypot(projected[0] - expected["x"], projected[1] - expected["y"])
            records[method].append({"sampleId": sample_id, "frame": ref["frame"], "entityId": ref["entityId"], "error": error})
            sample_values[method]["errors"].append(error)
            row_errors[method] = error
        if len(row_errors) == len(METHODS) and all(row_errors[method] is not None for method in METHODS):
            paired.append({"sampleId": sample_id, "frame": ref["frame"], "entityId": ref["entityId"],
                           "uncertaintyPixels": ref.get("uncertaintyPixels"), "errors": row_errors})

    report["pairedReferenceCount"] = len(paired)
    report["pairedReferenceUncertaintyPixels"] = summary([row["uncertaintyPixels"] for row in paired
                                                           if isinstance(row.get("uncertaintyPixels"), (int, float))])
    report["pairedMethods"] = {}
    for method in METHODS:
        errors = [row["errors"][method] for row in paired]
        report["pairedMethods"][method] = {**summary(errors), "largeErrorFrames": [
            {"sampleId": row["sampleId"], "frame": row["frame"], "entityId": row["entityId"],
             "errorPixels": round(row["errors"][method], 2), "uncertaintyPixels": row.get("uncertaintyPixels")}
            for row in paired if row["errors"][method] >= args.large_error_pixels]}
    # Show paired deltas only on identical reference rows. A method with more
    # missing outputs cannot appear better by silently dropping its hard frames.
    report["pairedComparisons"] = {}
    for candidate in ("refined", "qwen"):
        diffs = [row["errors"][candidate] - row["errors"]["raw"] for row in paired]
        report["pairedComparisons"][f"{candidate}-raw"] = {
            "n": len(diffs), "medianDeltaPixels": round(median(diffs), 2) if diffs else None,
            "improvedCount": sum(delta < 0 for delta in diffs),
            "worsenedCount": sum(delta > 0 for delta in diffs),
            "unchangedCount": sum(delta == 0 for delta in diffs),
            "pairedReferenceCount": len(paired),
        }
    report["pairedBySample"] = {}
    for sample_id in replays:
        sample_rows = [row for row in paired if row["sampleId"] == sample_id]
        report["pairedBySample"][sample_id] = {method: summary([row["errors"][method] for row in sample_rows])
                                                for method in METHODS}

    for method in METHODS:
        errs = [record["error"] for record in records[method] if record["error"] is not None]
        missing = [record for record in records[method] if record["error"] is None]
        report["methods"][method] = {
            "availableCount": len(errs), "missingCount": len(missing),
            "missingFrames": [{k: v for k, v in record.items() if k != "error"} for record in missing],
            "availableOnly": summary(errs),
            "largeErrorFrames": [],
        }
    for method in METHODS:
        misses = [{k: v for k, v in record.items() if k != "error"} | {"errorPixels": round(record["error"], 2)}
                  for record in records[method] if record["error"] is not None and record["error"] >= args.large_error_pixels]
        uncertainty_by_ref = {(ref["sampleId"], ref["frame"], ref["entityId"]): ref.get("uncertaintyPixels") for ref in refs}
        for miss in misses:
            miss["uncertaintyPixels"] = uncertainty_by_ref.get((miss["sampleId"], miss["frame"], miss["entityId"]))
        report["methods"][method]["largeErrorFrames"] = misses
    for sample_id, methods in by_sample.items():
        report["bySample"][sample_id] = {}
        for method, result in methods.items():
            errs = result["errors"]
            report["bySample"][sample_id][method] = {"missingCount": result["missing"], "availableOnly": summary(errs)}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
