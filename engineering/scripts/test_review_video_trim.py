import tempfile
import unittest
from pathlib import Path
import json
from review_video_trim import retained_ranges,trim_review_clip


class ReviewTrimTests(unittest.TestCase):
    def test_ranges_merge_without_changing_chronology(self):
        self.assertEqual(retained_ranges([{'start':6,'end':7},{'start':1,'end':3},{'start':3,'end':4}],8),[{'start':1,'end':4},{'start':6,'end':7}])

    def test_invalid_ranges_rejected_before_encoding(self):
        for ranges in [[],[{'start':-1,'end':3}],[{'start':True,'end':3}],[{'start':5,'end':4}],[{'start':0,'end':8}]]:
            with self.assertRaises(ValueError):retained_ranges(ranges,8)

    def test_real_cut_keeps_video_proposals_lineage_and_boundaries_together(self):
        import av
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);video=root/'source.mp4'
            with av.open(str(video),'w') as c:
                s=c.add_stream('libx264',rate=10);s.width=64;s.height=48;s.pix_fmt='yuv420p'
                for i in range(8):
                    frame=av.VideoFrame.from_ndarray(np.full((48,64,3),i*25,dtype=np.uint8),format='rgb24')
                    for packet in s.encode(frame):c.mux(packet)
                for packet in s.encode():c.mux(packet)
            with av.open(str(video)) as c:times=[float(f.time) for f in c.decode(video=0)]
            records=[dict(frame=i,time=t,tracks=[[1,2,3,4,100+i,.9,0]]) for i,t in enumerate(times)]
            source={'video':video,'payload':{'video_sha256':'root-hash','frames':records,'sourceCuts':[6]}}
            result=trim_review_clip(source,[{'start':1,'end':2},{'start':5,'end':7}],root/'cut')
            data=json.loads(Path(result['tracks']).read_text());self.assertEqual([r['frame'] for r in data],list(range(5)))
            self.assertEqual([r['source_frame'] for r in data],[1,2,5,6,7]);self.assertEqual(result['sourceCuts'],[2,3])
            self.assertEqual([r['tracks'][0][4] for r in data],[101,102,105,106,107])
            with av.open(result['video']) as c:
                out_times=[float(f.time) for f in c.decode(video=0)];self.assertFalse(c.streams.audio)
            self.assertEqual([r['time'] for r in data],out_times)
            nested={'video':result['video'],'payload':{'video_sha256':result['videoSha256'],'source_video_sha256':'root-hash','frames':data,'sourceCuts':result['sourceCuts']}}
            second=trim_review_clip(nested,[{'start':1,'end':4}],root/'cut-again')
            next_data=json.loads(Path(second['tracks']).read_text());self.assertEqual([r['source_frame'] for r in next_data],[2,5,6,7])
            self.assertEqual(second['sourceVideoSha256'],'root-hash');self.assertEqual(second['sourceCuts'],[1,2])

    def test_variable_frame_times_are_preserved_inside_each_retained_range(self):
        import av
        import numpy as np
        from fractions import Fraction
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);video=root/'variable.mp4'
            with av.open(str(video),'w') as c:
                s=c.add_stream('libx264',rate=10);s.width=64;s.height=48;s.pix_fmt='yuv420p';s.codec_context.time_base=Fraction(1,1000)
                for i,pts in enumerate([0,100,300,400,700]):
                    frame=av.VideoFrame.from_ndarray(np.full((48,64,3),i*30,dtype=np.uint8),format='rgb24');frame.pts=pts;frame.time_base=Fraction(1,1000)
                    for packet in s.encode(frame):c.mux(packet)
                for packet in s.encode():c.mux(packet)
            with av.open(str(video)) as c:times=[float(f.time) for f in c.decode(video=0)]
            records=[dict(frame=i,time=t,tracks=[]) for i,t in enumerate(times)]
            result=trim_review_clip({'video':video,'payload':{'video_sha256':'variable','frames':records}},[{'start':1,'end':4}],root/'cut')
            data=json.loads(Path(result['tracks']).read_text());out=[r['time'] for r in data]
            for expected,actual in zip([t-times[1] for t in times[1:]],out):self.assertAlmostEqual(expected,actual,places=3)


if __name__=='__main__':unittest.main()
