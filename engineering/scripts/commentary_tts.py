"""Synthesize timed commentary with Volcengine Seed TTS 2.0."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.error
import urllib.request
import uuid
import wave

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
RESOURCE = 'seed-tts-2.0'
SPEAKER = 'zh_female_vv_uranus_bigtts'
STYLE = '请用专业中文篮球解说的口吻说话，清晰利落，节奏紧凑自然；战术分析沉稳，进球时适度兴奋，不要喊叫，不要添加文字。'
NATURAL_STYLE = '像熟悉篮球的中文解说自然聊天，分析清楚，调侃时带一点笑意；精彩动作短促兴奋，句间有轻重和停顿，英文感叹顺口，不要每句都喊，不额外添加文字。'
SAMPLE_RATE = 24000


def credentials(env_file, key_env='VOLCENGINE_TTS_API_KEY'):
    values = {**dotenv_values(env_file, encoding='utf-8-sig'), **os.environ}
    key = (values.get(key_env) or '').strip()
    if not key:
        raise ValueError(f'Missing {key_env}. Use the Doubao Speech console API key: '
                         'https://console.volcengine.com/speech/new/setting/apikeys')
    return key


def request_body(text, speaker, style, section_id):
    return {'user': {'uid': 'broadcastcode-commentary'}, 'req_params': {
        'text': text, 'speaker': speaker,
        'audio_params': {'format': 'pcm', 'sample_rate': SAMPLE_RATE,
                         'speech_rate': 0, 'enable_subtitle': True},
        'additions': json.dumps({'context_texts': [style], 'section_id': section_id}, ensure_ascii=False),
    }}


def read_audio_stream(lines):
    """An explicit terminal packet is needed before accepting streamed audio."""
    chunks, sentences, usage, completed = [], [], {}, False
    for line in lines:
        line = line.decode('utf-8') if isinstance(line, bytes) else line
        line = line.strip()
        if not line or line.startswith(('event:', ':')):
            continue
        if line.startswith('data:'):
            line = line[5:].strip()
        packet = json.loads(line)
        code = packet.get('code')
        if code not in (0, 20000000):
            raise RuntimeError(f"TTS code {code}: {packet.get('message', 'unknown error')}")
        if packet.get('data'):
            chunks.append(base64.b64decode(packet['data'], validate=True))
        if packet.get('sentence'):
            sentences.append(packet['sentence'])
        if packet.get('usage'):
            usage = packet['usage']
        if code == 20000000:
            completed = True
            break
    pcm = b''.join(chunks)
    if not completed or not pcm or len(pcm) % 2:
        raise RuntimeError('TTS stream incomplete or invalid PCM; no finished audio was saved')
    return pcm, sentences, usage


def synthesize(text, key, speaker, style, section_id):
    body = request_body(text, speaker, style, section_id)
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode('utf-8'), headers={
        'Content-Type': 'application/json', 'X-Api-Key': key,
        'X-Api-Resource-Id': RESOURCE, 'X-Api-Request-Id': str(uuid.uuid4()),
        'X-Control-Require-Usage-Tokens-Return': '*',
    })
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            pcm, sentences, usage = read_audio_stream(response)
            return pcm, {'sentences': sentences, 'usage': usage,
                         'logId': response.headers.get('X-Tt-Logid')}
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode('utf-8', errors='replace').replace(key, '[REDACTED]')
        raise RuntimeError(f'Volcengine TTS HTTP {exc.code}: {detail}') from None
    except (urllib.error.URLError, RuntimeError) as exc:
        raise RuntimeError(str(exc).replace(key, '[REDACTED]')) from None


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


def synthesize_plan(plan_path, output, env_file, speaker=SPEAKER, style=STYLE,
                    key_env='VOLCENGINE_TTS_API_KEY', audio_cache=None):
    key = credentials(env_file, key_env)
    result = json.loads(Path(plan_path).read_text(encoding='utf-8'))
    cues = result.get('plan', result)['cues']
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'audio-manifest.json'
    config = {'provider': 'volcengine', 'resourceId': RESOURCE, 'speaker': speaker,
              'style': style, 'sampleRate': SAMPLE_RATE}
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
        cache_input={'version':1,'text':cue['text'],**config,'endpoint':ENDPOINT,
                     'format':'pcm_s16le','channels':1,'speechRate':0,'enableSubtitle':True}
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
        pcm, details = synthesize(cue['text'], key, speaker, style, manifest['sectionId'])
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
    parser.add_argument('--key-env', default='VOLCENGINE_TTS_API_KEY')
    parser.add_argument('--speaker', default=SPEAKER)
    parser.add_argument('--style', default=STYLE)
    parser.add_argument('--audio-cache',type=Path,help='Shared verified WAV cache keyed by text and fixed voice configuration')
    args = parser.parse_args()
    try:
        print(synthesize_plan(args.plan, args.output, args.env_file, args.speaker, args.style, args.key_env,audio_cache=args.audio_cache))
    except (ValueError, RuntimeError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
