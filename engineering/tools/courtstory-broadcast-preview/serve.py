"""Serve the isolated CourtStory UI prototype and one explicit local video."""

from __future__ import annotations

import argparse
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


PREVIEW_DIR = Path(__file__).resolve().parent
REPOSITORY_DIR = PREVIEW_DIR.parents[2]
DEFAULT_VIDEO = REPOSITORY_DIR / "data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4"
PUBLIC_FILES = {"index.html", "preview.css", "preview.mjs"}


def byte_range(value: str | None, size: int) -> tuple[int, int] | None:
    """Return a single inclusive range; reject invalid or unsatisfiable ranges."""
    if value is None:
        return None
    if not value.startswith("bytes=") or "," in value or size == 0:
        raise ValueError("Unsupported byte range")
    bounds = value[6:].split("-")
    if len(bounds) != 2:
        raise ValueError("Invalid byte range")
    first, last = bounds
    if first:
        if not first.isascii() or not first.isdigit():
            raise ValueError("Invalid range start")
        start = int(first)
        if last and (not last.isascii() or not last.isdigit()):
            raise ValueError("Invalid range end")
        end = min(int(last), size - 1) if last else size - 1
        if start >= size or end < start:
            raise ValueError("Unsatisfiable byte range")
        return start, end
    if not last or not last.isascii() or not last.isdigit() or int(last) <= 0:
        raise ValueError("Invalid suffix range")
    return max(0, size - int(last)), size - 1


def make_handler(video: Path, poster: Path | None = None):
    class PreviewHandler(BaseHTTPRequestHandler):
        server_version = "CourtStoryPreview/1.0"

        def do_GET(self):
            self._serve(send_body=True)

        def do_HEAD(self):
            self._serve(send_body=False)

        def _target(self) -> tuple[Path, str] | None:
            try:
                route = unquote(urlsplit(self.path).path, errors="strict")
            except (UnicodeError, ValueError):
                return None
            if any(char in route for char in ("\\", "\x00", ":")) or any(part in {".", ".."} for part in route.split("/")):
                return None
            if route == "/demo.mp4":
                return video, "video/mp4"
            if route == "/demo-poster.jpg" and poster is not None:
                return poster, "image/jpeg"
            name = "index.html" if route == "/" else route.removeprefix("/")
            if name not in PUBLIC_FILES and not name.startswith("assets/"):
                return None
            target = (PREVIEW_DIR / name).resolve()
            allowed_root = PREVIEW_DIR / "assets" if name.startswith("assets/") else PREVIEW_DIR
            if not target.is_relative_to(allowed_root) or not target.is_relative_to(PREVIEW_DIR):
                return None
            if name in PUBLIC_FILES and target != PREVIEW_DIR / name:
                return None
            mime_type = "text/javascript" if target.suffix == ".mjs" else mimetypes.guess_type(target.name)[0]
            return target, mime_type or "application/octet-stream"

        def _serve(self, send_body: bool):
            match = self._target()
            if match is None:
                self.send_error(404, "Not found")
                return
            target, mime_type = match
            try:
                if not target.is_file():
                    self.send_error(404, "Not found")
                    return
                source = target.open("rb")
            except OSError:
                self.send_error(404, "Not found")
                return
            with source:
                source.seek(0, 2)
                size = source.tell()
                try:
                    selected_range = byte_range(self.headers.get("Range"), size)
                except ValueError:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    return
                start, end = selected_range if selected_range else (0, size - 1)
                self.send_response(206 if selected_range else 200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(max(0, end - start + 1)))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                if selected_range:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                if not send_body:
                    return
                source.seek(start)
                remaining = end - start + 1
                try:
                    while remaining > 0:
                        chunk = source.read(min(256 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    # Seeking or closing the browser cancels the previous media request.
                    pass

    return PreviewHandler


def main():
    parser = argparse.ArgumentParser(description="CourtStory 独立 UI 样稿：只读取指定本地媒体")
    parser.add_argument("--port", type=int, default=8898, help="本机预览端口，默认 8898")
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO, help="已存在的本地 MP4，路径相对于当前工作目录")
    parser.add_argument("--poster", type=Path, help="可选的本地 JPG 封面，路径相对于当前工作目录")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port 必须在 1–65535 之间")
    video = args.video.resolve()
    if not video.is_file():
        parser.error("视频不存在；请用 --video 指定已存在的本地 MP4")
    with video.open("rb") as source:
        if source.read(128).startswith(b"version https://git-lfs.github.com/spec/v1"):
            parser.error("视频仍为 Git LFS 指针；请用 --video 指定已有真实视频，无需复制到预览目录")
    poster = args.poster.resolve() if args.poster else None
    if poster is not None and (not poster.is_file() or poster.suffix.lower() not in {".jpg", ".jpeg"}):
        parser.error("--poster 必须指向已存在的 JPG 图片")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(video, poster))
    print(f"CourtStory UI preview: http://127.0.0.1:{args.port}/", flush=True)
    print("仅本机设计样稿；Ctrl+C 结束。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
