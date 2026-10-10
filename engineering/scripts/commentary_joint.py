"""Compile one source-locked output timeline, using decoded PTS and WAV lengths.

The legacy production compiler remains responsible for native graphical timing.
Only its holds are merged here; source sampling always uses the actual decoder
index. Parent-footage positions are provenance, never decoder input.
"""
from bisect import bisect_right
from copy import deepcopy
import math


def _number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'Invalid {field}')
    return float(value)


def validate_shot_graphics(document, plan, native=None, fps=None):
    selected_ref={key:plan.get(key) for key in ('planId','revision','digest')}
    shot_nodes={node['nodeId']:node for node in plan.get('nodes',[]) if node.get('kind')=='shot_release'}
    shot_items=document.get('shotFeedback',{}).get('items',[])
    for item in shot_items:
        if item.get('nodeId') not in shot_nodes or item.get('commentaryPlanRef')!=selected_ref:
            raise ValueError('Joint shot feedback is not bound to the current commentary plan node')
    for node_id,node in shot_nodes.items():
        matching=[item for item in shot_items if item.get('nodeId')==node_id]
        if len(matching)!=1:raise ValueError('Confirmed shot release needs adopted shot graphics and evaluation')
        item=matching[0];feedback=node.get('shotFeedback') or {};anchor=node['anchorAssetFrame']
        if (item.get('frame')!=anchor or item.get('eventId')!=node.get('eventId') or
            any(item.get(key)!=feedback.get(key) for key in ('shooterRef','opportunity','pressure'))):
            raise ValueError('Joint shot feedback differs from the saved plan node evaluation')
        annotation=next((a for a in document.get('annotations',{}).get('items',[]) if a.get('id')==item.get('spotlightAnnotationId')),None)
        if (not annotation or annotation.get('type')!='spotlight' or annotation.get('anchorFrame')!=anchor or
            not annotation.get('startFrame',anchor)<=anchor<annotation.get('endFrameExclusive',anchor)):
            raise ValueError('Confirmed shot release has no valid linked shooter spotlight')
        shooters=[person for person in plan.get('participants',[]) if person.get('participantId')==feedback.get('shooterRef')]
        if len(shooters)!=1 or 'entityId' not in shooters[0]:
            raise ValueError('Confirmed shot release has no saved shooter participant')
        if annotation.get('entityId')!=shooters[0]['entityId']:
            raise ValueError('Confirmed shot release spotlight shooter identity differs from the saved plan')
        if not any(cue.get('frame')==anchor and cue.get('freeze') is True and cue.get('holdSeconds',0)>=2.5 and
                   annotation['id'] in cue.get('annotationIds',[]) for cue in document.get('tacticKeyframes',{}).get('items',[])):
            raise ValueError('Confirmed shot release needs one native pause of at least 2.5 seconds')
        if native is not None and len(native.get(anchor,[]))<math.ceil(2.5*fps-1e-9):
            raise ValueError('Native shot pause is shorter than the required 2.5 seconds')


def build_joint_composition(document, plan, audio_rows, context, production, margin=.25, identity_review=None):
    review = document['review']; mapping = review['sourceFrameMapping']; decoded = context['frames']
    fps = production['fps']; start = document['playDefinition']['startFrame']; end = document['playDefinition']['endFrameExclusive']
    if type(fps) is not int or not 1 <= fps <= 120 or not 0 <= start < end <= len(decoded):
        raise ValueError('Invalid joint frame range or fps')
    if len(mapping) != len(decoded) or (review['width'],review['height']) != (context['width'],context['height']):
        raise ValueError('Joint source mapping or dimensions mismatch')
    source = plan.get('sourceRef')
    if not isinstance(source, dict) or source.get('videoSha256') != review['videoSha256'] or context['videoRef'] != review['videoSha256']:
        raise ValueError('Joint commentary source does not match the asset')
    selected_ref={key:plan.get(key) for key in ('planId','revision','digest')}
    runs={run.get('jobId'):run for run in document.get('agentRuns',[])}
    for annotation in document.get('annotations',{}).get('items',[]):
        origin=annotation.get('origin') or {};run=runs.get(origin.get('jobId'),{})
        ref=origin.get('commentaryPlanRef') or run.get('commentaryPlanRef')
        if ref and ref!=selected_ref:
            raise ValueError('Active graphics reference an outdated commentary plan; redraw or remove them')
    binding = review
    if any(key in source for key in ('frameMappingDigest','reviewDigest')):
        from commentary_plan import source_ref
        registered = dict(video_sha256=review['videoSha256'],source_video_sha256=review.get('sourceVideoSha256'),
                          tracking_fingerprint=review.get('trackingFingerprint'),
                          tracking_revision=review.get('trackingRevision'),
                          sourceCuts=review.get('settings',{}).get('sourceCuts',[]),
                          frames=[dict(frame=r['frame'],time=r['time'],source_frame=r.get('sourceFrame',r['frame']),
                                       source_time=r.get('sourceTime',r['time'])) for r in mapping])
        binding = source_ref(registered,identity_review or review)
    for key in ('trackingFingerprint','trackingRevision','frameMappingDigest','reviewDigest'):
        expected = binding.get(key,review.get(key))
        if key in source and expected is not None and source[key] != expected:
            raise ValueError(f'Joint commentary source {key} mismatch')
    if margin < 0 or not math.isfinite(margin):
        raise ValueError('Invalid speech margin')
    times=[]
    for i,(row,record) in enumerate(zip(decoded,mapping)):
        pts_time=_number(row['sourceTime'],'asset PTS');clip_time=_number(row['time'],'clip time')
        review_time=_number(record['time'],'review time')
        if row['frame'] != i or record['frame'] != i or abs(pts_time-context['sourceStartTime']-clip_time)>1e-7:
            raise ValueError('Joint asset frame index or PTS mismatch')
        if abs(review_time-mapping[0]['time']-clip_time)>1e-7 or i and clip_time<=times[-1]:
            raise ValueError('Joint review mapping differs from decoded VFR frame times')
        times.append(clip_time)
    first=times[start];last=context['duration'] if end==len(decoded) else times[end]
    if last<=first:raise ValueError('Empty joint source duration')
    phases=document['playDefinition']['phases']
    def phase_at(asset_frame):
        phase=next((p for p in phases if p['startFrame']<=asset_frame<p['endFrameExclusive']),None)
        if phase is None:raise ValueError('Joint asset frame has no native phase')
        return phase['phaseId']

    # Keep one native pause per asset frame. A repeated same-frame native block
    # shares a pause rather than charging its duration a second time.
    native={};block=[];previous=None
    def remember():
        if block and len(block)>len(native.get(previous,[])):native[previous]=deepcopy(block)
    for state in production['frames']:
        asset_frame=state.get('assetFrame',state['sourceFrame'])
        if state['state']=='source' or asset_frame!=previous:
            remember();block=[]
        previous=asset_frame
        if state['state']!='source':
            if not start<=asset_frame<end:raise ValueError('Native hold outside joint asset range')
            block.append(state)
    remember()
    validate_shot_graphics(document, plan, native, fps)
    nodes={}
    for node in plan.get('nodes',[]):
        anchor=node.get('anchorAssetFrame');window=node.get('evidenceWindow',{})
        if type(anchor) is not int or not start<=anchor<end:raise ValueError('Node anchor outside asset range')
        lower=window.get('startFrame',window.get('startAssetFrame'))
        upper=window.get('endFrameExclusive',window.get('endAssetFrameExclusive'))
        if upper is None and type(window.get('endFrame')) is int:upper=window['endFrame']+1
        if type(lower) is not int or type(upper) is not int or not 0<=lower<=anchor<upper<=len(decoded):
            raise ValueError('Node anchor outside evidence window')
        for cue_id in node.get('cueIds',[]):nodes.setdefault(cue_id,node)
    audio={row['cueId']:row for row in audio_rows};cues=plan['cues'];events=[];seen=set()
    for cue in cues:
        ident=cue['cueId']
        if ident in seen or ident not in audio:raise ValueError('Duplicate cue or missing audio')
        seen.add(ident)
        if 'text' in audio[ident] and audio[ident]['text']!=cue['text']:
            raise ValueError('Joint audio text differs from the saved cue text')
        length=_number(audio[ident]['durationSeconds'],'measured WAV duration')
        if length<=0:raise ValueError('Audio has no positive measured duration')
        if ident not in nodes:raise ValueError(f'Cue {ident} needs a verified node for joint rendering')
        begin=_number(cue['suggestedStartTime'],'cue start');finish=_number(cue['suggestedEndTime'],'cue end')
        # Match the host's timestamp-rounding tolerance without extending the clip.
        if last < finish <= last + 0.0001:finish=last
        if not first<=begin<=finish<=last+1e-7:raise ValueError('Cue source window is outside the joint range')
        delivery=cue['delivery']
        if delivery not in ('pause','during_play'):raise ValueError('Unknown cue delivery')
        events.append(dict(cue=cue,node=nodes[ident],length=length,start=begin,end=finish,
                           hold=nodes[ident].get('kind')=='shot_release' or delivery=='pause' or length>finish-begin+1e-7))
    # Decide all pauses before placing voices. Playback narration that would
    # cross another pause or overlap a previous sentence uses its verified node.
    events.sort(key=lambda e:(e['start'],cues.index(e['cue'])))
    changed=True
    while changed:
        changed=False;reserved=-math.inf
        anchors=set(native)|{e['node']['anchorAssetFrame'] for e in events if e['hold']}
        for event in events:
            if event['hold']:continue
            if event['start']<reserved-1e-7 or any(event['start']<=times[a]<event['start']+event['length'] for a in anchors):
                event['hold']=True;changed=True
            else:reserved=event['start']+event['length']
    holds={a:[] for a in native}
    for event in events:
        if event['hold']:holds.setdefault(event['node']['anchorAssetFrame'],[]).append(event)
    frames=[];segments=[];placements=[];source_chunk=None
    parent_sha=review.get('sourceVideoSha256')
    def add(asset_frame,state='source',reveal=1.):
        row=decoded[asset_frame];record=mapping[asset_frame];index=len(frames)
        has_parent=bool(parent_sha and parent_sha!=review['videoSha256']) and type(record.get('sourceFrame')) is int and isinstance(record.get('sourceTime'),(int,float))
        frames.append(dict(assetFrame=asset_frame,sourceFrame=asset_frame,sourceTime=record['time'],
                           assetPts=row['pts'],assetTimeBase=row['timeBase'],assetPtsSeconds=row['sourceTime'],
                           clipTimeSeconds=row['time'],reviewTimeSeconds=record['time'],
                           parentFrame=record['sourceFrame'] if has_parent else None,
                           parentTimeSeconds=record['sourceTime'] if has_parent else None,
                           parentVideoSha256=parent_sha if has_parent else None,
                           outputFrame=index,outputTimeSeconds=index/fps,state=state,reveal=reveal,phaseId=phase_at(asset_frame)))
        if len(frames)>18000:raise ValueError('Joint rendering exceeds 18000 output frames')
    def flush_source(stop):
        nonlocal source_chunk
        if source_chunk:
            out,begin=source_chunk
            segments.append(dict(kind='play',sourceStart=begin,sourceEnd=min(last,stop),previewStart=out/fps,previewEnd=len(frames)/fps))
            source_chunk=None
    def add_hold(anchor):
        out=len(frames);speech=holds[anchor];states=native.get(anchor,[])
        voice_duration=sum(e['length'] for e in speech)
        count=max(len(states),math.ceil((voice_duration+2*margin)*fps-1e-9) if speech else 0)
        seg=dict(kind='hold',assetFrame=anchor,sourceStart=times[anchor],sourceEnd=times[anchor],
                 previewStart=out/fps,previewEnd=(out+count)/fps,cueIds=[e['cue']['cueId'] for e in speech])
        if len(speech)==1:seg['cueId']=speech[0]['cue']['cueId']
        segments.append(seg);cursor=out/fps+margin
        for event in speech:
            placements.append(dict(cueId=event['cue']['cueId'],nodeId=event['node']['nodeId'],assetFrame=anchor,
                                   previewStart=cursor,previewEnd=cursor+event['length'],speed=1.,
                                   fallback=event['cue']['delivery']=='during_play'))
            cursor+=event['length']
        for i in range(count):
            state=states[i] if i<len(states) else dict(state='hold',reveal=1.)
            add(anchor,state['state'],state['reveal'])
    pending=iter(sorted(holds));anchor=next(pending,None)
    for i in range(math.ceil((last-first)*fps-1e-9)):
        source_time=first+i/fps;asset_frame=min(end-1,max(start,bisect_right(times,source_time+1e-7)-1))
        while anchor is not None and anchor<=asset_frame:
            flush_source(source_time);add_hold(anchor);anchor=next(pending,None)
        if source_chunk is None:source_chunk=(len(frames),source_time)
        add(asset_frame)
    flush_source(last)
    while anchor is not None:add_hold(anchor);anchor=next(pending,None)
    for event in events:
        if event['hold']:continue
        output=next((f['outputTimeSeconds'] for f in frames if f['state']=='source' and f['clipTimeSeconds']+1e-7>=event['start']),None)
        # Cue windows may begin between VFR samples: map through the play segment
        # and retain the exact requested clip time rather than round to a frame.
        segment=next((s for s in segments if s['kind']=='play' and s['sourceStart']<=event['start']<s['sourceEnd']),None)
        if segment:output=segment['previewStart']+event['start']-segment['sourceStart']
        if output is None:raise ValueError('Playback cue has no output position')
        placements.append(dict(cueId=event['cue']['cueId'],nodeId=event['node']['nodeId'],
                               previewStart=output,previewEnd=output+event['length'],speed=1.,fallback=False))
    placements.sort(key=lambda p:p['previewStart'])
    duration=len(frames)/fps
    if any(p['previewEnd']>duration+1e-7 for p in placements) or any(a['previewEnd']>b['previewStart']+1e-7 for a,b in zip(placements,placements[1:])):
        raise ValueError('Joint narration overlaps or exceeds the output timeline')
    return dict(schemaVersion=1,engineVersion='commentary-joint-v1',timing='measured_audio',fps=fps,
                width=review['width'],height=review['height'],totalFrames=len(frames),duration=duration,
                sourceRef=deepcopy(source),commentaryPlanRef={k:plan.get(k) for k in ('planId','revision','digest')},
                frames=frames,segments=segments,placements=placements)
