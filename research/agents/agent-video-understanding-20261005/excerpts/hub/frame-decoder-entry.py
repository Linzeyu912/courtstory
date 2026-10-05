    def frames(self, video, clip, indices):
        import av
        if (not isinstance(indices, list) or not indices or len(indices) > 40
                or any(type(i) is not int or not 0 <= i < len(clip['frames']) for i in indices)):
            raise ValueError('冻结帧范围不正确，一次最多读取 40 帧。')
        if file_hash(video) != clip['video_sha256']:
            raise ValueError('视频文件已变化，请重启服务重新核对来源。')
        requested = set(indices)
        result = []
        with av.open(str(video)) as container:
            for index, frame in enumerate(container.decode(video=0)):
                if index not in requested:
                    continue
                record = clip['frames'][index]
                if frame.time is None or abs(float(frame.time) - record['time']) > 1e-7:
                    raise ValueError('解码时间与轨迹帧时间不一致，已停止叠加。')
                if (frame.width, frame.height) != (clip['width'], clip['height']):
                    raise ValueError('视频尺寸与轨迹不一致。')
                buffer = io.BytesIO(); frame.to_image().save(buffer, format='JPEG', quality=94)
                data = buffer.getvalue()
                result.append({'frame': index, 'time': record['time'], 'sourceFrame': record.get('source_frame', index),
                    'sourceTime': record.get('source_time', record['time']), 'videoSha256': clip['video_sha256'],
                    'sha256': hashlib.sha256(data).hexdigest(), 'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(data).decode(),
                    'decoder': f'PyAV {av.__version__}', 'pts': frame.pts, 'timeBase': str(frame.time_base)})
                if len(result) == len(requested): break
        if len(result) != len(requested):
            raise ValueError('未解码到全部冻结帧。')
        return result
