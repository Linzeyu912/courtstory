import unittest
from ball_selection_probe import choices,nearest_anchor,ranked,margin_ok
from object_probe import channel_state

def obj(kind,x,score=.5):return {'kind':kind,'box':[x,0,x+10,10],'score':score}
class ProbeSemantics(unittest.TestCase):
    def test_native_kind_not_silently_lost(self):
        self.assertEqual(len(choices({'objects':[obj('basketball',0),obj('hoop',3)]})),1)
    def test_missing_and_no_detection_are_not_presence_claims(self):
        self.assertEqual(choices({}),[])
        self.assertEqual(choices({'objects':[]}),[])
        self.assertEqual(channel_state({}),'not_provided')
        self.assertEqual(channel_state({'objects':[]}),'not_detected_reason_unknown')
        self.assertEqual(channel_state({'objects':[obj('basketball',0)]}),'candidate_present')
    def test_singleton_neighbor_can_reverse_candidate_choice(self):
        cs=[(1,obj('basketball',0)),(2,obj('basketball',100))]
        before={'object':obj('basketball',0)};after={'object':obj('basketball',100)}
        a=ranked(cs,before);b=ranked(cs,after)
        self.assertTrue(margin_ok(a,cs));self.assertTrue(margin_ok(b,cs));self.assertNotEqual(a[0][1],b[0][1])
    def test_future_anchor_is_bounded(self):
        f=[{'time':i/30,'objects':[]} for i in range(6)];f[4]['objects']=[obj('basketball',0)]
        self.assertIsNone(nearest_anchor(f,0,1,3));self.assertEqual(nearest_anchor(f,1,1,3)['frame'],4)
    def test_equal_geometry_has_no_arbitrary_winner(self):
        cs=[(1,obj('basketball',0)),(2,obj('basketball',0))]
        self.assertFalse(margin_ok(ranked(cs,{'object':obj('basketball',0)}),cs))
if __name__=='__main__':unittest.main()
