"""Synthesize timed commentary with Amazon Polly; retain the WAV manifest contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import uuid
import wave
from xml.sax.saxutils import escape

from environment_file import environment_values

ROOT = Path(__file__).resolve().parents[2]
SPEAKER = 'Zhiyu'
STYLE = '请用专业中文篮球解说的口吻说话，清晰利落，节奏紧凑自然；战术分析沉稳，进球时适度兴奋，不要喊叫，不要添加文字。'
NATURAL_STYLE = '像熟悉篮球的中文解说自然聊天，分析清楚，调侃时带一点笑意；精彩动作短促兴奋，句间有轻重和停顿，英文感叹顺口，不要每句都喊，不额外添加文字。'
SAMPLE_RATE = 16000


def environment(env_file):
    return environment_values(env_file)


def voice_settings(env_file, speaker=None, engine=None):
    values = environment(env_file)
    selected_engine = engine or values.get('POLLY_ENGINE') or 'neural'
    if selected_engine not in ('standard', 'neural', 'long-form', 'generative'):
        raise ValueError('Invalid POLLY_ENGINE')
    return {'provider': 'amazon-polly', 'speaker': speaker or values.get('POLLY_VOICE_ID') or SPEAKER,
            'engine': selected_engine, 'sampleRate': SAMPLE_RATE,
            'region': values.get('AWS_REGION') or values.get('AWS_DEFAULT_REGION') or 'us-east-1'}


def credentials(env_file):
    """Use the SDK credential chain (SSO/profile, environment or instance role)."""
    try:
        import boto3
        import botocore.session
        from botocore.config import Config
        values = environment(env_file)
        session = botocore.session.get_session()
        for name, variable in (('AWS_CONFIG_FILE', 'config_file'),
                               ('AWS_SHARED_CREDENTIALS_FILE', 'credentials_file')):
            if values.get(name):
                session.set_config_variable(variable, values[name])
        options = {'botocore_session': session, 'region_name': voice_settings(env_file)['region']}
        if values.get('AWS_PROFILE'):
            options['profile_name'] = values['AWS_PROFILE']
        if values.get('AWS_ACCESS_KEY_ID') or values.get('AWS_SECRET_ACCESS_KEY'):
            if not values.get('AWS_ACCESS_KEY_ID') or not values.get('AWS_SECRET_ACCESS_KEY'):
                raise ValueError('AWS access key and secret must be configured together')
            options.update(aws_access_key_id=values['AWS_ACCESS_KEY_ID'],
                           aws_secret_access_key=values['AWS_SECRET_ACCESS_KEY'],
                           aws_session_token=values.get('AWS_SESSION_TOKEN'))
        aws = boto3.Session(**options)
        resolved = aws.get_credentials()
        if resolved is None:
            raise ValueError('Missing AWS credentials for Amazon Polly; configure AWS_PROFILE or an IAM role')
        resolved.get_frozen_credentials()  # Resolve expired SSO before starting paid model work.
        return aws.client('polly', config=Config(connect_timeout=10, read_timeout=90,
                          retries={'total_max_attempts': 2, 'mode': 'standard'}))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f'Amazon Polly credentials unavailable ({type(exc).__name__}); check AWS login and boto3') from None


def synthesize(text, client, speaker, style, engine):
    # Preserve the two UI presets; Polly controls pace, not natural-language emotion.
    rates = {STYLE: '100%', NATURAL_STYLE: '105%'}
    if style not in rates:
        raise ValueError('Polly supports the classic and natural voice presets only')
    ssml = f'<speak><prosody rate="{rates[style]}">{escape(text)}</prosody></speak>'
    try:
        response = client.synthesize_speech(Text=ssml, TextType='ssml', VoiceId=speaker,
                                           Engine=engine, OutputFormat='pcm', SampleRate=str(SAMPLE_RATE))
        stream = response['AudioStream']
        try:
            pcm = stream.read()
        finally:
            stream.close()
        if not pcm or len(pcm) % 2:
            raise ValueError('Amazon Polly returned empty or invalid PCM')
        return pcm, {'sentences': [], 'usage': {'requestCharacters': response.get('RequestCharacters')},
                     'requestId': response.get('ResponseMetadata', {}).get('RequestId')}
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        code = getattr(exc, 'response', {}).get('Error', {}).get('Code', type(exc).__name__)
        raise RuntimeError(f'Amazon Polly synthesis failed ({code}); check voice, engine and IAM permission') from None


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
                     'format':'pcm_s16le','channels':1,'ssmlPresetVersion':1}
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
        pcm, details = synthesize(cue['text'], client, config['speaker'], style, config['engine'])
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
    parser.add_argument('--speaker', help='Polly voice ID; default POLLY_VOICE_ID or Zhiyu')
    parser.add_argument('--engine', help='Polly engine; default POLLY_ENGINE or neural')
    parser.add_argument('--style', default=STYLE)
    parser.add_argument('--audio-cache',type=Path,help='Shared verified WAV cache keyed by text and fixed voice configuration')
    args = parser.parse_args()
    try:
        print(synthesize_plan(args.plan, args.output, args.env_file, args.speaker, args.style, args.engine,audio_cache=args.audio_cache))
    except (ValueError, RuntimeError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
