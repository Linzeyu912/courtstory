"""Evaluate selected human challenge observations separately from inference.

Reference boxes locate actors; their IoU is a matching aid, not geometric ground
truth. This never supplies names, jersey readings or annotations to the tracker.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path

from basketball_render import aliases_for_frame
from basketball_run import save_json
from basketball_tracking import box_overlap


def locate(record, box, suggestions):
    tracked = [(box_overlap(box, row)[0], row) for row in record["tracks"]]
    pending = [(box_overlap(box, row)[0], row) for row in record.get("pending_detections", [])]
    best_track = max(tracked, key=lambda pair: pair[0], default=(0., None))
    best_pending = max(pending, key=lambda pair: pair[0], default=(0., None))
    tracked_iou, row = best_track
    identity = int(row[4]) if row is not None and tracked_iou >= .30 else None
    evidence = record.get("track_evidence", {}).get(str(identity), {})
    aliases = aliases_for_frame(suggestions, record)
    return {"tracked_id": identity, "tracked_locator_iou": round(tracked_iou, 6),
            "tracked_confidence": row[5] if identity is not None else None,
            "nearest_kind": "tracked" if tracked_iou >= best_pending[0] else "pending",
            "pending_locator_iou": round(best_pending[0], 6),
            "proposal_alias": f"P{aliases[identity]}" if identity in aliases else None,
            "identity_review_required": evidence.get("identity_review_required", False),
            "observation_source": evidence.get("source"),
            "raw_detection_index": evidence.get("raw_detection_index"),
            "native_detection_index": evidence.get("native_detection_index")}


def evaluate(references, variant_paths):
    datasets, metadata = {}, {}
    for path in variant_paths:
        datasets[path.stem] = json.loads(path.read_text(encoding="utf-8"))
        metadata[path.stem] = json.loads(path.with_suffix(".meta.json").read_text(encoding="utf-8"))
        if metadata[path.stem]["video_sha256"] != references["videoSha256"]:
            raise ValueError("Reference observations belong to a different source video.")
    observations, actor_series = [], {variant: defaultdict(list) for variant in datasets}
    for reference in references["observations"]:
        result = {"frame": reference["frame"], "actor": reference["actor"], "variants": {}}
        for variant, records in datasets.items():
            match = locate(records[reference["frame"]], reference["box"], metadata[variant].get("identitySuggestions", {}))
            result["variants"][variant] = match
            actor_series[variant][reference["actor"]].append({"frame": reference["frame"], **match})
        observations.append(result)
    baseline = datasets["baseline"]
    team_only = []
    for reference in references["teamOnlyChecks"]:
        frame = reference["frame"]
        row = next(row for row in baseline[frame]["tracks"] if int(row[4]) == reference["baselineTrackId"])
        team_only.append({**reference, "variants": {variant: locate(records[frame], row[:4],
            metadata[variant].get("identitySuggestions", {})) for variant, records in datasets.items()}})
    return {"method": references["method"], "limits": references["limits"],
            "accuracy_metric": None,
            "matching": "Highest IoU tracked locator >= .30, alongside nearest pending locator; copied baseline boxes are not independent geometric truth.",
            "observations": observations, "actor_series": actor_series, "team_only_checks": team_only,
            "statistics": {variant: meta["statistics"] for variant, meta in metadata.items()},
            "note": "A partial tracked ID already existed for White 7 at frame 159; export recovery improves the observed full-body box, not identity recall."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--variants", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(json.loads(args.references.read_text(encoding="utf-8")), args.variants)
    save_json(args.output, result)
    print(json.dumps({"output": str(args.output.resolve()), "observations": len(result["observations"]),
                      "variants": list(result["statistics"]), "accuracy_metric": None}))


if __name__ == "__main__":
    main()
