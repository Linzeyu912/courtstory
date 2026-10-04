"""Serve a local comparison report with byte-range support for video playback."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re


class ReportHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_count=None
        root=Path(self.directory).resolve()
        path=Path(self.translate_path(self.path)).resolve()
        if path.is_dir():path=path/'index.html'
        if not path.is_relative_to(root) or not path.is_file():
            self.send_error(404);return None
        stream=path.open('rb');size=path.stat().st_size
        start,end,status=0,size-1,200
        requested=self.headers.get('Range')
        if requested:
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',requested.strip())
            try:
                if not match or not any(match.groups()) or size==0:raise ValueError()
                first,last=match.groups()
                if first:
                    start=int(first);end=min(int(last),size-1) if last else size-1
                else:
                    count=int(last)
                    if count<=0:raise ValueError()
                    start=max(0,size-count)
                if start>=size or end<start:raise ValueError()
                status=206
            except ValueError:
                stream.close();self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers();return None
        self.byte_count=max(0,end-start+1)
        self.send_response(status)
        self.send_header('Content-Type',self.guess_type(str(path)))
        self.send_header('Content-Length',str(self.byte_count))
        self.send_header('Accept-Ranges','bytes')
        self.send_header('Cache-Control','no-store')
        if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.end_headers();stream.seek(start);return stream

    def copyfile(self,source,outputfile):
        remaining=self.byte_count
        try:
            while remaining:
                block=source.read(min(256*1024,remaining))
                if not block:break
                outputfile.write(block);remaining-=len(block)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):
            # Switching a video cancels its outstanding range request.
            pass


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',required=True);p.add_argument('--port',type=int,default=8898);a=p.parse_args()
    root=Path(a.directory).resolve()
    if not (root/'index.html').is_file():p.error('directory must contain index.html')
    server=ThreadingHTTPServer(('127.0.0.1',a.port),partial(ReportHandler,directory=str(root)))
    print(f'http://127.0.0.1:{a.port}/',flush=True);server.serve_forever()

if __name__=='__main__':main()
