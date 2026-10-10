"""Locate a CJK font for commentary on the supported desktop/cloud hosts."""
from pathlib import Path


DEFAULT_FONTS = (
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    '/System/Library/Fonts/PingFang.ttc',
)


def resolve_font(explicit=None):
    candidates = (str(explicit),) if explicit is not None else DEFAULT_FONTS
    for value in candidates:
        path = Path(value).expanduser()
        if path.is_file():
            return path.resolve()
    if explicit is not None:
        raise ValueError(f'Font not found: {explicit}')
    raise ValueError('No CJK font found; install fonts-noto-cjk on Linux or supply --font')
