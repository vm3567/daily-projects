# Local test server for docs/ that never lets the browser keep old copies of files.
# Used by .claude/launch.json. Open http://localhost:8080/?mock=1 for test mode.
import functools
import http.server
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    http.server.ThreadingHTTPServer(('127.0.0.1', 8080), handler).serve_forever()
