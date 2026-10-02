"""Match current detections to smoothed output tracks without tracker-internal indices."""
def box_iou(a,b):
    area=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    return area/max(1,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-area)

def detection_matches(detections,tracks):
    # Ultralytics 8.4.63 indexes high/low subsets independently. Output scores
    # retain the current detection confidence; use it plus overlap for matching.
    pairs=sorted([(box_iou(track,box),ti,di) for ti,track in enumerate(tracks)
                  for di,box in enumerate(detections)
                  if abs(float(track[5])-float(box[4]))<1e-5 and box_iou(track,box)>.01],reverse=True)
    used_tracks,used_detections=set(),set();matches={}
    for _,ti,di in pairs:
        if ti not in used_tracks and di not in used_detections:
            used_tracks.add(ti);used_detections.add(di);matches[ti]=di
    return matches

def pending_candidates(detections,tracks,threshold=.20):
    matched=set(detection_matches(detections,tracks).values())
    return [list(box) for index,box in enumerate(detections) if index not in matched and box[4]>=threshold]
