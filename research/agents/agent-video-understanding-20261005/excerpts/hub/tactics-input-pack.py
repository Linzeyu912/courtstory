
    def _run(self, job):
        try:
            if not self._state(job, 'preparing', '正在读取准确视频帧与轨迹'):
                return
            directory = self.folder / job['jobId']
            directory.mkdir()
            frames = self.tactics.frames(job['video'], job['clip'], job['indices'])
            images = []
            for frame in frames:
                path = directory / f"frame-{frame['frame']:06d}.jpg"
                path.write_bytes(base64.b64decode(frame['dataUrl'].split(',', 1)[1], validate=True))
                images.append(path)
            references = style_references()
            images.extend(path for path, _metadata in references)
            schema_path, result_path = directory / 'schema.json', directory / 'result.json'
            atomic_json(schema_path, self.tactics.run('agent-schema'))
            review = job['document']['review']
            play = job['document']['playDefinition']
            phase = next(p for p in play['phases'] if p['phaseId'] == job['request']['phaseId'])
            start, end = (phase['startFrame'], phase['endFrameExclusive']) if job['request']['scope'] == 'phase' else (play['startFrame'], play['endFrameExclusive'])
            count = min(96, end - start)
            trajectory_frames = set(job['indices']) | {start + round(i * (end - start - 1) / max(1, count - 1)) for i in range(count)}
            evidence = agent_entity_inputs(review['entities'], trajectory_frames, clip=job['clip'])
            pack = {'goal': job['request'].get('goal', ''), 'scope': job['request']['scope'],
                    'phaseId': job['request']['phaseId'], 'playDefinition': job['document']['playDefinition'],
                    'binding': job['document']['playDefinition']['sourceBinding'], 'width': review['width'], 'height': review['height'],
                    'clipFrameCount': len(review['sourceFrameMapping']), 'analysisRange': {'startFrame': start, 'endFrameExclusive': end},
                    'sourceFrameMapping': [frame for frame in review['sourceFrameMapping'] if frame['frame'] in trajectory_frames], **evidence,
                    'existingAnnotations': [{key: deepcopy(value) for key, value in item.items() if key not in ('sourceBinding','phaseSnapshot','origin')}
                                            for item in job['document'].get('annotations', {}).get('items', []) if item['phaseId'] == phase['phaseId']],
                    'court': review.get('court'),
                    'existingProduction': deepcopy(job['document'].get('production')),
                    'styleReferences': [metadata for _path, metadata in references],
                    'images': [{k: v for k, v in f.items() if k != 'dataUrl'} for f in frames]}
            atomic_json(directory / 'input.json', pack)
