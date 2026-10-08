import unittest
from pathlib import Path
import shutil
import subprocess
import tempfile

import av
import numpy as np
from fractions import Fraction

from render_commentary_narration import (build_timeline, source_at, render_video,
                                         mux_audio, convert_cues)
from commentary_video import CommentaryVideo


class CommentaryNarrationTimelineTests(unittest.TestCase):
    def test_pause_length_uses_audio_duration_and_shifts_later_source_mapping(self):
        cues = [
            dict(cueId='pause', delivery='pause', text='暂停说明', suggestedStartTime=2, suggestedEndTime=4),
            dict(cueId='later', delivery='during_play', text='后续说明', suggestedStartTime=5, suggestedEndTime=6),
        ]
        audio = [dict(cueId='pause', durationSeconds=3.2), dict(cueId='later', durationSeconds=.7)]
        segments, placed = build_timeline(8, cues, audio, [i/10 for i in range(81)])
        hold = next(s for s in segments if s.get('cueId') == 'pause')
        self.assertAlmostEqual(hold['previewEnd']-hold['previewStart'], 3.7)
        self.assertAlmostEqual(placed[0]['previewEnd']-placed[0]['previewStart'], 3.2)
        source, segment = source_at(segments, hold['previewEnd']+.5)
        self.assertAlmostEqual(source, 3.5)
        self.assertEqual(segment['kind'], 'play')
        rows = convert_cues(cues, segments, placed)
        self.assertNotIn('holdSourceTime', rows[1])

    def test_overlong_during_play_becomes_sequential_hold_without_truncation(self):
        cues = [
            dict(cueId='long', delivery='during_play', text='长句', suggestedStartTime=1, suggestedEndTime=2),
            dict(cueId='next', delivery='during_play', text='下一句', suggestedStartTime=2, suggestedEndTime=3),
        ]
        audio = [dict(cueId='long', durationSeconds=4), dict(cueId='next', durationSeconds=.5)]
        segments, placed = build_timeline(5, cues, audio, [i/10 for i in range(51)])
        hold = next(s for s in segments if s.get('cueId') == 'long')
        self.assertTrue(hold['fallback'])
        self.assertAlmostEqual(placed[0]['previewEnd']-placed[0]['previewStart'], 4)
        self.assertGreaterEqual(placed[1]['previewStart'], placed[0]['previewEnd'])
        self.assertEqual(len(placed), 2)

    def test_local_test_tone_renders_with_silent_source_video(self):
        """Use a synthetic tone fixture only; this is not a TTS sample."""
        ffmpeg = shutil.which('ffmpeg')
        font = Path('C:/Windows/Fonts/msyh.ttc')
        if not ffmpeg or not font.is_file():
            self.skipTest('FFmpeg or the Windows CJK font is unavailable')
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]/'tmp') as folder:
            root = Path(folder)
            source = root/'fixture.mkv'
            wav = root/'synthetic-test-tone.wav'
            silent = root/'silent.mp4'
            output = root/'finished.mp4'
            # Two-second synthetic 320x180 source, deliberately with no audio stream.
            with av.open(str(source), 'w', format='matroska') as container:
                stream = container.add_stream('ffv1', rate=30)
                stream.width, stream.height, stream.pix_fmt = 320, 180, 'yuv420p'
                for i in range(60):
                    frame = av.VideoFrame(320, 180, 'yuv420p')
                    frame.pts=i; frame.time_base=Fraction(1, 30)
                    for packet in stream.encode(frame): container.mux(packet)
                for packet in stream.encode(): container.mux(packet)
            subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.7',
                            '-ac', '1', '-ar', '24000', str(wav)], check=True)
            cue = dict(cueId='test-pause', delivery='pause', text='这是本地合成测试音，不是 TTS 成片。',
                       suggestedStartTime=.4, suggestedEndTime=.8)
            audio = [dict(cueId='test-pause', durationSeconds=.7, _absolute=str(wav))]
            segments, placements = build_timeline(2, [cue], audio, [i/30 for i in range(61)])
            duration = segments[-1]['previewEnd']
            render_video(source, silent, [cue], segments, placements, duration, font, root/'cache')
            mux_audio(silent, output, source, audio, placements, segments, duration, 0, ffmpeg)
            row = convert_cues([cue], segments, placements)[0]
            self.assertAlmostEqual(row['previewStart'], placements[0]['previewStart'])
            self.assertAlmostEqual(row['previewEnd'], placements[0]['previewEnd'])
            self.assertAlmostEqual(row['holdSourceTime'], .6, delta=.04)
            with av.open(str(output)) as result:
                self.assertEqual((result.streams.video[0].width, result.streams.video[0].height), (320, 180))
                self.assertTrue(result.streams.audio)
                self.assertAlmostEqual(float(result.duration/av.time_base), duration, delta=.15)

    def test_source_audio_with_nonzero_pts_is_trimmed_from_video_start(self):
        """Exercise audio trimming where both original streams start at PTS 2s."""
        ffmpeg = shutil.which('ffmpeg')
        font = Path('C:/Windows/Fonts/msyh.ttc')
        if not ffmpeg or not font.is_file():
            self.skipTest('FFmpeg or the Windows CJK font is unavailable')
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]/'tmp') as folder:
            root=Path(folder); source=root/'offset.mkv'; wav=root/'synthetic-test-tone.wav'
            silent=root/'silent.mp4'; output=root/'finished.mp4'
            subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y',
                '-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=1.5',
                '-f','lavfi','-i','sine=frequency=330:duration=1.5',
                '-filter_complex','[0:v]setpts=PTS+2/TB[v];[1:a]asetpts=PTS+2/TB[a]',
                '-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p',
                '-c:a','pcm_s16le','-shortest',str(source)],check=True)
            subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y',
                            '-f','lavfi','-i','sine=frequency=440:duration=0.3',
                            '-ac','1','-ar','24000',str(wav)],check=True)
            ctx=CommentaryVideo(source,root/'index-cache').context()
            self.assertAlmostEqual(ctx['sourceStartTime'],2.0,delta=.05)
            cue=dict(cueId='offset-pause',delivery='pause',text='本地合成测试音',
                     suggestedStartTime=.2,suggestedEndTime=.6)
            audio=[dict(cueId=cue['cueId'],durationSeconds=.3,_absolute=str(wav))]
            segments,placements=build_timeline(ctx['duration'],[cue],audio,
                                                [f['time'] for f in ctx['frames']])
            duration=segments[-1]['previewEnd']
            render_video(source,silent,[cue],segments,placements,duration,font,root/'frames')
            mux_audio(silent,output,source,audio,placements,segments,duration,
                      ctx['sourceStartTime'],ffmpeg)
            with av.open(str(output)) as result:
                self.assertTrue(result.streams.audio)
                self.assertAlmostEqual(float(result.duration/av.time_base),duration,delta=.15)

    def test_nonzero_pts_trim_selects_later_frequency_segment(self):
        """Prove a 1.2s source trim selects 880 Hz, not the opening 220 Hz tone."""
        ffmpeg=shutil.which('ffmpeg'); font=Path('C:/Windows/Fonts/msyh.ttc')
        if not ffmpeg or not font.is_file():
            self.skipTest('FFmpeg or the Windows CJK font is unavailable')
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]/'tmp') as folder:
            root=Path(folder); source=root/'two-tone-offset.mkv'; silent=root/'silent.mp4'; output=root/'trimmed.mp4'
            subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y',
                '-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=2',
                '-f','lavfi','-i','sine=frequency=220:duration=1',
                '-f','lavfi','-i','sine=frequency=880:duration=1',
                '-filter_complex','[0:v]setpts=PTS+2/TB[v];[1:a][2:a]concat=n=2:v=0:a=1,asetpts=PTS+2/TB[a]',
                '-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p',
                '-c:a','pcm_s16le','-shortest',str(source)],check=True)
            ctx=CommentaryVideo(source,root/'index-cache').context()
            self.assertAlmostEqual(ctx['sourceStartTime'],2.0,delta=.05)
            duration=.6
            segments=[dict(kind='play',sourceStart=1.2,sourceEnd=1.8,previewStart=0.,previewEnd=duration)]
            render_video(source,silent,[],segments,[],duration,font,root/'frames')
            mux_audio(silent,output,source,[],[],segments,duration,ctx['sourceStartTime'],ffmpeg)
            with av.open(str(output)) as result:
                audio_stream=result.streams.audio[0]
                chunks=[frame.to_ndarray() for frame in result.decode(audio=0)]
                samples=np.concatenate(chunks,axis=1).astype(np.float64)
                mono=samples.mean(axis=0)
                rate=audio_stream.rate
                mono=mono[int(.05*rate):int(.55*rate)]
                spectrum=np.abs(np.fft.rfft(mono*np.hanning(len(mono))))
                frequencies=np.fft.rfftfreq(len(mono),1/rate)
                peak=frequencies[int(np.argmax(spectrum))]
                self.assertGreater(peak,700)


if __name__ == '__main__':
    unittest.main()
