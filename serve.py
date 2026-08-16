#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import socket
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]

url = f"http://127.0.0.1:{port}/"
server = ThreadingHTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler)
print(f"Serving {ROOT}\nOpen {url}\nPress Ctrl+C to stop.")
threading.Timer(0.4, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
