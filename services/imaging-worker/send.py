"""Reference client for vendors. The key stays in the environment, never in a URL.
The manifest must declare each file's kind, size and SHA256. Retries reuse request_id.
"""
import json
import os
from pathlib import Path
import sys
import requests
from worker import checksum

def send(manifest_file, paths):
    manifest=json.loads(Path(manifest_file).read_text())
    if len(manifest['files'])!=len(paths):
        raise ValueError('File count differs from manifest')
    for spec,path in zip(manifest['files'],paths):
        spec['bytes']=Path(path).stat().st_size;spec['sha256']=checksum(path)
    endpoint=os.environ['MEDI_INGEST_URL']
    if not endpoint.startswith('https://'):
        raise ValueError('HTTPS required')
    headers={'x-medi-source-key':os.environ['MEDI_SOURCE_KEY']}
    def call(body):
        r=requests.post(endpoint,json=body,headers=headers,timeout=60)
        if not r.ok:
            raise RuntimeError('MEDIapp: '+r.json().get('error','REQUEST_FAILED'))
        return r.json()
    receipt=call({'action':'create','manifest':manifest})
    for upload in receipt.get('uploads',[]):
        with open(paths[upload['index']],'rb') as f:
            r=requests.put(upload['url'],data=f,headers={'Content-Type':upload['content_type']},timeout=(15,600))
            # A previously completed immutable upload may already exist.
            if r.status_code not in (200,201,409):
                raise RuntimeError('Upload failed; retry with same request_id')
    return call({'action':'complete','id':receipt['id']})

if __name__=='__main__':
    print(json.dumps(send(sys.argv[1],sys.argv[2:])))
