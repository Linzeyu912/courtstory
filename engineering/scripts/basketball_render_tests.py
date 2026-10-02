"""Display and timing regressions for the unverified fixed-slot preview."""
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from basketball_render import aliases_for_frame, draw_candidates, resolve_ffmpeg, validate_media_signatures


class FFmpegLocationTests(unittest.TestCase):
    def test_explicit_path_wins_and_missing_explicit_does_not_silently_fallback(self):
        explicit = Path("explicit-ffmpeg.exe").resolve()
        with patch("basketball_render.shutil.which") as which, patch.object(Path, "is_file", return_value=True):
            self.assertEqual(resolve_ffmpeg(explicit), explicit)
            which.assert_not_called()
        with patch("basketball_render.shutil.which") as which, patch.object(Path, "is_file", return_value=False):
            with self.assertRaisesRegex(FileNotFoundError, "指定的 FFmpeg 文件不存在"):
                resolve_ffmpeg(explicit)
            which.assert_not_called()

    def test_path_precedes_the_repository_fallback(self):
        executable = Path("installed-ffmpeg.exe").resolve()
        with patch("basketball_render.shutil.which", return_value=str(executable)) as which:
            self.assertEqual(resolve_ffmpeg(), executable)
            which.assert_called_once_with("ffmpeg")

    def test_repository_fallback_and_actionable_missing_message(self):
        import basketball_render
        fallback = Path(basketball_render.__file__).resolve().parents[2] / "tmp/tactics-ffmpeg.exe"
        with patch("basketball_render.shutil.which", return_value=None), patch.object(Path, "is_file", return_value=True):
            self.assertEqual(resolve_ffmpeg(), fallback)
        with patch("basketball_render.shutil.which", return_value=None), patch.object(Path, "is_file", return_value=False):
            with self.assertRaisesRegex(FileNotFoundError, "PATH.*tmp/tactics-ffmpeg.exe.*--ffmpeg"):
                resolve_ffmpeg()


class PreviewTests(unittest.TestCase):
    def suggestion(self):
        return {"verified": False, "entities": [{"id": "P3", "bindings": [
            {"start": 0, "end": 1, "trackId": 25}, {"start": 4, "end": 5, "trackId": 25}]}]}

    def test_alias_only_exists_inside_observed_binding_and_without_review_conflict(self):
        self.assertEqual(aliases_for_frame(self.suggestion(), {"frame": 1}), {25: 3})
        self.assertEqual(aliases_for_frame(self.suggestion(), {"frame": 2}), {})
        self.assertEqual(aliases_for_frame(self.suggestion(), {"frame": 4, "track_evidence": {
            "25": {"identity_review_required": True}}}), {})

    def test_unassigned_candidate_never_displays_internal_id_in_fixed_preview(self):
        record = {"frame": 2, "time": .2, "tracks": [[30, 60, 80, 190, 25, .8, 2]],
                  "pending_detections": []}
        with patch("basketball_render.cv2.putText", side_effect=lambda image, *args: image) as draw:
            draw_candidates(np.zeros((240, 320, 3), np.uint8), record, "optimized", aliases={})
        labels = [str(call.args[1]) for call in draw.call_args_list]
        self.assertTrue(any(label.startswith("pending") for label in labels))
        self.assertFalse(any(label.startswith("T25") for label in labels))

    def test_media_validation_rejects_deleted_frame_shift_and_audio_payload_change(self):
        source = {"pts_seconds": [.12, .16, .20], "width": 320, "height": 240,
                  "audio": [{"codec": "aac", "packet_sha256": "original", "start_seconds": 0., "duration_seconds": .3}]}
        self.assertEqual(validate_media_signatures(source, source), [])
        for changed in ({**source, "pts_seconds": [.12, .16]},
                        {**source, "pts_seconds": [.0, .04, .08]},
                        {**source, "audio": [{**source["audio"][0], "packet_sha256": "changed"}]}):
            self.assertTrue(validate_media_signatures(source, changed))


if __name__ == "__main__":
    unittest.main()
