"""Joint media adapter; native tactics still owns SVG, geometry and name display."""
import json
from pathlib import Path
import threading

from commentary_joint import build_joint_composition
from local_video_library import atomic_json, file_hash
from tactical_workbench import TacticalWorkbench
from tactics_render import TacticsRenderer


def render_joint(video, output, document_path, plan, audio_rows, context, cues, font, directory):
    import av
    # Commentary tools expose a smaller frame record. Joint rendering needs the
    # exact integer PTS/time base; read them from this same asset, never fps math.
    context=dict(context)
    with av.open(str(video)) as source:
        context['frames']=[dict(frame=i,time=float(f.time)-context['sourceStartTime'],sourceTime=float(f.time),
                                pts=f.pts,timeBase=str(f.time_base)) for i,f in enumerate(source.decode(video=0))]
    directory=Path(directory);directory.mkdir(parents=True)
    snapshot=json.loads(Path(document_path).read_text(encoding='utf-8'))
    document=snapshot.get('document',snapshot);options=snapshot.get('options',{}) if 'document' in snapshot else {}
    review=document['review']
    name_overlay=options.get('nameOverlay',snapshot.get('nameOverlay'))
    if name_overlay is None and review.get('nameIdentitySource') and isinstance(review.get('playerNameIdentities'),list):
        name_overlay={key:review[key] for key in ('nameDisplay','nameIdentitySource','playerNameIdentities') if key in review}
    options={'fps':options.get('fps',30),**({'nameOverlay':name_overlay} if name_overlay else {})}
    tactics=TacticalWorkbench(directory/'native-validation')
    tactics.run('validate',document=document)
    native=tactics.run('production-compile',document=document,options=options)
    identity_review = snapshot.get('identityReview') or {**review,**(name_overlay or {})}
    # Display positions may differ from the frozen identity evidence. Reject
    # any actual name, track, source or raw trajectory change before rendering.
    if snapshot.get('identityReview'):
        from commentary_plan import source_ref
        registered = dict(video_sha256=review['videoSha256'], source_video_sha256=review.get('sourceVideoSha256'),
                          tracking_fingerprint=review.get('trackingFingerprint'), tracking_revision=review.get('trackingRevision'),
                          sourceCuts=review.get('settings', {}).get('sourceCuts', []),
                          frames=[dict(frame=r['frame'], time=r['time'], source_frame=r.get('sourceFrame', r['frame']),
                                       source_time=r.get('sourceTime', r['time'])) for r in review['sourceFrameMapping']])
        if source_ref(registered, identity_review, identity_only=True) != source_ref(registered, {**review, **(name_overlay or {})}, identity_only=True):
            raise ValueError('Joint render identity changed after commentary validation')
    composition=build_joint_composition(document,plan,audio_rows,context,native,identity_review=identity_review)
    # Retain all consumer snapshots alongside the final shared output frame map.
    composition['document']=document;composition['options']=options
    composition['documentDigest']=tactics.run('agent-digest',document=document)['digest']
    composition['audioManifestSnapshot']=[{**{k:r.get(k) for k in ('cueId','path','text','durationSeconds')},
                                          'wavSha256':file_hash(r['_absolute'])} for r in audio_rows]
    composition['cues']=cues
    clip=dict(video_sha256=context['videoRef'],tracking_fingerprint=review.get('trackingFingerprint'),
              tracking_revision=review.get('trackingRevision'),width=context['width'],height=context['height'],
              frames=[{'frame':r['frame'],'time':r['sourceTime']} for r in context['frames']])
    if name_overlay is not None:TacticsRenderer._validate_name_overlay(name_overlay,clip)
    atomic_json(directory/'snapshot.json',dict(document=document,options=options,productionPlan=composition))
    job=dict(video=Path(video),document=document,clip=clip,options=options,composition=composition,
             subtitleCues=cues,subtitlePlacements=composition['placements'],subtitleFont=font,
             cancel=threading.Event(),processes=[])
    renderer=TacticsRenderer(directory/'jobs',tactics)
    try:
        renderer._render(job,directory)
        (directory/'finished.mp4').replace(output)
        composition['silentVideoSha256']=file_hash(output)
    finally:
        renderer._stop(job)
        for process in job['processes']:
            try:process.wait(timeout=5)
            except Exception:pass
        renderer.close()
    return composition
