    def _decode(self, job, indices):
        indices = sorted(set(indices) - job['frames'].keys())
        for offset in range(0, len(indices), 40):
            if job['cancel'].is_set():
                raise ValueError('任务已取消。')
            values = self.tactics.frames(job['video'], job['clip'], indices[offset:offset + 40])
            for value in values:
                job['frames'][value['frame']] = value

    @staticmethod
    def _image(job, frame):
        encoded = job['frames'][frame]['dataUrl'].split(',', 1)[1]
        return Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))).convert('RGB')

    def _tile(self, job, frame, track_id, size=(184, 224)):
        row = _row(job['clip'], frame, track_id)
        if row is None:
            raise ValueError('证据帧中没有唯一的原始人物框。')
        source = self._image(job, frame)
        x1, y1, x2, y2 = row[:4]
        if not all(type(n) in (int, float) and math.isfinite(n) for n in row[:4]) or x2 <= x1 or y2 <= y1:
            raise ValueError('原始人物框无效。')
        # Modest context around a detector box; never synthesize image details.
        pad = max(2, (x2 - x1) * .08)
        box = (max(0, math.floor(x1-pad)), max(0, math.floor(y1-pad)),
               min(source.width, math.ceil(x2+pad)), min(source.height, math.ceil(y2+pad)))
        crop = source.crop(box)
        canvas = Image.new('RGB', size, '#171b25')
        fitted = ImageOps.contain(crop, (size[0]-8, size[1]-30), Image.Resampling.LANCZOS)
        canvas.paste(fitted, ((size[0]-fitted.width)//2, 27))
        ImageDraw.Draw(canvas).text((6, 6), f'frame {frame} | T{track_id}', fill='white')
        return canvas
