"""Focused tests for source-time indexing and bounded commentary image tools."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from fractions import Fraction

import av
import numpy as np

from commentary_video import CommentaryVideo


def make_vfr_video(path, start_pts=0):
    """Write a small lossless clip with deliberately uneven presentation times."""
    with av.open(str(path), "w", format="matroska") as output:
        stream = output.add_stream("ffv1", rate=25)
        stream.width, stream.height = 96, 64
        stream.pix_fmt = "yuv420p"
        stream.time_base = Fraction(1, 1000)
        for color, pts in enumerate((0, 40, 110, 150, 240, 280, 330, 390, 430, 500, 550, 610, 670, 720, 800)):
            frame = av.VideoFrame.from_ndarray(np.full((64, 96, 3), color * 12, dtype=np.uint8), format="rgb24")
            frame.pts = pts + start_pts
            frame.time_base = Fraction(1, 1000)
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)


class CommentaryVideoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2] / "tmp")
        self.root = Path(self.temp.name)
        self.video = self.root / "vfr.mkv"
        make_vfr_video(self.video)
        self.output = self.root / "out"
        self.tool = CommentaryVideo(self.video, self.output)

    def tearDown(self):
        self.temp.cleanup()

    def test_vfr_context_preserves_actual_decoded_times_and_window_selection(self):
        context = self.tool.context()
        self.assertEqual((context["width"], context["height"]), (96, 64))
        self.assertEqual(len(context["frames"]), 15)
        deltas = [round(context["frames"][i + 1]["time"] - context["frames"][i]["time"], 3) for i in range(3)]
        self.assertEqual(deltas, [0.04, 0.08, 0.04])
        result = self.tool.read_video_window({"startTime": 0, "endTime": .2, "fps": 10, "mode": "sheet"})
        self.assertTrue(result["details"]["frames"])
        self.assertEqual(result["details"]["frames"][0]["time"], context["frames"][0]["time"])
        self.assertEqual(result["details"]["frames"][0]["sourceTime"], context["frames"][0]["sourceTime"])

    def test_nonzero_source_pts_uses_relative_tool_time_and_original_source_time(self):
        offset_video = self.root / "offset.mkv"
        make_vfr_video(offset_video, start_pts=2000)
        tool = CommentaryVideo(offset_video, self.output)
        context = tool.context()
        self.assertEqual(context["frames"][0]["time"], 0)
        self.assertAlmostEqual(context["frames"][0]["sourceTime"], 2.0, places=3)
        result = tool.read_video_window({"startTime": 0, "endTime": .1, "fps": 10})
        self.assertEqual(result["details"]["frames"][0]["time"], 0)
        self.assertAlmostEqual(result["details"]["frames"][0]["sourceTime"], 2.0, places=3)
        self.assertGreaterEqual(context["duration"], context["frames"][-1]["time"])

    def test_sheet_pages_stop_at_six_tiles_and_keep_source_transform(self):
        original_sha = hashlib.sha256(self.video.read_bytes()).hexdigest()
        result = self.tool.read_video_window({"frames": list(range(15)), "mode": "sheet"})
        self.assertEqual(len(result["details"]["assets"]), 3)
        self.assertEqual([len(a["tiles"]) for a in result["details"]["assets"]], [6, 6, 3])
        self.assertEqual(len(result["details"]["frames"]), 15)
        tile = result["details"]["assets"][0]["tiles"][0]
        self.assertEqual(tile["crop"], [0, 0, 96, 64])
        self.assertEqual(tile["coordinateSpace"], "source_image_pixels")
        self.assertEqual(hashlib.sha256(self.video.read_bytes()).hexdigest(), original_sha)
        self.assertTrue(all(Path(a["path"]).parent == self.output for a in result["details"]["assets"]))

    def test_region_crop_metadata_is_in_source_coordinates_and_observations_are_bounded(self):
        observations = self.root / "observations.json"
        observations.write_text(json.dumps({"rawByPlayer": {"P2": [{"box": [10, 12, 35, 48]}] + [None] * 14}}), encoding="utf-8")
        tool = CommentaryVideo(self.video, self.output, observations)
        result = tool.inspect_region({"frames": [0], "box": [5, 6, 45, 50]})
        asset = result["details"]["assets"][0]
        self.assertEqual(asset["crop"], [5, 6, 45, 50])
        self.assertEqual(asset["sourceSize"], [96, 64])
        player = tool.inspect_region({"frames": [0], "entityId": "P2"})
        self.assertEqual(player["details"]["assets"][0]["crop"], [10, 12, 35, 48])
        found = tool.get_observations({"startTime": 0, "endTime": .1, "entityIds": ["P2", "P9"]})
        self.assertEqual([e["status"] for e in found["entities"]], ["observed", "unknown"])
        self.assertNotIn("rawByPlayer", found)

    def test_input_clip_nested_track_arrays_remain_unverified_candidates(self):
        base = CommentaryVideo(self.video, self.output)
        frames = []
        for i, row in enumerate(base._frames):
            detections = [[10, 12, 35, 48, track_id, .73, 2] for track_id in range(8, 48)]
            frames.append({"frame": i, "time": row["time"], "tracks": detections})
        observations = self.root / "input-clip.json"
        observations.write_text(json.dumps({"frames": frames}), encoding="utf-8")
        tool = CommentaryVideo(self.video, self.output, observations)
        result = tool.get_observations({"startTime": 0, "endTime": .1, "trackIds": [8]})
        self.assertEqual(result["sourceState"], "unverified")
        candidate = result["entities"][0]["frames"][0]
        self.assertEqual(candidate["box"], [10, 12, 35, 48])
        self.assertEqual(candidate["confidence"], .73)
        self.assertEqual(candidate["classId"], 2)
        self.assertEqual(candidate["identityState"], "unknown")
        crop = tool.inspect_region({"frames": [0], "trackId": 8})
        self.assertEqual(crop["details"]["assets"][0]["crop"], [10, 12, 35, 48])
        discovery = tool.get_observations({"startTime": 0, "endTime": tool.duration})
        discovered_ids = {candidate["trackId"] for frame in discovery["frames"] for candidate in frame["tracks"]}
        self.assertIn(8, discovered_ids)
        self.assertLessEqual(len(discovery["frames"]), 12)
        self.assertTrue(discovery["sampled"])
        self.assertLessEqual(max(len(frame["tracks"]) for frame in discovery["frames"]), 30)
        self.assertTrue(all(frame["tracksTruncated"] for frame in discovery["frames"]))
        specific = tool.get_observations({"startTime": 0, "endTime": tool.duration, "trackIds": [8]})
        self.assertLessEqual(len(specific["entities"][0]["frames"]), 12)
        self.assertTrue(specific["entities"][0]["sampled"])

    def test_request_limits_and_invalid_coordinates_are_rejected(self):
        with self.assertRaises(ValueError):
            self.tool.read_video_window({"frames": list(range(15)), "mode": "full"})
        with self.assertRaises(ValueError):
            self.tool.read_video_window({"startTime": 0, "endTime": 1, "fps": float("inf")})
        with self.assertRaises(ValueError):
            self.tool.inspect_region({"frames": [0], "box": [1, 2, 1, 4]})

    def test_empty_observation_selectors_discover_and_preserve_nonempty_selector(self):
        observations = self.root / "selector-observations.json"
        observations.write_text(json.dumps({"frames": [{"frame": 0, "tracks": [
            [10, 12, 35, 48, 8, .73, 2], [40, 12, 65, 48, 9, .73, 2],
        ]}]}), encoding="utf-8")
        tool = CommentaryVideo(self.video, self.output, observations)
        window = {"startTime": 0, "endTime": .1}
        discovery = tool.get_observations(window)
        for selectors in ({"entityIds": [], "trackIds": []}, {"entityIds": []}, {"trackIds": []}):
            with self.subTest(selectors=selectors):
                result = tool.get_observations({**window, **selectors})
                self.assertEqual(result, discovery)
                self.assertEqual([row["trackId"] for row in result["frames"][0]["tracks"]], [8, 9])
        for selectors in ({"entityIds": [], "trackIds": [8]}, {"entityIds": ["8"], "trackIds": []}):
            with self.subTest(selectors=selectors):
                result = tool.get_observations({**window, **selectors})
                self.assertEqual(len(result["entities"]), 1)
                self.assertEqual(result["entities"][0]["frames"][0]["trackId"], 8)
        for key in ("entityIds", "trackIds"):
            with self.assertRaises(ValueError):
                tool.get_observations({**window, key: ""})


if __name__ == "__main__":
    unittest.main()
