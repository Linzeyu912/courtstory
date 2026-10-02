import unittest
from player_proposals import detection_matches,pending_candidates

class ProposalTests(unittest.TestCase):
    def test_high_and_low_subset_indices_do_not_hide_an_untracked_detection(self):
        boxes=[[0,0,20,100,.1,0],[100,0,120,100,.8,0],[200,0,220,100,.9,0]]
        tracks=[[0,0,20,100,7,.1,0,0],[100,0,120,100,8,.8,0,0]]
        self.assertEqual(detection_matches(boxes,tracks),{1:1,0:0})
        self.assertEqual(pending_candidates(boxes,tracks),[boxes[2]])

    def test_equal_confidence_nearby_people_match_one_to_one(self):
        boxes=[[0,0,20,100,.8,0],[15,0,35,100,.8,0]]
        tracks=[[1,0,21,100,5,.8,0]]
        self.assertEqual(pending_candidates(boxes,tracks),[boxes[1]])

if __name__=='__main__':unittest.main()
