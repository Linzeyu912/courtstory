"""Actual frame and court images for the bounded ground-position agent."""
import base64
import hashlib
import io
import math
from PIL import Image, ImageDraw, ImageOps, ImageFont


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
                # Give the vision model readable image coordinates. Without
                # rulers, live runs repeatedly guessed the bottom of the crop
                # instead of the visible sole, even with correct crop metadata.
                guide = Image.new('RGBA', canvas.size, (0, 0, 0, 0)); gd = ImageDraw.Draw(guide)
                for x in range(50, canvas.width, 50):
                    gd.line((x, 28, x, canvas.height), fill=(150, 200, 255, 85), width=1)
                for y in range(50, canvas.height, 50):
                    gd.line((0, y, canvas.width, y), fill=(150, 200, 255, 85), width=1)
                canvas = Image.alpha_composite(canvas.convert('RGBA'), guide).convert('RGB')
                cd = ImageDraw.Draw(canvas)
                cd.text((4, 5), f'{entity_id} f{record["frame"]} t={record["time"]:.3f}s | image px', fill='white')
                for x in range(50, canvas.width, 50):
                    cd.rectangle((x+1, 28, x+27, 41), fill='#121826')
                    cd.text((x+2, 28), str(x), fill='#ffd166')
                for y in range(50, canvas.height, 50):
                    cd.rectangle((0, y-6, 27, y+7), fill='#121826')
                    cd.text((2, y-6), str(y), fill='#ffd166')
                content, asset = _asset(canvas, mode, dict(frame=record['frame'], entityId=entity_id,
                    crop=list(crop), sourceSize=list(full_size), scale=1, labelHeight=28,
                    coordinateGridStep=50, coordinateSpace='returned_image_pixels'), directory)
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
    colors = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#cda6ff',
              '#ff8a5c', '#8fe388', '#f7a9d0', '#61d3f2', '#e5e5a3']
    for index, entity_id in enumerate(entity_ids):
        color = colors[index % len(colors)]
        draw.text((30+(index % 5)*240, 731+(index//5)*20), entity_id, fill=color)
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
        font = ImageFont.load_default(size=22)
        draw.rectangle((0, 0, image.width, 65), fill='#121826')
        draw.text((10, 6), _label(record), fill='white', font=font)
        draw.text((10, 34), 'Blue cross: current | yellow circle: candidate ground estimate | airborne feet are NOT ground', fill='white', font=font)
        def projected(point):
            if not all(isinstance(point.get(k), (int, float)) and math.isfinite(point[k]) for k in ('x', 'y')):
                return None
            x, y = point['x'], point['y']; denominator = h[6]*x+h[7]*y+h[8]
            if abs(denominator) < 1e-8:
                return None
            u, v = (h[0]*x+h[1]*y+h[2])/denominator, (h[3]*x+h[4]*y+h[5])/denominator
            return (u, v) if -image.width <= u <= image.width*2 and -image.height <= v <= image.height*2 else None
        for index, entity_id in enumerate(entity_ids):
            point = candidate['pointsByPlayer'][entity_id][frame]
            before = projected(preparation['preparedByPlayer'][entity_id][frame])
            after = projected(point)
            if before:
                u, v = before
                draw.line((u-12, v, u+12, v), fill='#63b3ff', width=4)
                draw.line((u, v-12, u, v+12), fill='#63b3ff', width=4)
                if after:
                    draw.line([before, after], fill='#63b3ff', width=2)
            if not after:
                draw.text((10, 70+index*28), f'{entity_id}: unknown / unavailable', fill='#ffd166', font=font)
                continue
            u, v = after
            color = colors[index % len(colors)]
            draw.ellipse((u-12, v-12, u+12, v+12), outline=color, width=4)
            draw.text((u+16, v), entity_id, fill=color, font=font)
        image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        content, asset = _asset(image, 'ground_reprojection', dict(frame=frame, revision=candidate['revision']), directory)
        images.append(content); assets.append(asset)
    return images, assets
