"""Render an explicit human-assigned tracking demo without changing app drafts.

Assignments come from JSON: {videoSha256, bindings:[{identity,trackId,start,end}]}.
Only observed boxes inside the supplied intervals are used. Missing observations
stay missing; a new segment starts after each gap or tracker-ID change.
"""
import argparse
import json
from collections import defaultdict
from fractions import Fraction
from pathlib import Path

from build_ebard_review_tracks import sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', required=True)
    parser.add_argument('--tracks', required=True)
    parser.add_argument('--assignments', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    import av
    import cv2

    output = Path(args.output)
    if output.exists():
        parser.error('Choose a fresh output path')
    assignments = json.loads(Path(args.assignments).read_text(encoding='utf-8'))
    if sha256(args.video) != assignments['videoSha256']:
        raise ValueError('Assignments belong to a different video')
    records = json.loads(Path(args.tracks).read_text(encoding='utf-8'))
    bindings = assignments['bindings']
    identities = sorted({item['identity'] for item in bindings})
    for identity in identities:
        intervals = sorted([item for item in bindings if item['identity'] == identity], key=lambda item: item['start'])
        if any(a['end'] >= b['start'] for a, b in zip(intervals, intervals[1:])):
            raise ValueError('Identity assignment intervals overlap')
    colors = {'P1': (240, 90, 245), 'P2': (255, 230, 80)}
    assignment_caption = 'Human-assigned: ' + '; '.join(
        f'{item["identity"]} <- T{item["trackId"]} [{item["start"]}-{item["end"]}]' for item in bindings)
    tails = defaultdict(list)
    observations = defaultdict(int)
    missing = defaultdict(list)
    output.parent.mkdir(parents=True, exist_ok=True)
    with av.open(args.video) as source, av.open(str(output), 'w') as destination:
        video = source.streams.video[0]
        stream = destination.add_stream('libx264', rate=video.average_rate)
        stream.width, stream.height = video.width, video.height + 110
        stream.pix_fmt = 'yuv420p'
        stream.options = {'crf': '20', 'preset': 'medium'}
        for index, frame in enumerate(source.decode(video=0)):
            record = records[index]
            if record['frame'] != index or abs(record['time'] - float(frame.time)) > 1e-6:
                raise ValueError('Frame/track alignment differs')
            image = frame.to_ndarray(format='bgr24')
            h, w = image.shape[:2]
            for row in record['tracks']:
                x1, y1, x2, y2 = map(int, row[:4])
                color = (70, 165, 80) if row[6] == 2 else (210, 160, 50)
                cv2.rectangle(image, (x1, y1), (x2, y2), color, 1)
                cv2.putText(image, f'T{int(row[4])}', (x1, max(15, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX, .42, color, 1)
            for obj in record['objects']:
                x1, y1, x2, y2 = map(int, obj['box'])
                cv2.rectangle(image, (x1, y1), (x2, y2), (60, 210, 250), 2)
                cv2.putText(image, obj['kind'], (x1, max(15, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, .42, (60, 210, 250), 1)
            statuses = []
            for identity in identities:
                match = next((item for item in bindings if item['identity'] == identity and item['start'] <= index <= item['end']), None)
                row = next((item for item in record['tracks'] if match and int(item[4]) == match['trackId']), None)
                if row is None:
                    tails[identity].clear()
                    missing[identity].append(index)
                    statuses.append(f'{identity}: MISSING / UNASSIGNED')
                    continue
                point = (round((row[0] + row[2]) / 2), round(row[3]))
                tail = tails[identity]
                if tail and tail[-1][2] != int(row[4]):
                    tail.clear()
                tail.append((index, point, int(row[4])))
                tail[:] = [entry for entry in tail if entry[0] >= index - 24]
                color = colors.get(identity, (200, 200, 255))
                for a, b in zip(tail, tail[1:]):
                    if b[0] == a[0] + 1:
                        cv2.line(image, a[1], b[1], color, 3)
                x1, y1, x2, y2 = map(int, row[:4])
                cv2.rectangle(image, (x1, y1), (x2, y2), color, 3)
                cv2.circle(image, point, 6, color, -1)
                cv2.putText(image, f'{identity} <- T{int(row[4])}', (x1, max(24, y1 - 9)), cv2.FONT_HERSHEY_SIMPLEX, .65, color, 2)
                observations[identity] += 1
                statuses.append(f'{identity}: T{int(row[4])} observed')
            image = cv2.copyMakeBorder(image, 0, 110, 0, 0, cv2.BORDER_CONSTANT, value=(28, 30, 36))
            lines = [f'E-BARD YOLOv8n + ByteTrack | source frame {index:03d}, {record["time"]:.3f}s | ' + ' | '.join(statuses),
                     assignment_caption,
                     'Foot = bbox bottom-centre ESTIMATE. Gaps stay missing. Ball/hoop = frame detections, NOT ground points.',
                     'Demonstration only: identities/ground positions are not independently accuracy-validated.']
            for line_index, line in enumerate(lines):
                cv2.putText(image, line, (12, h + 22 + line_index * 25), cv2.FONT_HERSHEY_SIMPLEX, .5, (235, 235, 235), 1, cv2.LINE_AA)
            encoded = av.VideoFrame.from_ndarray(image, format='bgr24')
            encoded.pts = index
            encoded.time_base = Fraction(1, video.average_rate)
            for packet in stream.encode(encoded):
                destination.mux(packet)
        for packet in stream.encode():
            destination.mux(packet)
    with av.open(str(output)) as check:
        decoded_count = sum(1 for _ in check.decode(video=0))
        if decoded_count != len(records):
            raise ValueError('Rendered frame count differs')
        verified = check.streams.video[0]
        width, height = verified.width, verified.height
        codec = verified.codec_context.name
        frame_rate = float(verified.average_rate)
        duration = float(verified.duration * verified.time_base)
    report = {'output': output.as_posix(), 'sha256': sha256(output), 'frames': len(records),
              'width': width, 'height': height, 'codec': codec, 'frameRate': frame_rate, 'durationSeconds': duration,
              'assignments': assignments, 'observedFrames': dict(observations),
              'missingFrames': dict(missing), 'interpolatedFrames': 0,
              'formalDraftModified': False, 'accuracyValidated': False}
    output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in {'missingFrames', 'assignments'}}))


if __name__ == '__main__':
    main()
