import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid
from pypdf import PdfWriter

spec=importlib.util.spec_from_file_location('worker',Path(__file__).parents[2]/'services/imaging-worker/worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

def dicom(path, pid='MRN-1', dob='19500101', study=None):
    meta=FileMetaDataset();meta.TransferSyntaxUID=ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID=SecondaryCaptureImageStorage;meta.MediaStorageSOPInstanceUID=generate_uid()
    ds=FileDataset(str(path),{},file_meta=meta,preamble=b'\0'*128)
    ds.SOPClassUID=meta.MediaStorageSOPClassUID;ds.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID=study or generate_uid();ds.SeriesInstanceUID=generate_uid()
    ds.PatientID=pid;ds.PatientBirthDate=dob;ds.IssuerOfPatientID='HOSPITAL'
    ds.Rows=2;ds.Columns=2;ds.SamplesPerPixel=1;ds.PhotometricInterpretation='MONOCHROME2'
    ds.BitsAllocated=16;ds.BitsStored=12;ds.HighBit=11;ds.PixelRepresentation=0
    ds.PixelData=b'\0\0\xff\x0f\0\0\xff\x0f'
    ds.save_as(path,enforce_file_format=True)
    return ds

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.manifest={'patient_id':'MRN-1','issuer':'HOSPITAL','birth_date':'1950-01-01','files':[{'kind':'archive'}]}
    def tearDown(self):self.temp.cleanup()
    def test_dicom_identity(self):
        p=self.root/'a';dicom(p)
        a,v=w.validate([p],self.manifest,lambda _:None)
        self.assertTrue(v['ok']);self.assertEqual(a[0]['kind'],'dicom');self.assertEqual(v['birth_date'],'1950-01-01')
    def test_cross_patient_rejected(self):
        p=self.root/'a';dicom(p,pid='OTHER')
        with self.assertRaisesRegex(w.InvalidStudy,'PATIENT_MISMATCH'):w.validate([p],self.manifest,lambda _:None)
    def test_birth_date_conflict(self):
        p=self.root/'a';dicom(p,dob='19700101')
        with self.assertRaisesRegex(w.InvalidStudy,'BIRTH_DATE'):w.validate([p],self.manifest,lambda _:None)
    def test_mixed_studies(self):
        a,b=self.root/'a',self.root/'b';dicom(a);dicom(b)
        with self.assertRaisesRegex(w.InvalidStudy,'MIXED_STUDY'):w.validate([a,b],self.manifest,lambda _:None)
    def test_duplicate_sop(self):
        a,b=self.root/'a',self.root/'b';dicom(a);b.write_bytes(a.read_bytes())
        with self.assertRaisesRegex(w.InvalidStudy,'DUPLICATE'):w.validate([a,b],self.manifest,lambda _:None)
    def test_zip_traversal(self):
        p=self.root/'zip'
        with zipfile.ZipFile(p,'w') as z:z.writestr('../bad',b'data')
        with self.assertRaisesRegex(w.InvalidStudy,'ARCHIVE_PATH'):w.unpack(p,self.root)
    def test_zip_bomb_ratio(self):
        p=self.root/'zip'
        with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('bad',b'0'*1000000)
        with self.assertRaisesRegex(w.InvalidStudy,'ARCHIVE_RATIO'):w.unpack(p,self.root)
    def test_zip_valid_opaque_names(self):
        p=self.root/'zip'
        with zipfile.ZipFile(p,'w') as z:z.writestr('folder/a',b'data')
        dest=self.root/'out';dest.mkdir();r=w.unpack(p,dest)
        self.assertEqual(r[0].name,'0');self.assertEqual(r[0].read_bytes(),b'data')
    def test_pdf_passive(self):
        p=self.root/'a';writer=PdfWriter();writer.add_blank_page(width=100,height=100);writer.write(p)
        self.assertEqual(w.inspect_file(p,self.manifest)[0],'report')
    def test_pdf_javascript_rejected(self):
        p=self.root/'a';writer=PdfWriter();writer.add_blank_page(width=100,height=100);writer.add_js('app.alert(1)');writer.write(p)
        with self.assertRaisesRegex(w.InvalidStudy,'PDF_ACTIVE'):w.inspect_file(p,self.manifest)
    def test_executable_rejected(self):
        p=self.root/'a';p.write_bytes(b'MZ'+b'\0'*200)
        with self.assertRaisesRegex(w.InvalidStudy,'UNSUPPORTED'):w.inspect_file(p,self.manifest)
    def test_scanner_failure_closed(self):
        import unittest.mock
        with unittest.mock.patch('subprocess.run',side_effect=FileNotFoundError()):
            with self.assertRaisesRegex(RuntimeError,'SCANNER_UNAVAILABLE'):w.scan(self.root/'a')

if __name__=='__main__':unittest.main()
