        if scope == 'play' and (document.get('annotations', {}).get('items') or play['actions'] or play['relations'] or len(play['phases']) > 1 or document.get('presentation', {}).get('routes')):
            raise ValueError('已有人工内容时，请选择当前阶段追加建议。')
        start, end = (phase['startFrame'], phase['endFrameExclusive']) if scope == 'phase' else (play['phases'][0]['startFrame'], play['phases'][-1]['endFrameExclusive'])
        count = min(self.max_images, end - start)
        indices = sorted(set([start + round(i * (end - start - 1) / max(1, count - 1)) for i in range(count)] + [phase['freezeFrame']]))
        if len(indices) > count:
            indices.remove(min((f for f in indices if f not in (start, end - 1, phase['freezeFrame'])), key=lambda f: abs(f - phase['freezeFrame'])))
        with self.lock:
            if self.closed:
