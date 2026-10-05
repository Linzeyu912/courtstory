"""Check sparse, visually outlined cases; does not estimate dataset accuracy."""

import argparse
import json
from pathlib import Path


def iou(first, second):
    intersection = max(0, min(first[2], second[2]) - max(first[0], second[0])) * max(
        0, min(first[3], second[3]) - max(first[1], second[1]))
    first_area = (first[2] - first[0]) * (first[3] - first[1])
    second_area = (second[2] - second[0]) * (second[3] - second[1])
    return intersection / max(first_area + second_area - intersection, 1e-9)


def evaluate(cases, records):
    by_frame = {record["frame"]: record for record in records}
    results = []
    used = {}
    for case in cases["cases"]:
        record = by_frame[case["frame"]]
        tracks = record["tracks"]
        pending = record.get("pending_detections", [])
        candidates = [(box, "tracked") for box in tracks] + [(box, "pending") for box in pending]
        matches = sorted(((iou(case["box"], box), index, status)
                          for index, (box, status) in enumerate(candidates)), reverse=True)
        chosen = None
        for overlap, index, status in matches:
            if overlap < cases["iou_threshold"]:
                break
            if index not in used.setdefault(case["frame"], set()):
                chosen = (overlap, index, status)
                used[case["frame"]].add(index)
                break
        results.append({**case, "visible_box": chosen is not None,
                        "matched_status": chosen[2] if chosen else None,
                        "matched_iou": chosen[0] if chosen else None,
                        "best_iou": matches[0][0] if matches else 0})
    groups = {}
    for group in ("far_player", "other_player", "non_player"):
        items = [item for item in results if item["group"] == group]
        groups[group] = {"cases": len(items), "visible_boxes": sum(item["visible_box"] for item in items),
                         "tracked": sum(item["matched_status"] == "tracked" for item in items),
                         "pending": sum(item["matched_status"] == "pending" for item in items)}
    return {"groups": groups, "cases": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--improved", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))
    report = {"scope": cases["description"], "iou_threshold": cases["iou_threshold"],
              "source_video_sha256": cases["video_sha256"]}
    for method in ("baseline", "improved"):
        records = json.loads(Path(getattr(args, method)).read_text(encoding="utf-8"))
        report[method] = evaluate(cases, records)
        print(method, report[method]["groups"])
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
