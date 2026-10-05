"""Local vision boundary: image paths + prompt + JSON schema -> JSON object.

A future API adapter must implement VisionProvider, load credentials only from
trusted server configuration, transmit only these explicitly supplied images and
prompt, obey cancellation/timeouts, and return JSON for caller-side validation.
The browser cannot supply endpoints or secrets. No HTTP adapter is configured.
"""
from pathlib import Path
import threading
from typing import Protocol

from tactics_agent import TacticsAgent, _validate_model, discover_codex, trusted_model_settings


class VisionProvider(Protocol):
    def status(self) -> dict: ...

    def generate(self, *, job: dict, directory: Path, schema: Path,
                 result: Path, images: list[Path], prompt: str) -> dict: ...


class CodexVisionProvider:
    """Reuse the audited CLI runner, with tools/rules and parent session disabled."""
    def __init__(self, codex_path=None, timeout=300, execute=None, lock=None,
                 system_proxy_fallback=True, reasoning_effort=None):
        self.codex = str(codex_path or discover_codex())
        self.timeout = timeout
        self.lock = lock or threading.RLock()
        self.execute = execute
        self.system_proxy_fallback = system_proxy_fallback
        _validate_model(None, reasoning_effort)
        self.reasoning_effort = reasoning_effort

    def status(self):
        try:
            model, effort = trusted_model_settings()
        except ValueError as exc:
            return {'available': False, 'provider': 'codex-cli', 'message': str(exc)}
        available = bool(self.execute or self.codex and Path(self.codex).is_file())
        return {'available': available, 'provider': 'codex-cli', 'sandbox': 'read-only',
                'model': model, 'reasoningEffort': self.reasoning_effort or effort,
                'message': '已配置 Codex；运行时核验登录、额度与视觉能力。' if available else '尚未配置可用的 Codex CLI。'}

    def generate(self, **kwargs):
        return self.execute(**kwargs) if self.execute else TacticsAgent._execute_cli(self, **kwargs)


class MultimodalApiProvider:
    def status(self):
        return {'available': False, 'provider': 'multimodal-api',
                'message': '多模态 API 接口尚未配置；当前请使用本机 Codex。'}

    def generate(self, **_kwargs):
        raise ValueError(self.status()['message'])


def create_provider(name='codex', **kwargs) -> VisionProvider:
    if name == 'codex':
        return CodexVisionProvider(**kwargs)
    if name == 'multimodal-api':
        return MultimodalApiProvider()
    raise ValueError('不支持的视觉 provider。')
