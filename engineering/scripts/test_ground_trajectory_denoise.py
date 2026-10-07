import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ground_trajectory_denoise import denoise_player


def path(xs, *, step=0.04):
    return [{"frame": i, "time": i * step, "x": x, "y": 0.0, "source": "projected", "locked": False}
            for i, x in enumerate(xs)]


class DenoisePlayerTests(unittest.TestCase):
    def test_removes_isolated_spike_and_smooths_small_jitter(self):
        xs = [i * 0.04 + (0.025 if i % 2 else -0.025) for i in range(31)]
        xs[15] += 4.0
        result = denoise_player(path(xs))
        points = result["points"]
        self.assertIn(15, result["diagnostics"]["outlierFrames"])
        self.assertLess(abs(points[15]["x"] - 15 * 0.04), 0.15)
        self.assertLess(sum(p["displacement"] for p in points) / len(points), 0.25)
        self.assertTrue(all(p["source"] == "projected" for p in points))

    def test_preserves_rapid_reversal_direction_and_does_not_lag(self):
        # The apex is a real stop/turn, supported by a sustained reversal after it.
        xs = [i * 0.12 for i in range(11)] + [1.2 - j * 0.12 for j in range(1, 11)]
        result = denoise_player(path(xs, step=0.04), config={"profile": "balanced"})
        smooth = [p["x"] for p in result["points"]]
        self.assertGreater(smooth[10], smooth[9])
        self.assertLess(smooth[11], smooth[10])
        self.assertLess(abs(smooth[10] - 1.2), 0.18)
        self.assertGreater(result["diagnostics"]["turnWindowReductions"], 0)

    def test_static_micro_jitter_does_not_trigger_turn_windows(self):
        points = [{"frame": i, "time": i / 30, "x": (-1) ** i * 0.03,
                   "y": (-1) ** (i // 3) * 0.02, "source": "projected", "locked": False}
                  for i in range(60)]
        macro = denoise_player(points, config={"profile": "balanced", "turn_mode": "macro"})
        adjacent = denoise_player(points, config={"profile": "balanced", "turn_mode": "adjacent"})
        def path_length(rows):
            return sum(((b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2) ** 0.5
                       for a, b in zip(rows, rows[1:]))
        self.assertEqual(macro["diagnostics"]["turnWindowReductions"], 0)
        self.assertGreater(adjacent["diagnostics"]["turnWindowReductions"], 0)
        self.assertLess(path_length(macro["points"]), path_length(adjacent["points"]) * 0.5)

    def test_nulls_cuts_and_timeline_are_preserved(self):
        points = path([0.0, 0.2, 0.4, 10.0, 10.2, 10.4])
        points[2].update(x=None, y=None, source="missing")
        result = denoise_player(points, cuts=[4])
        output = result["points"]
        self.assertEqual([(p["frame"], p["time"]) for p in output], [(p["frame"], p["time"]) for p in points])
        self.assertIsNone(output[2]["x"])
        self.assertEqual(output[2]["processedState"], "missing")
        self.assertEqual(result["diagnostics"]["segments"], 3)
        # Segment after cut cannot pull the first point of that segment toward frame 3.
        self.assertGreater(output[4]["x"], 9.0)

    def test_break_before_splits_binding_without_changing_source_or_filling_gaps(self):
        points = path([0.0, 0.1, 0.2, 10.0, 10.1, 10.2])
        points[3]["breakBefore"] = True
        points[5].update(x=None, y=None, source="missing")
        result = denoise_player(points)
        output = result["points"]
        self.assertEqual(result["diagnostics"]["segments"], 2)
        self.assertLess(output[2]["x"], 1.0)
        self.assertGreater(output[3]["x"], 9.0)
        self.assertEqual(output[3]["rawX"], 10.0)
        self.assertTrue(output[3]["breakBefore"])
        self.assertIsNone(output[5]["x"])
        self.assertIsNone(output[5]["y"])

    def test_short_segment_keeps_turn_shape_but_repairs_only_extreme_supported_spike(self):
        turn = denoise_player(path([0.0, 0.3, 0.6, 0.2, 0.1]))
        self.assertEqual([p["x"] for p in turn["points"]], [0.0, 0.3, 0.6, 0.2, 0.1])
        self.assertTrue(all(p["method"] == "short_segment" for p in turn["points"]))

        spike = denoise_player(path([0.0, 0.1, 4.0, 0.3, 0.4]))
        self.assertIn(2, spike["diagnostics"]["outlierFrames"])
        self.assertAlmostEqual(spike["points"][2]["x"], 0.2, places=6)
        self.assertEqual(spike["points"][0]["x"], 0.0)
        self.assertEqual(spike["points"][4]["x"], 0.4)

    def test_locked_point_stays_exact_and_anchor_is_soft_high_weight(self):
        points = path([0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2])
        points[3]["locked"] = True
        anchors = [{"frame": 4, "x": 2.0, "y": 0.0, "basis": "feet visible", "evidenceFrames": [4]}]
        output = denoise_player(points, anchors=anchors)["points"]
        self.assertEqual((output[3]["x"], output[3]["y"]), (0.6, 0.0))
        self.assertGreater(output[4]["x"], output[3]["x"] + 0.2)
        self.assertEqual(output[4]["source"], "projected")


if __name__ == "__main__":
    unittest.main()
