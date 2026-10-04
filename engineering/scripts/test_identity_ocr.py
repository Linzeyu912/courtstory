import copy
import unittest
from identity_ocr import jersey_number,team_codes,validate_request

class IdentityOCRTests(unittest.TestCase):
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

if __name__=='__main__':unittest.main()
