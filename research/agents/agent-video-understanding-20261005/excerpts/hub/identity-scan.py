            ref = job['request']['reference']
            reference_image = self._reference_image(job, directory)
            common = dict(reference=ref, entityId=job['entityId'])
            if job['purpose'] == 'reference':
                output = self._call(job, directory/'reference', {**common, 'stage':'reference'}, REFERENCE_SCHEMA,
                    [reference_image], ('Agent 正在辨认球衣与号码', '只识别参考图的球衣颜色和可见号码；reason说明是否清楚。'))
                team, jersey = self._labels(output)
                candidate = dict(team=team, jersey=jersey, segments=[])
            else:
                interval = job['request']['range']
                indices = _sample(interval['start'], interval['end'], self.max_scan_frames)
                self._decode(job, indices)
                images, shown, image_metadata = [reference_image], set(), []
                for frame in indices:
                    tracks = [r[4] for r in job['clip']['frames'][frame].get('tracks', [])
                              if len(r) >= 5 and type(r[4]) is int and r[4] > 0]
                    if len(tracks) > 25 or len(set(tracks)) != len(tracks):
                        raise ValueError('单帧人物过多或编号重复，请缩小到清楚的比赛画面。')
                    if not tracks:
                        continue
                    pairs = [(frame, t) for t in tracks]
                    shown.update(pairs)
                    images.append(self._sheet(job, pairs, directory/f'scan-{frame}.jpg'))
                    image_metadata.append(dict(frame=frame, trackIds=tracks))
                output = self._call(job, directory/'scan', {**common, 'stage':'scan', 'range':interval,
                    'images':image_metadata}, SCAN_SCHEMA, images, ('Agent 正在抽样查找同一球员',
                    '在每张联系图中找参考球员，重点比较实际球衣颜色、号码与外观。最多12个matches，只能用附图提供的frame/trackId。'
                    '要覆盖不同时间，不要把预算集中在同一瞬间；不确定时跳过。此步骤只给单帧候选，不延伸整个T。'))
                windows = self._windows(job, output, shown)
                if windows:
                    self._decode(job, [f for w in windows for f in w['evidenceFrames']])
