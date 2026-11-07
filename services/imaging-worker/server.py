"""Authenticated, one-job-per-request Vercel container service. No infinite loop."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from urllib.parse import urlsplit
from worker import HostedBackend, InvalidStudy, scan

_lock=threading.Lock()
_scanner_lock=threading.Lock()
_checked_at=0

def scanner_ready():
    """Keep antivirus definitions current, fail closed if download/scan fails."""
    global _checked_at
    with _scanner_lock:
        if time.time()-_checked_at<3600:return
        target=Path('/tmp/medi-clamav')
        target.mkdir(mode=0o700,exist_ok=True)
        stamp=target/'updated'
        if not stamp.exists() or time.time()-stamp.stat().st_mtime>24*3600:
            try:
                result=subprocess.run(['freshclam','--datadir='+str(target),'--log=/tmp/medi-freshclam.log','--quiet'],capture_output=True,timeout=110)
            except (OSError,subprocess.TimeoutExpired) as e:
                raise RuntimeError('SCANNER_UNAVAILABLE') from e
            if result.returncode!=0:raise RuntimeError('SCANNER_UNAVAILABLE')
            stamp.touch()
        os.environ['MEDI_CLAMAV_DATABASE']=str(target)
        with tempfile.NamedTemporaryFile() as probe:scan(Path(probe.name))
        _checked_at=time.time()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_args):pass  # Do not log request headers, bodies or IDs.

    def reply(self,status,payload):
        data=json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers();self.wfile.write(data)

    def authorized(self):
        secret=os.environ.get('MEDI_IMAGING_WORKER_SECRET','')
        return len(secret)>=64 and hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+secret)

    def do_GET(self):
        if urlsplit(self.path).path!='/api/imaging-process/health':return self.reply(404,{'error':'NOT_FOUND'})
        if not self.authorized():return self.reply(401,{'error':'UNAUTHORIZED'})
        try:scanner_ready();self.reply(200,{'ready':True,'mode':'vercel_on_demand','max_compressed_bytes':64*1024**2,'max_expanded_bytes':192*1024**2})
        except Exception:self.reply(503,{'ready':False,'error':'SCANNER_UNAVAILABLE'})

    def do_POST(self):
        if urlsplit(self.path).path=='/api/imaging-process/self-test':
            if not self.authorized():return self.reply(401,{'error':'UNAUTHORIZED'})
            if os.environ.get('MEDI_IMAGING_SELF_TEST')!='1':return self.reply(404,{'error':'NOT_FOUND'})
            if not _lock.acquire(blocking=False):return self.reply(429,{'error':'BUSY'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=128:return self.reply(400,{'error':'INVALID_BODY'})
                if json.loads(self.rfile.read(size))!={'run':'synthetic'}:return self.reply(400,{'error':'INVALID_BODY'})
                scanner_ready()
                from selftest import run_self_test
                return self.reply(200,run_self_test())
            except Exception:return self.reply(503,{'error':'SELF_TEST_UNAVAILABLE'})
            finally:_lock.release()
        if urlsplit(self.path).path!='/api/imaging-process':return self.reply(404,{'error':'NOT_FOUND'})
        if not self.authorized():return self.reply(401,{'error':'UNAUTHORIZED'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=1024:return self.reply(400,{'error':'INVALID_BODY'})
            body=json.loads(self.rfile.read(size));delivery=str(uuid.UUID(body['id']))
        except Exception:return self.reply(400,{'error':'INVALID_BODY'})
        # Limit local concurrency to one antivirus process per container instance.
        if not _lock.acquire(blocking=False):return self.reply(429,{'error':'BUSY'})
        try:
            scanner_ready()
            backend=HostedBackend();job=backend.rpc('imaging_claim_delivery',{'p_delivery':delivery})
            if not job:return self.reply(200,{'status':'not_claimed'})
            try:
                result=backend.process(job)
                return self.reply(200,{'status':result})
            except (InvalidStudy,zipfile.BadZipFile) as e:
                result=backend.rpc('imaging_complete',{'p_delivery':job['id'],'p_lease':job['lease_token'],
                    'p_validation':{'ok':False,'reason':str(e) if isinstance(e,InvalidStudy) else 'INVALID_ZIP'},'p_assets':[]})
                return self.reply(200,{'status':result})
        except Exception:
            # A timed-out/transient job remains leased, then becomes retryable.
            return self.reply(503,{'error':'PROCESSING_UNAVAILABLE'})
        finally:_lock.release()

def main():
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler).serve_forever()

if __name__=='__main__':main()
