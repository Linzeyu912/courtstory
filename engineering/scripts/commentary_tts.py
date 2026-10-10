"""Synthesize timed commentary with Alibaba Cloud Qwen-Audio TTS; retain the WAV manifest contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import uuid
import wave
import io
import re
from urllib.parse import urlsplit, urlunsplit

import requests

from environment_file import environment_values

ROOT = Path(__file__).resolve().parents[2]
SPEAKER = 'anmingyuan_v3.1'
MODEL = 'qwen-audio-3.1-tts-flash'
PROVIDER = 'aliyun-qwen-audio'
STYLE = '请用专业中文篮球解说的口吻说话，清晰利落，节奏紧凑自然；战术分析沉稳，进球时适度兴奋，不要喊叫，不要添加文字。'
NATURAL_STYLE = '像熟悉篮球的中文解说自然聊天，分析清楚，调侃时带一点笑意；精彩动作短促兴奋，句间有轻重和停顿，英文感叹顺口，不要每句都喊，不额外添加文字。'
SAMPLE_RATE = 16000


def environment(env_file):
    return environment_values(env_file)


def voice_settings(env_file, speaker=None, engine=None):
    values = environment(env_file)
    return {'provider': PROVIDER, 'speaker': speaker or values.get('QWEN_TTS_VOICE') or SPEAKER,
            'model': engine or values.get('QWEN_TTS_MODEL') or MODEL,
            'sampleRate': SAMPLE_RATE, 'region': 'cn-beijing'}


def credentials(env_file):
    values = environment(env_file)
    key = values.get('DASHSCOPE_API_KEY') or values.get('QWEN_API_KEY')
    if not key:
        raise ValueError('阿里云 TTS 未配置：请设置北京地域 DASHSCOPE_API_KEY。')
    workspace = values.get('SFM_WORKSPACE_ID') or values.get('DASHSCOPE_WORKSPACE_ID')
    if workspace and not re.fullmatch(r'[A-Za-z0-9-]+', workspace):
        raise ValueError('Invalid Alibaba Cloud workspace ID')
    host = f'{workspace}.cn-beijing.maas.aliyuncs.com' if workspace else 'dashscope.aliyuncs.com'
    return {'apiKey': key, 'endpoint': f'https://{host}/api/v1/services/audio/tts/SpeechSynthesizer'}


def synthesize(text, client, speaker, style, engine):
    if style not in (STYLE, NATURAL_STYLE):
        raise ValueError('Only classic and natural voice presets are supported')
    # The instruction is separate from the spoken text; no Polly SSML or AWS fallback.
    instruction = ('专业中文篮球解说，清晰利落，节奏自然，分析沉稳，精彩时适度兴奋。'
                   if style == STYLE else '自然生动的中文篮球解说，轻重分明，适度兴奋，不喊叫。')
    try:
        with requests.post(client['endpoint'], headers={'Authorization': 'Bearer ' + client['apiKey']},
                           json={'model': engine, 'input': {'text': text, 'voice': speaker,
                                 'format': 'wav', 'sample_rate': SAMPLE_RATE, 'instruction': instruction}},
                           timeout=(10, 180)) as response:
            try:
                result = response.json()
            except ValueError:
                raise RuntimeError(f'Alibaba Cloud TTS returned invalid JSON (HTTP {response.status_code})') from None
            if response.status_code != 200 or result.get('code'):
                code = str(result.get('code', response.status_code))
                code = code if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', code) else str(response.status_code)
                raise RuntimeError(f'Alibaba Cloud TTS failed ({code}); check Beijing API key, model access and voice')
        output = result.get('output', {})
        if output.get('finish_reason') != 'stop':
            raise ValueError('Alibaba Cloud TTS did not finish synthesis')
        url = urlsplit(output.get('audio', {}).get('url', ''))
        if url.scheme not in ('http', 'https') or not (url.hostname or '').endswith('.aliyuncs.com') or url.username or url.password or url.port not in (None, 443):
            raise ValueError('Alibaba Cloud TTS returned an invalid audio URL')
        # OSS download needs no API key. Never forward the synthesis authorization.
        with requests.get(urlunsplit(url._replace(scheme='https')), timeout=(10, 90), allow_redirects=False) as response:
            if response.status_code != 200:
                raise RuntimeError(f'Alibaba Cloud audio download failed (HTTP {response.status_code})')
            audio_bytes = response.content
        with wave.open(io.BytesIO(audio_bytes), 'rb') as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, SAMPLE_RATE, 'NONE'):
                raise ValueError('Alibaba Cloud TTS returned an unsupported WAV format')
            frames = audio.getnframes()
            pcm = audio.readframes(frames)
            # The service can return FFmpeg's streaming WAV header (~2 GiB
            # placeholder). HTTP has completed; measure its actual PCM and write
            # a normal seekable WAV below. Ordinary truncated files still fail.
            streaming_header = frames * 2 >= 0x7fff0000
            if not pcm or len(pcm) % 2 or (not streaming_header and len(pcm) != frames * 2):
                raise ValueError('Alibaba Cloud TTS returned incomplete audio')
        return pcm, {'sentences': [], 'usage': result.get('usage', {}), 'requestId': result.get('request_id')}
    except (requests.RequestException, wave.Error, EOFError) as exc:
        # Requests exceptions may contain signed URLs; do not surface them in job logs.
        raise RuntimeError(f'Alibaba Cloud TTS transport/audio failure ({type(exc).__name__})') from None


def _wav_sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def _verified_wav(path, row):
    """Require both the saved byte digest and a complete, correctly typed WAV."""
    try:
        if not row.get('wavSha256') or _wav_sha256(path)!=row['wavSha256']:return False
        with wave.open(str(path),'rb') as audio:
            frames=audio.getnframes()
            if (audio.getnchannels(),audio.getsampwidth(),audio.getframerate(),audio.getcomptype())!=(1,2,SAMPLE_RATE,'NONE') or frames<=0:return False
            if len(audio.readframes(frames))!=frames*2:return False
            return abs(frames/SAMPLE_RATE-float(row['durationSeconds']))<1e-8
    except (OSError,ValueError,KeyError,TypeError,EOFError,wave.Error):return False


def _atomic_json(path, value):
    target=Path(path);temporary=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _copy_verified_wav(source, destination, row):
    destination=Path(destination);temporary=destination.with_name('.tts-'+uuid.uuid4().hex+'.tmp')
    try:
        shutil.copyfile(source,temporary)
        if not _verified_wav(temporary,row):raise ValueError('Cached TTS WAV changed while copying')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def synthesize_plan(plan_path, output, env_file, speaker=None, style=STYLE,
                    engine=None, audio_cache=None):
    config = {**voice_settings(env_file, speaker, engine), 'style': style}
    client = credentials(env_file)
    result = json.loads(Path(plan_path).read_text(encoding='utf-8'))
    cues = result.get('plan', result)['cues']
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'audio-manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest['config'] != config:
            raise ValueError('Existing audio uses different voice settings; choose a new output directory')
    else:
        manifest = {'config': config, 'sectionId': str(uuid.uuid4()), 'cues': []}
    existing = {c['cueId']: c for c in manifest['cues']}
    manifest['cues']=[]
    cache_folder=Path(audio_cache) if audio_cache else None
    if cache_folder:cache_folder.mkdir(parents=True,exist_ok=True)
    for index, cue in enumerate(cues, 1):
        cache_input={'version':2,'text':cue['text'],**config,
                     'format':'pcm_s16le','channels':1,'instructionPresetVersion':1}
        cache_key=hashlib.sha256(json.dumps(cache_input,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()
        name=f'cue-{cache_key}.wav'
        cached = existing.get(cue['cueId'])
        if cached:
            if cached['text'] != cue['text'] and not cache_folder:
                raise ValueError('Existing audio belongs to different commentary; choose a new output directory')
            if cached['text']==cue['text'] and cached.get('cacheKey')==cache_key and _verified_wav(output/cached['path'],cached):
                manifest['cues'].append(cached);_atomic_json(manifest_path,manifest)
                print(f"TTS cached {cue['cueId']}: {cached['durationSeconds']:.2f}s", flush=True)
                continue
        cached=None
        if cache_folder:
            try:
                cached=json.loads((cache_folder/f'{cache_key}.json').read_text(encoding='utf-8'))
            except (OSError,ValueError):pass
            if cached and cached.get('cacheKey')==cache_key and cached.get('text')==cue['text'] and _verified_wav(cache_folder/f'{cache_key}.wav',cached):
                _copy_verified_wav(cache_folder/f'{cache_key}.wav',output/name,cached)
                row={**cached,'cueId':cue['cueId'],'path':name}
                manifest['cues'].append(row);_atomic_json(manifest_path,manifest)
                print(f"TTS shared cache {cue['cueId']}: {row['durationSeconds']:.2f}s",flush=True)
                continue
        pcm, details = synthesize(cue['text'], client, config['speaker'], style, config['model'])
        with wave.open(str(output / name), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(SAMPLE_RATE)
            audio.writeframes(pcm)
        row = {'cueId': cue['cueId'], 'text': cue['text'], 'path': name,
               'durationSeconds': len(pcm) / (SAMPLE_RATE * 2), **details,
               'cacheKey':cache_key,'wavSha256':_wav_sha256(output/name)}
        if not _verified_wav(output/name,row):raise ValueError('Synthesized TTS WAV failed validation')
        if cache_folder:
            _copy_verified_wav(output/name,cache_folder/f'{cache_key}.wav',row)
            _atomic_json(cache_folder/f'{cache_key}.json',row)
        manifest['cues'].append(row)
        _atomic_json(manifest_path,manifest)
        print(f"TTS {cue['cueId']}: {row['durationSeconds']:.2f}s", flush=True)
    return manifest_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env')
    parser.add_argument('--speaker', help='Alibaba Cloud voice ID; default anmingyuan_v3.1 (male)')
    parser.add_argument('--tts-model', '--engine', dest='engine', help='Qwen-Audio TTS model ID')
    parser.add_argument('--style', default=STYLE)
    parser.add_argument('--audio-cache',type=Path,help='Shared verified WAV cache keyed by text and fixed voice configuration')
    args = parser.parse_args()
    try:
        print(synthesize_plan(args.plan, args.output, args.env_file, args.speaker, args.style, args.engine,audio_cache=args.audio_cache))
    except (ValueError, RuntimeError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
