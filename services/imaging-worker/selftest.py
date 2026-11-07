"""Synthetic-only deployment acceptance checks. No database or patient inputs."""
from pathlib import Path
import tempfile
import zipfile
import pydicom
from pydicom.dataset import FileDataset,FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian,SecondaryCaptureImageStorage,generate_uid
from pypdf import PdfWriter
from worker import unpack,validate,scan,InvalidStudy

def run_self_test():
    with tempfile.TemporaryDirectory(prefix='medi-synthetic-test-') as directory:
        root=Path(directory);image=root/'synthetic.dcm';report=root/'synthetic.pdf'
        meta=FileMetaDataset();meta.TransferSyntaxUID=ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID=SecondaryCaptureImageStorage;meta.MediaStorageSOPInstanceUID=generate_uid()
        ds=FileDataset(str(image),{},file_meta=meta,preamble=b'\0'*128)
        ds.SOPClassUID=meta.MediaStorageSOPClassUID;ds.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID=generate_uid();ds.SeriesInstanceUID=generate_uid()
        ds.PatientID='SYNTHETIC-NO-PATIENT';ds.IssuerOfPatientID='MEDI-QA';ds.PatientBirthDate='19500101'
        ds.Rows=2;ds.Columns=2;ds.SamplesPerPixel=1;ds.PhotometricInterpretation='MONOCHROME2'
        ds.BitsAllocated=16;ds.BitsStored=12;ds.HighBit=11;ds.PixelRepresentation=0
        ds.PixelData=b'\0\0\xff\x0f\0\0\xff\x0f';ds.save_as(image,enforce_file_format=True)
        writer=PdfWriter();writer.add_blank_page(width=300,height=300);writer.write(report)
        archive=root/'synthetic.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            z.write(image,'images/one.dcm');z.write(report,'report.pdf')
        dest=root/'expanded';dest.mkdir();paths=unpack(archive,dest)
        scan(root)
        manifest={'issuer':'MEDI-QA','patient_id':'SYNTHETIC-NO-PATIENT','birth_date':'1950-01-01','files':[{'kind':'archive'}]}
        assets,result=validate(paths,manifest,scanner=lambda _:None)
        checks={'pdf_dicom_zip':result['ok'] and sorted(x['kind'] for x in assets)==['dicom','report']}
        try:validate(paths,{**manifest,'patient_id':'DIFFERENT-SYNTHETIC-ID'},scanner=lambda _:None)
        except InvalidStudy as e:checks['cross_patient_blocked']=str(e)=='DICOM_PATIENT_MISMATCH'
        bad=root/'traversal.zip'
        with zipfile.ZipFile(bad,'w') as z:z.writestr('../outside',b'synthetic')
        try:unpack(bad,dest)
        except InvalidStudy as e:checks['traversal_blocked']=str(e)=='ARCHIVE_PATH'
        # Harmless standard EICAR antivirus test string, not executable malware.
        eicar=root/'antivirus-check'
        eicar.write_bytes(b'X5O!P%@AP[4'+bytes([92])+b'PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
        try:scan(eicar)
        except InvalidStudy as e:checks['antivirus_eicar_detected']=str(e)=='MALWARE_DETECTED'
        if len(checks)!=4 or not all(checks.values()):raise RuntimeError('SELF_TEST_FAILED')
        return {'ok':True,'checks':checks,'scope':'synthetic_only_no_database'}
