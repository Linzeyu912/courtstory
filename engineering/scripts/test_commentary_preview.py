import unittest
from render_commentary_preview import make_timeline, source_at, active_cue


class CommentaryPreviewTests(unittest.TestCase):
    def test_hold_extends_preview_but_keeps_source_time_and_following_cues(self):
        cues=[dict(cueId='pause',delivery='pause',text='这是一段暂停讲解',suggestedStartTime=2,suggestedEndTime=3),dict(cueId='later',delivery='during_play',text='随后进球',suggestedStartTime=4,suggestedEndTime=5)]
        segments=make_timeline(6,cues,[i/10 for i in range(61)])
        self.assertEqual(segments[1]['sourceStart'],2.5)
        self.assertEqual(segments[-1]['previewEnd'],10)
        source,segment=source_at(segments,5)
        self.assertEqual(source,2.5)
        self.assertEqual(active_cue(cues,source,segment)['cueId'],'pause')
        source,segment=source_at(segments,8.2)
        self.assertAlmostEqual(source,4.2)
        self.assertEqual(active_cue(cues,source,segment)['cueId'],'later')

    def test_no_pause_preserves_timeline(self):
        segments=make_timeline(6,[],[0,1,2,3,4,5])
        self.assertEqual(source_at(segments,3)[0],3)
        self.assertEqual(segments[-1]['previewEnd'],6)


if __name__=='__main__':unittest.main()
