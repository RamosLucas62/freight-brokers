import hashlib, json, os, re, subprocess, tempfile, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 250
TOKEN = os.environ.get("PDF_SCAN_TOKEN", "")
CLAMD_CONFIG = "/app/clamd.conf"
CLAMD_SOCKET = "/tmp/clamd.sock"

clamd = subprocess.Popen(["clamd",f"--config-file={CLAMD_CONFIG}"],stdout=None,stderr=None)
for _ in range(300):
    if clamd.poll() is not None:
        raise RuntimeError("ClamAV daemon stopped during startup")
    if os.path.exists(CLAMD_SOCKET):
        break
    time.sleep(0.1)
else:
    clamd.terminate()
    raise RuntimeError("ClamAV daemon did not become ready")
freshclam = subprocess.Popen(["freshclam","--daemon","--foreground=true"],stdout=subprocess.DEVNULL,stderr=subprocess.STDOUT)

def command(args, timeout=12):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)

class Handler(BaseHTTPRequestHandler):
    server_version = "FreightPdfScanner/1"
    def log_message(self, fmt, *args):
        print(json.dumps({"component":"pdf-scanner","message":fmt % args}))
    def reply(self, status, payload):
        print(json.dumps({"component":"pdf-scanner","event":"scan.completed","status_code":status,"safe":payload.get("safe",False),"reason":payload.get("reason"),"page_count":payload.get("page_count",0)}),flush=True)
        body=json.dumps(payload).encode(); self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        self.connection.settimeout(30)
        if self.path != "/scan" or self.headers.get("Authorization") != "Bearer "+TOKEN or not TOKEN:
            self.reply(404,{"safe":False,"page_count":0,"reason":"not_found"}); return
        if clamd.poll() is not None or not os.path.exists(CLAMD_SOCKET):
            self.reply(503,{"safe":False,"page_count":0,"reason":"scanner_unavailable"}); return
        try: length=int(self.headers.get("Content-Length","0"))
        except ValueError: length=0
        if length < 5 or length > MAX_BYTES or self.headers.get_content_type() != "application/pdf":
            self.reply(413,{"safe":False,"page_count":0,"reason":"size"}); return
        data=self.rfile.read(length)
        if len(data)!=length or not data.startswith(b"%PDF-"):
            self.reply(400,{"safe":False,"page_count":0,"reason":"format"}); return
        with tempfile.TemporaryDirectory(prefix="scan-") as folder:
            path=os.path.join(folder,hashlib.sha256(data).hexdigest()+".pdf")
            with open(path,"xb") as handle: handle.write(data)
            try:
                virus=command(["clamdscan",f"--config-file={CLAMD_CONFIG}","--no-summary",path],12)
            except subprocess.TimeoutExpired:
                self.reply(503,{"safe":False,"page_count":0,"reason":"scanner_timeout"}); return
            except OSError:
                self.reply(503,{"safe":False,"page_count":0,"reason":"scanner_unavailable"}); return
            if virus.returncode != 0:
                status=422 if virus.returncode==1 else 503
                self.reply(status,{"safe":False,"page_count":0,"reason":"malware" if virus.returncode==1 else "scanner_error"}); return
            checked=command(["qpdf","--check","--warning-exit-0",path])
            encrypted=command(["qpdf","--is-encrypted",path])
            if checked.returncode != 0 or encrypted.returncode == 0:
                self.reply(422,{"safe":False,"page_count":0,"reason":"invalid_or_encrypted"}); return
            raw=command(["strings",path]).stdout
            if re.search(r"/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b",raw):
                self.reply(422,{"safe":False,"page_count":0,"reason":"active_content"}); return
            info=command(["pdfinfo",path]).stdout
            match=re.search(r"^Pages:\s+(\d+)",info,re.MULTILINE); pages=int(match.group(1)) if match else 0
            if pages < 1 or pages > MAX_PAGES:
                self.reply(422,{"safe":False,"page_count":pages,"reason":"page_limit"}); return
            self.reply(200,{"safe":True,"page_count":pages})

ThreadingHTTPServer(("0.0.0.0",8080),Handler).serve_forever()
