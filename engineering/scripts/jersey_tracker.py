"""Experimental ByteTrack association guard for this yellow/white basketball clip.

This is a colour constraint, not player ReID. Unknown or mixed colours stay unknown.
"""
import numpy as np
from ultralytics.trackers.byte_tracker import BYTETracker, STrack
from ultralytics.trackers.basetrack import TrackState
from ultralytics.trackers.utils import matching
from basketball_player_filter import clothing_features


def jersey_team(features):
    yellow=max(features['torso_yellow'],features['shorts_yellow'])
    white=features['torso_white']
    if yellow>.20 and white<.35:
        return 'yellow'
    if yellow<.08 and white>.35 and features['shorts_white']>.20:
        return 'white'
    return None


class JerseyTrack(STrack):
    def __init__(self,*args):
        super().__init__(*args)
        self.jersey=None

    def update(self,new_track,frame_id):
        if self.jersey is None:self.jersey=new_track.jersey
        super().update(new_track,frame_id)

    def re_activate(self,new_track,frame_id,new_id=False):
        if self.jersey is None:self.jersey=new_track.jersey
        super().re_activate(new_track,frame_id,new_id)


class JerseyBYTETracker(BYTETracker):
    track_class=JerseyTrack

    def init_track(self,results,img=None):
        tracks=super().init_track(results,img)
        for track,box in zip(tracks,results.xyxy):
            if img is not None:track.jersey=jersey_team(clothing_features(img,box))
        return tracks

    def get_dists(self,tracks,detections):
        dists=super().get_dists(tracks,detections)
        for i,track in enumerate(tracks):
            for j,det in enumerate(detections):
                if track.jersey and det.jersey and track.jersey!=det.jersey:
                    dists[i,j]=1.0
        return dists

    def _second_association(self,strack_pool,u_track,detections_second,activated,refind,lost):
        # The upstream second stage calls IoU directly; apply the guard here too.
        pool=[strack_pool[i] for i in u_track if strack_pool[i].state==TrackState.Tracked]
        if pool and detections_second:
            dists=self.get_dists(pool,detections_second)
            matches,unmatched,_=matching.linear_assignment(dists,thresh=.5)
            self._apply_matches(matches,pool,detections_second,activated,refind)
        else:unmatched=range(len(pool))
        for index in unmatched:
            track=pool[index]
            if track.state!=TrackState.Lost:
                track.mark_lost();lost.append(track)
