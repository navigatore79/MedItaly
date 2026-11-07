import importlib.util
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error

directory=Path(__file__).parents[2]/'services/imaging-worker'
sys.path.insert(0,str(directory))
spec=importlib.util.spec_from_file_location('imaging_server',directory/'server.py')
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'MEDI_IMAGING_WORKER_SECRET':'x'*64});self.env.start()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.http.server_port)
    def tearDown(self):self.http.shutdown();self.http.server_close();self.env.stop()
    def request(self,path,body=None,key=True):
        headers={'Authorization':'Bearer '+'x'*64} if key else {}
        data=json.dumps(body).encode() if body is not None else None
        req=urllib.request.Request(self.url+path,data=data,headers=headers)
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def test_health_requires_secret(self):self.assertEqual(self.request('/api/imaging-process/health',key=False)[0],401)
    def test_query_does_not_change_health_route(self):
        with patch.object(server,'scanner_ready'):
            self.assertEqual(self.request('/api/imaging-process/health?test=1')[0],200)
    def test_post_requires_secret_before_claim(self):self.assertEqual(self.request('/api/imaging-process',{'id':'bad'},key=False)[0],401)
    def test_scanner_failure_blocks_readiness(self):
        with patch.object(server,'scanner_ready',side_effect=RuntimeError()):self.assertEqual(self.request('/api/imaging-process/health')[0],503)
    def test_health_has_no_patient_payload(self):
        with patch.object(server,'scanner_ready'):
            code,body=self.request('/api/imaging-process/health');self.assertEqual(code,200);self.assertTrue(body['ready']);self.assertNotIn('secret',body)
    def test_bad_receipt_rejected_before_backend(self):self.assertEqual(self.request('/api/imaging-process',{'id':'bad'})[0],400)
    def test_self_test_disabled_by_default(self):self.assertEqual(self.request('/api/imaging-process/self-test',{'run':'synthetic'})[0],404)
    def test_self_test_requires_auth(self):self.assertEqual(self.request('/api/imaging-process/self-test',{'run':'synthetic'},key=False)[0],401)
    def test_one_receipt_processed(self):
        with patch.object(server,'scanner_ready'),patch.object(server,'HostedBackend') as backend:
            backend.return_value.rpc.return_value={'id':'test'};backend.return_value.process.return_value='review'
            code,body=self.request('/api/imaging-process',{'id':'00000000-0000-0000-0000-000000000001'})
            self.assertEqual(code,200);self.assertEqual(body['status'],'review');backend.return_value.process.assert_called_once()
    def test_transient_error_not_published(self):
        with patch.object(server,'scanner_ready'),patch.object(server,'HostedBackend') as backend:
            backend.return_value.rpc.side_effect=RuntimeError()
            self.assertEqual(self.request('/api/imaging-process',{'id':'00000000-0000-0000-0000-000000000001'})[0],503)
    def test_busy_worker_does_not_claim_another_job(self):
        server._lock.acquire()
        try:self.assertEqual(self.request('/api/imaging-process',{'id':'00000000-0000-0000-0000-000000000001'})[0],429)
        finally:server._lock.release()

if __name__=='__main__':unittest.main()
