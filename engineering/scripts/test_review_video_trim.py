import tempfile
import unittest
from pathlib import Path
import json
import copy
import hashlib
from unittest.mock import patch
from review_video_trim import retained_ranges,trim_review_clip
from serve_player_review import validated_clip


class ReviewTrimTests(unittest.TestCase):
    def test_team_presentation_trim_keeps_group_hints_but_drops_full_parent_metrics(self):
        from review_video_trim import trim_tracking_metadata
        from fractions import Fraction
        source={'video_sha256':'parent','tracking_revision':'team-stable','tracking_fingerprint':'parent-fingerprint',
            'trackingMetadata':{'presentation':{'version':1,'source_records_unchanged':True,'default_stable':True,'policy':{'version':1}},
                'presentation_geometry_comparison':{'full_parent_count':99},'parent_tracking':{'tracks_sha256':'ancestor'}},
            'identitySuggestions':{'version':1,'method':'team','verified':False,'teamGrouping':{'version':1,'verified':False,'layout':'reserved_5_plus_5_v1'},
                'entities':[{'id':'P6','teamGroup':'B','teamHint':'white','bindings':[{'start':0,'end':4,'trackId':1}]}]}}
        records=[{'frame':i,'time':i*.04,'source_frame':parent,'source_time':parent*.04,'tracks':[[1,2,3,4,1,.9,2]]} for i,parent in enumerate([1,3,4])]
        result=trim_tracking_metadata(source,Path('child.mp4'),records,[0,.04,.08],Fraction(1,25),25,[1,3,4],[1],False)
        self.assertNotIn('presentation_geometry_comparison',result)
        self.assertFalse(result['presentation']['source_records_unchanged']);self.assertTrue(result['presentation']['source_geometry_unchanged'])
        self.assertEqual(result['parent_tracking']['variant'],'team-stable')
        hints=result['identitySuggestions'];self.assertFalse(hints['teamGrouping']['verified'])
        self.assertEqual(hints['entities'][0]['id'],'P6');self.assertEqual(hints['entities'][0]['teamGroup'],'B')
        self.assertEqual(hints['entities'][0]['bindings'],[{'start':0,'end':0,'trackId':1},{'start':1,'end':2,'trackId':1}])
        self.assertEqual(result['source_tracking_metadata'],source['trackingMetadata'])

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

    def test_short_trim_stops_source_decoding_at_last_retained_frame(self):
        import av
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / 'source.mp4'
            with av.open(str(video), 'w') as container:
                stream = container.add_stream('libx264', rate=10)
                stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
                for index in range(40):
                    frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), index * 5, np.uint8), format='rgb24')
                    for packet in stream.encode(frame): container.mux(packet)
                for packet in stream.encode(): container.mux(packet)
            with av.open(str(video)) as container:
                times = [float(frame.time) for frame in container.decode(video=0)]
            records = [{'frame': index, 'time': time, 'tracks': []} for index, time in enumerate(times)]
            opened = av.open
            decoded = []
            class CountedSource:
                def __init__(self, container): self.container = container
                def __enter__(self): return self
                def __exit__(self, *args): self.container.close()
                def __getattr__(self, name): return getattr(self.container, name)
                def decode(self, **kwargs):
                    for index, frame in enumerate(self.container.decode(**kwargs)):
                        decoded.append(index)
                        yield frame
            def counted_open(path, *args, **kwargs):
                container = opened(path, *args, **kwargs)
                return CountedSource(container) if Path(path) == video else container
            with patch.object(av, 'open', side_effect=counted_open):
                result = trim_review_clip({'video': video, 'payload': {'video_sha256': 'source', 'frames': records}},
                                          [{'start': 1, 'end': 2}, {'start': 5, 'end': 6}], root / 'cut')
            self.assertEqual(decoded, list(range(7)))
            child = json.loads(Path(result['tracks']).read_text())
            self.assertEqual([record['source_frame'] for record in child], [1, 2, 5, 6])
            self.assertEqual(result['sourceCuts'], [2])
            with av.open(result['video']) as container:
                self.assertEqual([float(frame.time) for frame in container.decode(video=0)], [record['time'] for record in child])

    def test_optimized_multirange_and_nested_trim_keep_model_and_visible_segment_suggestions(self):
        import av
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);video=root/'source.mp4';baseline=root/'baseline.json';optimized=root/'optimized.json'
            with av.open(str(video),'w') as container:
                stream=container.add_stream('libx264',rate=10);stream.width=64;stream.height=48;stream.pix_fmt='yuv420p'
                for index in range(8):
                    frame=av.VideoFrame.from_ndarray(np.full((48,64,3),index*25,dtype=np.uint8),format='rgb24')
                    for packet in stream.encode(frame):container.mux(packet)
                for packet in stream.encode():container.mux(packet)
            with av.open(str(video)) as container:
                times=[float(frame.time) for frame in container.decode(video=0)]
            digest=hashlib.sha256(video.read_bytes()).hexdigest()
            records=[{'frame':index,'time':time,
                'tracks':([[1,2,20,40,1,.9,2]] if index!=5 else [])+[[25,2,40,40,2,.8,2]],
                'pending_detections':[],'candidate_count':1 if index==5 else 2}
                for index,time in enumerate(times)]
            for path in [baseline,optimized]:path.write_text(json.dumps(records),encoding='utf-8')
            suggestions={'version':1,'method':'appearance_proposal','verified':False,'entities':[
                {'id':'P1','teamHint':'dark','bindings':[{'start':0,'end':7,'trackId':1}]},
                {'id':'P2','bindings':[{'start':3,'end':5,'trackId':2}]},
                {'id':'P3','bindings':[{'start':0,'end':7,'trackId':99}]}]}
            metadata={'video_sha256':digest,'frames':8,'frame_count':8,'model':'basketball-model.pt',
                'tracker':'BoT-SORT','weights_sha256':'d'*64,'parameters':{'confidence':.1},
                'decoded_pts_seconds':times,'video_start_seconds':times[0],'identity_verified':False,
                'statistics':{'unique_track_ids':[1,2,99]},'timing_seconds':{'inference':10},
                'identitySuggestions':suggestions}
            optimized.with_suffix('.meta.json').write_text(json.dumps(metadata),encoding='utf-8')
            sample={'id':'fixture','video':str(video),'tracks':str(baseline),'sourceCuts':[2,7],
                'trackingVariants':[{'id':'optimized','label':'篮球模型优化','tracks':str(optimized)}]}
            source_payload=json.loads(validated_clip(sample)['payloads']['optimized'])
            original_payload=copy.deepcopy(source_payload)
            result=trim_review_clip({'video':video,'payload':source_payload},
                                    [{'start':1,'end':2},{'start':4,'end':7}],root/'cut')
            child=json.loads(validated_clip({**result,'id':'cut'})['payloads']['original'])
            child_meta=child['trackingMetadata']
            self.assertEqual(child_meta.get('model'),'basketball-model.pt')
            self.assertEqual(child_meta['tracker'],'BoT-SORT')
            self.assertEqual(child_meta['weights_sha256'],'d'*64)
            self.assertEqual(child_meta['parameters'],{'confidence':.1})
            self.assertEqual(child_meta['video_sha256'],result['videoSha256'])
            self.assertNotEqual(child_meta['video_sha256'],digest)
            self.assertEqual(child_meta['frames'],6);self.assertEqual(child_meta['frame_count'],6)
            self.assertEqual(child_meta['decoded_pts_seconds'],[frame['time'] for frame in child['frames']])
            self.assertEqual(child_meta['video_start_seconds'],child['frames'][0]['time'])
            self.assertEqual(child_meta['source_audio'],[])
            self.assertEqual(child_meta['source_tracking_revision'],'optimized')
            self.assertEqual(child_meta['source_tracking_fingerprint'],source_payload['tracking_fingerprint'])
            self.assertEqual(child_meta['source_tracking_metadata'],metadata)
            self.assertNotIn('statistics',child_meta);self.assertNotIn('timing_seconds',child_meta)
            self.assertEqual(child['sourceCuts'],[1,2,5])
            self.assertEqual(child['variants'][0]['label'],'篮球模型优化 · 人工剪辑候选')
            self.assertEqual(child['identitySuggestions']['entities'],[
                {'id':'P1','teamHint':'dark','bindings':[{'start':0,'end':0,'trackId':1},
                    {'start':1,'end':1,'trackId':1},{'start':2,'end':2,'trackId':1},
                    {'start':4,'end':4,'trackId':1},{'start':5,'end':5,'trackId':1}]},
                {'id':'P2','bindings':[{'start':2,'end':3,'trackId':2}]}])
            self.assertFalse(child['identitySuggestions']['verified'])
            self.assertEqual(source_payload,original_payload)
            second=trim_review_clip({'video':result['video'],'payload':child},
                                    [{'start':0,'end':2},{'start':4,'end':5}],root/'cut-again')
            nested=json.loads(validated_clip({**second,'id':'nested'})['payloads']['original'])
            self.assertEqual([frame['source_frame'] for frame in nested['frames']],[1,2,4,6,7])
            self.assertEqual(nested['sourceCuts'],[1,2,3,4])
            self.assertEqual(nested['trackingMetadata']['frames'],5)
            self.assertEqual(nested['trackingMetadata']['origin_tracking_revision'],'optimized')
            self.assertEqual(nested['trackingMetadata']['origin_tracking_fingerprint'],source_payload['tracking_fingerprint'])
            self.assertEqual(nested['identitySuggestions']['entities'],[
                {'id':'P1','teamHint':'dark','bindings':[{'start':0,'end':0,'trackId':1},
                    {'start':1,'end':1,'trackId':1},{'start':2,'end':2,'trackId':1},
                    {'start':3,'end':3,'trackId':1},{'start':4,'end':4,'trackId':1}]},
                {'id':'P2','bindings':[{'start':2,'end':2,'trackId':2}]}])
            self.assertEqual(nested['trackingMetadata']['source_tracking_metadata'],child_meta)
            self.assertFalse(nested['identitySuggestions']['verified'])
            with av.open(second['video']) as container:
                self.assertFalse(container.streams.audio)
                self.assertEqual([float(frame.time) for frame in container.decode(video=0)],
                                 nested['trackingMetadata']['decoded_pts_seconds'])


if __name__=='__main__':unittest.main()
