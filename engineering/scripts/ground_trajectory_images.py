"""Actual frame and court images for the bounded ground-position agent."""
import base64
import hashlib
import io
import math
from PIL import Image, ImageDraw, ImageOps


def _image(record):
    return Image.open(io.BytesIO(base64.b64decode(record['dataUrl'].split(',', 1)[1], validate=True))).convert('RGB')


def _asset(image, kind, metadata, directory):
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=94)
    data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    asset = dict(assetId=digest, sha256=digest, kind=kind, width=image.width, height=image.height, **metadata)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{digest}.jpg'
    if not path.exists():
        path.write_bytes(data)
    return {'type': 'image', 'data': base64.b64encode(data).decode(), 'mimeType': 'image/jpeg'}, asset


def _label(record):
    return f"frame {record['frame']} | time {record['time']:.3f}s | source {record['sourceTime']:.3f}s"


def inspect_images(records, preparation, entity_ids, mode, directory):
    images, assets = [], []
    tiles, tile_metadata = [], []
    for record in records:
        image = _image(record)
        full_size = image.size
        if mode in ('player', 'feet'):
            for entity_id in entity_ids:
                point = preparation['rawByPlayer'].get(entity_id, [])[record['frame']]
                box = point.get('box') or point.get('imageBox')
                if not box or len(box) != 4 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in box):
                    continue
                x1, y1, x2, y2 = box
                if mode == 'feet':
                    y1 = y2 - max(72, (y2 - y1) * .4)
                pad = max(20, (x2 - x1) * .3)
                crop = (max(0, math.floor(x1-pad)), max(0, math.floor(y1-pad)),
                        min(image.width, math.ceil(x2+pad)), min(image.height, math.ceil(y2+pad)))
                if crop[2] <= crop[0] or crop[3] <= crop[1]:
                    continue
                cropped = image.crop(crop)
                canvas = Image.new('RGB', (cropped.width, cropped.height+28), '#121826')
                canvas.paste(cropped, (0, 28))
                ImageDraw.Draw(canvas).text((4, 5), f'{entity_id} | {_label(record)}', fill='white')
                content, asset = _asset(canvas, mode, dict(frame=record['frame'], entityId=entity_id,
                    crop=list(crop), sourceSize=list(full_size), scale=1, labelHeight=28), directory)
                images.append(content); assets.append(asset)
            continue
        draw = ImageDraw.Draw(image)
        for entity_id in entity_ids:
            point = preparation['rawByPlayer'].get(entity_id, [])[record['frame']]
            box = point.get('box') or point.get('imageBox')
            if box and len(box) == 4 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in box):
                draw.rectangle(box, outline='#ffd166', width=3)
                draw.text((box[0], max(0, box[1]-15)), entity_id, fill='#ffd166')
            else:
                raw = point.get('rawImagePoint') or point.get('imagePoint')
                if isinstance(raw, (list, tuple)) and len(raw) == 2:
                    raw = dict(x=raw[0], y=raw[1])
                if not raw and all(isinstance(point.get(k), (int, float)) for k in ('x', 'y')):
                    raw = point
                if isinstance(raw, dict) and all(isinstance(raw.get(k), (int, float)) and math.isfinite(raw[k]) for k in ('x', 'y')):
                    draw.text((raw['x'], raw['y']), entity_id, fill='#ffd166')
        width = min(image.width, 640 if mode == 'sheet' else 1280)
        fitted = ImageOps.contain(image, (width, round(width*image.height/image.width)), Image.Resampling.LANCZOS)
        canvas = Image.new('RGB', (fitted.width, fitted.height+28), '#121826')
        canvas.paste(fitted, (0, 28)); ImageDraw.Draw(canvas).text((5, 6), _label(record), fill='white')
        meta = dict(frame=record['frame'], sourceSize=list(full_size), crop=[0, 0, *full_size],
                    scale=fitted.width/image.width, labelHeight=28)
        if mode == 'sheet':
            tiles.append(canvas); tile_metadata.append(meta)
        else:
            content, asset = _asset(canvas, 'full', meta, directory)
            images.append(content); assets.append(asset)
    if tiles:
        for offset in range(0, len(tiles), 6):
            group = tiles[offset:offset+6]
            width, height = max(i.width for i in group), max(i.height for i in group)
            sheet = Image.new('RGB', (width*2, height*math.ceil(len(group)/2)), '#121826')
            metadata = []
            for i, tile in enumerate(group):
                x, y = (i % 2)*width, (i//2)*height
                sheet.paste(tile, (x, y))
                metadata.append(dict(tile_metadata[offset+i], tileOrigin=[x, y]))
            content, asset = _asset(sheet, 'sheet', dict(tiles=metadata), directory)
            images.append(content); assets.append(asset)
    return images, assets


def render_images(preparation, candidate, records, entity_ids, directory):
    start, end = candidate['range']['startFrame'], candidate['range']['endFrameExclusive']
    canvas = Image.new('RGB', (1280, 780), '#121826'); draw = ImageDraw.Draw(canvas)
    scale, ox, oy = 39, 75, 95
    def xy(x, y): return (ox+x*scale, oy+y*scale)
    draw.text((25, 18), f"Candidate revision {candidate['revision']} | frames [{start}, {end}) | metres", fill='white')
    draw.text((25, 42), 'Grey: current preparation; colour: candidate; circles: ground anchors. Estimates require review.', fill='white')
    draw.rectangle([xy(0, 0), xy(28.6512, 15.24)], outline='#8994a8', width=2)
    draw.line([xy(14.3256, 0), xy(14.3256, 15.24)], fill='#8994a8', width=2)
    for left, right in ((0, 5.7912), (28.6512-5.7912, 28.6512)):
        draw.rectangle([xy(left, 5.1816), xy(right, 10.0584)], outline='#8994a8', width=2)
    colors = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#cda6ff']
    for index, entity_id in enumerate(entity_ids):
        color = colors[index % len(colors)]
        draw.text((30+index*190, 745), entity_id, fill=color)
        for points, line_color in ((preparation['preparedByPlayer'][entity_id], '#667085'),
                                   (candidate['pointsByPlayer'][entity_id], color)):
            previous = None
            breaks = {b['frame'] for b in preparation['breaksByPlayer'].get(entity_id, [])}
            for point in points[start:end]:
                if point['frame'] in breaks:
                    previous = None
                if not all(isinstance(point.get(k), (int, float)) and math.isfinite(point[k]) for k in ('x', 'y')):
                    previous = None; continue
                current = xy(point['x'], point['y'])
                if previous:
                    draw.line([previous, current], fill=line_color, width=3)
                previous = current
        for anchor in candidate.get('anchors', []):
            if anchor['entityId'] == entity_id:
                x, y = xy(anchor['x'], anchor['y'])
                draw.ellipse((x-5, y-5, x+5, y+5), fill=color)
                draw.text((x+7, y), str(anchor['frame']), fill=color)
    content, asset = _asset(canvas, 'trajectory', dict(revision=candidate['revision'], range=candidate['range']), directory)
    images, assets = [content], [asset]
    for record in records:
        frame = record['frame']; matrix = preparation.get('maps', [])[frame]
        h = matrix.get('toImage') if isinstance(matrix, dict) else None
        if not h or len(h) != 9:
            continue
        image = _image(record); draw = ImageDraw.Draw(image)
        draw.text((10, 10), _label(record)+' | ground reprojection, NOT airborne foot location', fill='white')
        for index, entity_id in enumerate(entity_ids):
            point = candidate['pointsByPlayer'][entity_id][frame]
            if not all(isinstance(point.get(k), (int, float)) and math.isfinite(point[k]) for k in ('x', 'y')):
                continue
            x, y = point['x'], point['y']; denominator = h[6]*x+h[7]*y+h[8]
            if abs(denominator) < 1e-8:
                continue
            u, v = (h[0]*x+h[1]*y+h[2])/denominator, (h[3]*x+h[4]*y+h[5])/denominator
            if not (-image.width <= u <= image.width*2 and -image.height <= v <= image.height*2):
                continue
            color = colors[index % len(colors)]
            draw.ellipse((u-9, v-9, u+9, v+9), outline=color, width=3)
            draw.text((u+12, v), entity_id, fill=color)
        image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        content, asset = _asset(image, 'ground_reprojection', dict(frame=frame, revision=candidate['revision']), directory)
        images.append(content); assets.append(asset)
    return images, assets
