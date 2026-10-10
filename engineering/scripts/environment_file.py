"""Read one known environment file without directory searches or secret errors."""
import codecs
import io
import os
from pathlib import Path

from dotenv import dotenv_values


def environment_text(path, *, missing_ok=False):
    if path is None:
        return ''
    try:
        raw=Path(path).read_bytes()
    except FileNotFoundError:
        if missing_ok:return ''
        raise ValueError(f'Cannot read --env-file: {path}') from None
    except OSError:
        raise ValueError(f'Cannot read --env-file: {path}') from None
    try:
        if raw.startswith((codecs.BOM_UTF32_LE,codecs.BOM_UTF32_BE)):
            raise ValueError('unsupported encoding')
        encoding='utf-16' if raw.startswith((codecs.BOM_UTF16_LE,codecs.BOM_UTF16_BE)) else 'utf-8-sig'
        text=raw.decode(encoding)
        if '\x00' in text:raise ValueError('unsupported encoding')
        return text
    except (UnicodeError,ValueError):
        raise ValueError(f'Invalid encoding in --env-file: {path}; use UTF-8 or UTF-16 with a BOM') from None


def environment_values(path, *, missing_ok=True):
    # Supplying a stream prevents python-dotenv from searching parent folders.
    loaded=dotenv_values(stream=io.StringIO(environment_text(path,missing_ok=missing_ok)))
    return {**loaded,**os.environ}
