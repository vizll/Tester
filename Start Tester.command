#!/bin/zsh
cd -- "$(dirname -- "$0")"
python3 - <<'PY'
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
import webbrowser
root=Path.cwd()/'dist'
for port in range(8000,8011):
    try:
        server=ThreadingHTTPServer(('127.0.0.1',port),partial(SimpleHTTPRequestHandler,directory=str(root)))
        break
    except OSError: continue
else: raise SystemExit('No free port. Close another local preview and try again.')
url=f'http://localhost:{port}/'
print(f'Tester is ready at {url}\nKeep this window open. Press Control+C to stop.')
webbrowser.open(url)
try: server.serve_forever()
except KeyboardInterrupt: pass
finally: server.server_close()
PY
