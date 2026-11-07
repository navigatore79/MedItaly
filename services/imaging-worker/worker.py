"""Private, disk-backed validator. Never run in the browser or expose its service key.
No patient metadata is written to stdout. Incoming objects remain quarantined.
"""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pydicom
from pypdf import PdfReader
import requests

pydicom.config.settings.reading_validation_mode = pydicom.config.RAISE

MAX_EXPANDED = int(os.environ.get('MEDI_MAX_EXPANDED_BYTES', 192 * 1024**2))
MAX_FILES = 1000
MAX_FILE = 64 * 1024**2

class InvalidStudy(ValueError):
    pass

def checksum(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024**2), b''):
            h.update(chunk)
    return h.hexdigest()

def unpack(path, target):
    """Extract bounded content to opaque names, reject symlinks/traversal/encryption."""
    with zipfile.ZipFile(path) as z:
        entries = z.infolist()
        if len(entries) > MAX_FILES or sum(x.file_size for x in entries) > MAX_EXPANDED:
            raise InvalidStudy('ARCHIVE_LIMIT')
        total, result = 0, []
        for i, info in enumerate(entries):
            name = info.filename.replace('\\', '/')
            if name.startswith('/') or ':' in name or '..' in PurePosixPath(name).parts or '\x00' in name:
                raise InvalidStudy('ARCHIVE_PATH')
            mode = info.external_attr >> 16
            if mode & 0o170000 == 0o120000 or info.flag_bits & 1:
                raise InvalidStudy('ARCHIVE_UNSUPPORTED')
            if info.is_dir():
                continue
            if info.file_size > MAX_FILE or info.file_size > max(info.compress_size, 1)*200:
                raise InvalidStudy('ARCHIVE_RATIO')
            output, count = target / str(i), 0
            with z.open(info) as src, output.open('wb') as dst:
                for chunk in iter(lambda: src.read(1024**2), b''):
                    count += len(chunk)
                    total += len(chunk)
                    if count > MAX_FILE or total > MAX_EXPANDED:
                        raise InvalidStudy('ARCHIVE_LIMIT')
                    dst.write(chunk)
            result.append(output)
        return result

def scan(path):
    # The fixed executable receives no sender-controlled arguments. Fail closed.
    try:
        database=os.environ.get('MEDI_CLAMAV_DATABASE','/var/lib/clamav')
        result = subprocess.run(['clamscan', '--no-summary', '--recursive',
                                '--alert-exceeds-max=yes', '--max-filesize=64M',
                                '--max-scansize=256M', '--max-files=2000',
                                '--database='+database, '--', str(path)],
                                capture_output=True, timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise RuntimeError('SCANNER_UNAVAILABLE') from e
    if result.returncode == 1:
        raise InvalidStudy('MALWARE_DETECTED')
    if result.returncode != 0:
        raise RuntimeError('SCANNER_UNAVAILABLE')

def inspect_file(path, manifest):
    with path.open('rb') as f:
        header = f.read(132)
    if header.startswith(b'%PDF-'):
        reader = PdfReader(str(path), strict=True)
        if reader.is_encrypted or not len(reader.pages):
            raise InvalidStudy('PDF_UNSUPPORTED')
        # Reject active/embedded content anywhere in the object graph, not only the root.
        forbidden = {'/JavaScript', '/JS', '/Launch', '/EmbeddedFiles', '/EF', '/RichMedia', '/XFA', '/OpenAction', '/AA', '/URI'}
        visited, budget = set(), [0]
        def walk(obj, depth=0):
            from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject
            if depth>128 or budget[0]>100000:
                raise InvalidStudy('PDF_COMPLEXITY_LIMIT')
            budget[0]+=1
            if isinstance(obj,IndirectObject):
                key=(obj.idnum,obj.generation)
                if key in visited:return
                visited.add(key);walk(obj.get_object(),depth+1)
            elif isinstance(obj,DictionaryObject):
                if forbidden.intersection(obj.keys()):
                    raise InvalidStudy('PDF_ACTIVE_CONTENT')
                for value in obj.values():walk(value,depth+1)
            elif isinstance(obj,ArrayObject):
                for value in obj:walk(value,depth+1)
        for generation, offsets in reader.xref.items():
            if generation == 65535:
                continue
            for object_id in offsets:
                from pypdf.generic import IndirectObject
                obj = reader.get_object(IndirectObject(object_id, generation, reader))
                walk(obj)
        return 'report', {'pages': len(reader.pages)}
    if len(header) < 132 or header[128:132] != b'DICM':
        raise InvalidStudy('UNSUPPORTED_CONTENT')
    try:
        ds = pydicom.dcmread(str(path), defer_size=1024, force=False)
        if str(ds.get('SOPClassUID', '')) == '1.2.840.10008.1.3.10':
            return None, {}  # DICOMDIR is an index, never executable or patient-visible.
        if not any(tag in ds for tag in ('PixelData','FloatPixelData','DoubleFloatPixelData')):
            raise InvalidStudy('DICOM_IMAGE_DATA_MISSING')
        if not 1<=int(ds.get('NumberOfFrames',1))<=10000 or not 1<=int(ds.get('Rows',0))<=8192 or not 1<=int(ds.get('Columns',0))<=8192:
            raise InvalidStudy('DICOM_IMAGE_LIMIT')
        pid = str(ds.get('PatientID', '')).strip()
        issuer = str(ds.get('IssuerOfPatientID', '')).strip()
        if not pid or pid != manifest['patient_id'] or (issuer and issuer != manifest['issuer']):
            raise InvalidStudy('DICOM_PATIENT_MISMATCH')
        study = str(ds.get('StudyInstanceUID', ''))
        series = str(ds.get('SeriesInstanceUID', ''))
        sop = str(ds.get('SOPInstanceUID', ''))
        if not all((study, series, sop)):
            raise InvalidStudy('DICOM_UID_MISSING')
        if manifest.get('study_uid') and study != manifest['study_uid']:
            raise InvalidStudy('DICOM_STUDY_MISMATCH')
        accession = str(ds.get('AccessionNumber', '')).strip()
        if manifest.get('accession_number') and accession != manifest['accession_number']:
            raise InvalidStudy('DICOM_ACCESSION_MISMATCH')
        dob = str(ds.get('PatientBirthDate', ''))
        dob = f'{dob[:4]}-{dob[4:6]}-{dob[6:]}' if len(dob) == 8 else None
        if manifest.get('birth_date') and dob != manifest['birth_date']:
            raise InvalidStudy('DICOM_BIRTH_DATE_MISMATCH')
        return 'dicom', {'study_uid': study, 'series_uid': series, 'sop_uid': sop,
                         'instance': int(ds.get('InstanceNumber', 0)), 'birth_date': dob,
                         'transfer_syntax': str(ds.file_meta.TransferSyntaxUID),
                         'frames': int(ds.get('NumberOfFrames', 1))}
    except InvalidStudy:
        raise
    except Exception as e:
        raise InvalidStudy('INVALID_DICOM') from e

def validate(paths, manifest, scanner=scan):
    assets, studies, dates, sops = [], set(), set(), set()
    for path in paths:
        scanner(path)
        kind, metadata = inspect_file(path, manifest)
        if not kind:
            continue
        if kind == 'dicom':
            studies.add(metadata['study_uid'])
            if metadata['birth_date']:
                dates.add(metadata['birth_date'])
            if metadata['sop_uid'] in sops:
                raise InvalidStudy('DUPLICATE_DICOM_INSTANCE')
            sops.add(metadata['sop_uid'])
        assets.append({'local': path, 'kind': kind, 'metadata': metadata,
                       'bytes': path.stat().st_size, 'sha256': checksum(path)})
    if len(studies) > 1 or len(dates) > 1:
        raise InvalidStudy('MIXED_STUDY_OR_IDENTITY')
    if not assets:
        raise InvalidStudy('EMPTY_DELIVERY')
    declared = {f['kind'] for f in manifest['files']}
    actual = {f['kind'] for f in assets}
    if ('report' in declared and 'report' not in actual) or ('dicom' in declared and 'dicom' not in actual):
        raise InvalidStudy('MISSING_DECLARED_CONTENT')
    return assets, {'ok': True, 'birth_date': next(iter(dates), None),
                    'study_uid': next(iter(studies), None), 'files': len(assets)}

class Backend:
    def __init__(self):
        self.url = os.environ['SUPABASE_URL'].rstrip('/')
        self.session = requests.Session()
        key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
        self.session.headers.update({'apikey': key, 'Authorization': 'Bearer '+key})

    def rpc(self, name, body):
        r = self.session.post(self.url+'/rest/v1/rpc/'+name, json=body, timeout=60)
        r.raise_for_status()
        return r.json() if r.content else None

    def input_response(self, job, index):
        return self.session.get(self.url+'/storage/v1/object/imaging-incoming/'+job['id']+'/'+str(index),stream=True,timeout=(15,180))

    def upload(self, job, asset, local):
        path=job['id']+'/'+asset['sha256']
        with local.open('rb') as f:
            r=self.session.post(self.url+'/storage/v1/object/imaging-clinical/'+path,data=f,
                headers={'Content-Type':'application/pdf' if asset['kind']=='report' else 'application/dicom','x-upsert':'true'},timeout=(15,180))
            r.raise_for_status()
        return path

    def process(self, job):
        with tempfile.TemporaryDirectory(prefix='medi-imaging-') as work:
            root, paths = Path(work), []
            for i, spec in enumerate(job['manifest']['files']):
                path = root / ('incoming-'+str(i))
                with self.input_response(job,i) as r:
                    r.raise_for_status()
                    size = 0
                    with path.open('wb') as f:
                        for chunk in r.iter_content(1024**2):
                            size += len(chunk)
                            if size > spec['bytes']:
                                raise InvalidStudy('FILE_SIZE_MISMATCH')
                            f.write(chunk)
                if size != spec['bytes'] or checksum(path) != spec['sha256']:
                    raise InvalidStudy('FILE_HASH_MISMATCH')
                if spec['kind'] == 'archive':
                    dest = root / ('expanded-'+str(i));dest.mkdir()
                    paths.extend(unpack(path, dest))
                else:
                    paths.append(path)
            if sum(p.stat().st_size for p in paths) > MAX_EXPANDED or len(paths)>MAX_FILES:
                raise InvalidStudy('DELIVERY_LIMIT')
            # One antivirus engine invocation for the whole quarantined delivery.
            scan(root)
            assets, validation = validate(paths, job['manifest'], scanner=lambda _:None)
            def upload_one(asset):
                # Content-addressed paths; retry may reuse only the exact same bytes.
                path=self.upload(job,asset,asset.pop('local'))
                return {**asset, 'path': path}
            with ThreadPoolExecutor(max_workers=getattr(self,'upload_concurrency',1)) as pool:
                uploaded=list(pool.map(upload_one,assets))
            return self.rpc('imaging_complete',{'p_delivery':job['id'],'p_lease':job['lease_token'],'p_validation':validation,'p_assets':uploaded})

class HostedBackend(Backend):
    """Vercel uses a scoped imaging gateway. No database/service-role credential."""
    def __init__(self):
        self.upload_concurrency=4
        self.gateway=os.environ['MEDI_IMAGING_GATEWAY_URL']
        if self.gateway!='https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/imaging-worker':
            raise RuntimeError('INVALID_GATEWAY')
        self.secret=os.environ['MEDI_IMAGING_WORKER_SECRET']

    def call(self, body):
        r=requests.post(self.gateway,json=body,headers={'Authorization':'Bearer '+self.secret},timeout=(15,120))
        r.raise_for_status();return r.json()

    def rpc(self, name, body):
        if name=='imaging_claim_delivery':return self.call({'action':'claim','id':body['p_delivery']})['job']
        if name=='imaging_complete':return self.call({'action':'complete','id':body['p_delivery'],'lease':body['p_lease'],'validation':body['p_validation'],'assets':body['p_assets']})['status']
        raise RuntimeError('UNSUPPORTED_OPERATION')

    def input_response(self,job,index):
        return requests.get(job['input_urls'][index],stream=True,timeout=(15,180))

    def upload(self,job,asset,local):
        ticket=self.call({'action':'prepare_asset','id':job['id'],'lease':job['lease_token'],
            'sha256':asset['sha256'],'kind':asset['kind'],'bytes':asset['bytes']})
        with local.open('rb') as f:
            r=requests.put(ticket['url'],data=f,headers={'Content-Type':'application/octet-stream'},timeout=(15,180))
            if r.status_code not in (200,201,409):r.raise_for_status()
        return ticket['path']

def run():
    # Verify antivirus availability before advertising worker readiness.
    with tempfile.NamedTemporaryFile() as probe:
        scan(Path(probe.name))
    backend = Backend()
    while True:
        try:
            job = backend.rpc('imaging_claim', {})
            if not job:
                time.sleep(10);continue
            try:
                backend.process(job)
            except (InvalidStudy, zipfile.BadZipFile) as e:
                backend.rpc('imaging_complete',{'p_delivery':job['id'],'p_lease':job['lease_token'],
                    'p_validation':{'ok':False,'reason':str(e) if isinstance(e,InvalidStudy) else 'INVALID_ZIP'},'p_assets':[]})
        except Exception:
            # No raw exception messages (could contain identifiers, keys or signed URLs).
            print('Imaging worker: processing unavailable; retry scheduled.', flush=True)
            time.sleep(30)

if __name__ == '__main__':
    run()
