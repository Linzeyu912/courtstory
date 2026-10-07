import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock,Mock,patch
from identity_ocr import (IdentityOCR,OCRUnavailable,jersey_number,team_codes,
                          scoreboard_region,validate_request,validate_team_vision_output,validate_player_vision_output)

class IdentityOCRTests(unittest.TestCase):
    def test_player_vision_reads_exact_selected_crop_and_preserves_unknown_identity(self):
        import av
        from PIL import Image
        payload={'video_sha256':'v','tracking_fingerprint':'fp','width':100,'height':100,
                 'frames':[{'time':0,'tracks':[[1,2,40,90,60,.9,0]]}]}
        row={'frame':0,'trackId':60,'box':[1,2,40,90]}
        request={'videoSha256':'v','mode':'player_vision','observations':[row],'teams':['HOU','DAL']}
        picture=Mock(time=0);picture.to_image.return_value=Image.new('RGB',(100,100))
        container=MagicMock();container.__enter__.return_value.decode.return_value=[picture]
        provider=Mock();provider.status.return_value={'available':True}
        provider.generate.return_value={'team':'HOU','jersey':'00','reason':'visible jersey','confidence':.8}
        with tempfile.TemporaryDirectory() as folder,patch.object(av,'open',return_value=container):
            result=IdentityOCR(provider,folder).recognize('video.mp4',payload,request)
            args=provider.generate.call_args.kwargs
            with Image.open(args['images'][1]) as image:self.assertEqual(image.size,(39,88))
            self.assertEqual(result['observation'],row);self.assertEqual(result['reading']['jersey'],'00')
            self.assertFalse(result['identityConfirmed']);self.assertTrue(result['reviewRequired'])
            self.assertIn('不根据姓名猜号码',args['prompt'])
        for field,value in [('team','BOS'),('jersey','100'),('jersey','O'),('confidence',float('nan'))]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                validate_player_vision_output({**provider.generate.return_value,field:value},['HOU','DAL'])

    def test_player_vision_requires_the_selected_raw_track_box(self):
        payload={'video_sha256':'v','frames':[{'time':0,'tracks':[[1,2,40,90,60,.9,0]]}],'width':100,'height':100}
        request={'videoSha256':'v','mode':'player_vision','observations':[{'frame':0,'trackId':60,'box':[1,2,40,90]}],'teams':['DAL','HOU']}
        self.assertEqual(validate_request(request,payload)[0],'player_vision')
        for change in ({'observations':[{'frame':0,'trackId':7,'box':[1,2,40,90]}]},
                       {'observations':[{'frame':0,'trackId':60,'box':[2,2,40,90]}]}, {'teams':['DAL','XXX']}, {'model':'other'}):
            with self.assertRaises(ValueError):validate_request({**request,**change},payload)

    def test_numbers_are_exact_strings(self):
        self.assertEqual(jersey_number(' 00 '),'00')
        self.assertEqual(jersey_number('0'),'0')
        for text in ('O','123','12:30','#3','1-2','３'):
            self.assertIsNone(jersey_number(text))

    def test_scoreboard_aliases_do_not_match_substrings(self):
        self.assertEqual(team_codes('SA 91 MIAMI 90'),['MIA','SAS'])
        self.assertEqual(team_codes('GSW 103 MEM 102'),['GSW','MEM'])
        self.assertEqual(team_codes('WASABI'),[])

    def test_request_is_bound_to_video_and_unique_valid_frames(self):
        payload={'video_sha256':'v','frames':[{'time':0}],'width':100,'height':100}
        req={'videoSha256':'v','mode':'jersey','observations':[{'frame':0,'box':[1,1,50,90],'trackId':3}]}
        before=copy.deepcopy(req);self.assertEqual(validate_request(req,payload)[0],'jersey');self.assertEqual(req,before)
        validate_request({**req,'observations':[{'frame':0,'box':[-3,1,101,105]}]},payload)
        for change in ({'videoSha256':'wrong'},{'observations':req['observations']*2},{'observations':[{'frame':0,'box':[101,1,140,90]}]},{'observations':[{'frame':True}]}):
            with self.assertRaises(ValueError):validate_request({**req,**change},payload)

    def recognize_records(self,records,mode='scoreboard',region=None):
        try:
            import av
            import cv2
            import numpy as np
        except ImportError as error:
            self.skipTest('OCR crop dependencies unavailable: '+str(error))
        payload={'video_sha256':'v','tracking_fingerprint':'t','frames':[{'time':0}],
                 'width':100,'height':100}
        picture=Mock(time=0)
        picture.to_ndarray.return_value=np.zeros((100,100,3),dtype=np.uint8)
        container=MagicMock()
        container.__enter__.return_value.decode.return_value=[picture]
        ocr=IdentityOCR();ocr.engine=Mock(return_value=(records,None))
        row={'frame':0,**({'box':[5,5,95,95],'trackId':3} if mode=='jersey' else {})}
        before=copy.deepcopy(records)
        request={'videoSha256':'v','mode':mode,'observations':[row]}
        if region is not None:request['scoreboardRegion']=region
        with patch.object(av,'open',return_value=container):
            result=ocr.recognize('unused.mp4',payload,request)
        self.assertEqual(records,before)
        if mode=='scoreboard':
            x1,y1,x2,y2=result['scoreboardRegion']
            self.assertEqual(ocr.engine.call_args.args[0].shape[:2],(y2-y1,x2-x1))
        self.assertFalse(result['identityConfirmed'])
        self.assertTrue(result['reviewRequired'])
        return result

    def test_recognize_accepts_rapidocr_string_confidence_without_changing_text(self):
        polygon=[[1,1],[20,1],[20,10],[1,10]]
        result=self.recognize_records([[polygon,' Pacers ','0.8734'],[polygon,'IND',.7],
                                       [polygon,'WAS','0.5499']])
        self.assertEqual(result['status'],'candidate')
        self.assertEqual(result['scannedFrames'],1)
        self.assertEqual([c['value'] for c in result['candidates']],['IND'])
        candidate=result['candidates'][0]
        self.assertEqual(candidate['score'],.8734)
        self.assertEqual(candidate['evidence'][0]['text'],' Pacers ')
        self.assertEqual(candidate['evidence'][0]['polygon'],[[1.,89.],[20.,89.],[20.,98.],[1.,98.]])
        self.assertEqual(result['scoreboardRegion'],[0,88,55,100])

    def test_scoreboard_region_is_explicit_validated_and_used_for_evidence(self):
        polygon=[[1,1],[20,1],[20,10],[1,10]]
        result=self.recognize_records([[polygon,'IND','0.9']],region=[10,70,50,99])
        self.assertEqual(result['scoreboardRegion'],[10,70,50,99])
        self.assertEqual(result['candidates'][0]['evidence'][0]['polygon'],
                         [[11.,71.],[30.,71.],[30.,80.],[11.,80.]])
        payload={'video_sha256':'v','frames':[{'time':0}],'width':100,'height':100}
        request={'videoSha256':'v','mode':'scoreboard','observations':[{'frame':0}]}
        for region in ([0,0,101,30],[-1,0,30,30],[5,5,5,30],[0,0,5,30],
                       [0,float('nan'),30,30],[0,True,30,30],['0',0,30,30],{}):
            with self.subTest(region=region),self.assertRaises(ValueError):
                validate_request({**request,'scoreboardRegion':region},payload)
        self.assertEqual(scoreboard_region(payload,[10.2,70.2,50.1,99.1]),[10,70,51,100])

    def test_recognize_rejects_invalid_or_nonfinite_confidence(self):
        polygon=[[1,1],[20,1],[20,10],[1,10]]
        for score in ('NaN','inf','-inf','confidence:0.9','',None,True,{},-0.1,1.1,
                      float('nan'),float('inf')):
            with self.subTest(score=score):
                result=self.recognize_records([[polygon,'IND',score]])
                self.assertEqual(result['status'],'no_reading')
                self.assertEqual(result['candidates'],[])

    def test_jersey_recognition_keeps_exact_numbers_and_threshold(self):
        polygon=[[1,1],[20,1],[20,10],[1,10]]
        result=self.recognize_records([[polygon,'00','0.55'],[polygon,'0',.9],
                                       [polygon,'O','0.99'],[polygon,'#3','0.99'],
                                       [polygon,'12:30','0.99']],mode='jersey')
        self.assertEqual(result['status'],'multiple_candidates')
        self.assertEqual({c['value'] for c in result['candidates']},{'00','0'})

    def recognize_vision(self,output):
        try:
            import av
            from PIL import Image
        except ImportError as error:
            self.skipTest('Vision frame dependencies unavailable: '+str(error))
        payload={'video_sha256':'v','tracking_fingerprint':'t','frames':[{'time':0}],
                 'width':100,'height':100}
        request={'videoSha256':'v','mode':'scoreboard_vision','observations':[{'frame':0}]}
        picture=Mock(time=0);picture.to_image.return_value=Image.new('RGB',(100,100))
        container=MagicMock();container.__enter__.return_value.decode.return_value=[picture]
        provider=Mock();provider.status.return_value={'available':True,'provider':'codex-cli',
                                                       'model':'trusted-model','reasoningEffort':'low'}
        provider.generate.return_value=copy.deepcopy(output)
        before=copy.deepcopy((payload,request))
        with tempfile.TemporaryDirectory() as folder:
            ocr=IdentityOCR(vision_provider=provider,vision_folder=folder)
            with patch.object(av,'open',return_value=container):
                result=ocr.recognize('untrusted-original-name.mp4',payload,request)
            self.assertIsNone(ocr.engine)
            provider.generate.assert_called_once()
            args=provider.generate.call_args.kwargs;directory=args['directory']
            self.assertEqual(len(args['images']),2)
            with Image.open(args['images'][0]) as full,Image.open(args['images'][1]) as crop:
                self.assertEqual(full.size,(100,100));self.assertEqual(crop.size,(55,12))
            saved={name:json.loads((directory/name).read_text(encoding='utf-8'))
                   for name in ('schema.json','input.json','result.json','response.json')}
            self.assertEqual(saved['result.json'],output)
            self.assertEqual(saved['response.json'],result)
            prompt=(directory/'prompt.txt').read_text(encoding='utf-8')
            self.assertIn('主比分卡',prompt)
            self.assertIn('排行榜',prompt)
            self.assertNotIn('untrusted-original-name',prompt)
            self.assertFalse(args['job']['cancel'].is_set())
        self.assertEqual((payload,request),before)
        return result

    def test_scoreboard_vision_preserves_two_review_only_logo_candidates_and_audit(self):
        # Same schema and values as the successful real restricted provider probe.
        output={'teams':[{'abbreviation':'IND','confidence':.98,'reason':'蓝色 P 内嵌黄色篮球'},
                         {'abbreviation':'BKN','confidence':.97,'reason':'白色篮球上的黑色 B'}],
                'reason':'只按主比分卡可见队标识别，不判断球衣归属。'}
        result=self.recognize_vision(output)
        self.assertEqual([c['value'] for c in result['candidates']],['IND','BKN'])
        self.assertEqual(result['status'],'multiple_candidates')
        self.assertEqual(result['engine'],'codex-vision')
        self.assertEqual(result['scoreMeaning'],'model_estimate_not_accuracy')
        self.assertFalse(result['identityConfirmed']);self.assertTrue(result['reviewRequired'])
        for candidate in result['candidates']:
            self.assertEqual(candidate['distinctFrames'],1)
            self.assertEqual(candidate['evidence'][0]['crop'],[0,88,55,100])
            self.assertEqual(candidate['evidence'][0]['engine'],'codex-vision')

    def test_scoreboard_vision_accepts_unknown_without_guessing(self):
        result=self.recognize_vision({'teams':[],'reason':'主比分卡看不清，保留未知。'})
        self.assertEqual(result['status'],'no_reading');self.assertEqual(result['candidates'],[])

    def test_scoreboard_vision_rejects_untrusted_configuration_or_multiple_frames(self):
        payload={'video_sha256':'v','frames':[{'time':0},{'time':1}],'width':100,'height':100}
        request={'videoSha256':'v','mode':'scoreboard_vision','observations':[{'frame':0}]}
        for key in ('model','endpoint','apiKey','prompt','reasoningEffort'):
            with self.subTest(key=key),self.assertRaises(ValueError):
                validate_request({**request,key:'untrusted'},payload)
        with self.assertRaises(ValueError):
            validate_request({**request,'observations':[{'frame':0},{'frame':1}]},payload)
        with self.assertRaises(OCRUnavailable):
            IdentityOCR().recognize('unused',payload,request)
        provider=Mock();provider.status.return_value={'available':False,'message':'not configured'}
        with self.assertRaises(OCRUnavailable):
            IdentityOCR(provider,'.').recognize('unused',payload,request)
        provider.generate.assert_not_called()

    def test_scoreboard_vision_rejects_invalid_team_claims(self):
        team={'abbreviation':'IND','confidence':.9,'reason':'Visible logo'}
        outputs=[{'teams':[team,team],'reason':'duplicate'},
                 {'teams':[team,dict(team,abbreviation='BKN'),dict(team,abbreviation='SAC')],'reason':'ticker'},
                 {'teams':[dict(team,abbreviation='BRK')],'reason':'noncanonical'},
                 {'teams':[dict(team,reason='')],'reason':'no evidence'}]
        outputs.extend({'teams':[dict(team,confidence=v)],'reason':'invalid'}
                       for v in (True,'0.9',float('nan'),float('inf'),-.1,1.1))
        for output in outputs:
            with self.subTest(output=output),self.assertRaises(ValueError):
                validate_team_vision_output(output)

if __name__=='__main__':unittest.main()
