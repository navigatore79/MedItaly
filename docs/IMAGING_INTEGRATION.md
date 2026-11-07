# MEDIapp central imaging intake v1

Implementation status: integration candidate, not commissioned for clinical delivery.
Existing patient archives and Firebase configuration are unchanged.

## One entry point

`POST https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/imaging-ingest`

Machine authentication: `x-medi-source-key`, a separate revocable 256-bit credential for each source. Only its SHA256 is stored. Never put the key or patient information in the URL. Create the key through the clinical manager's Prestazioni page. A patient enrollment code is never an integration credential.

The source first sends JSON `{"action":"create","manifest":{...}}`. It receives a receipt id and signed upload URLs. Upload the raw bytes with PUT, then send `{"action":"complete","id":"receipt-uuid"}`. Query progress with `{"action":"status","id":"receipt-uuid"}` using the same source key. Upload URLs expire after two hours and must be handled as secrets. No arbitrary remote download URLs are accepted. Files are immutable. Reuse a request_id only for the exact same manifest; changes require a new request_id. A corrected report is a new delivery; do not overwrite previously published documents.

Example manifest (synthetic identifiers):

```json
{
  "version": 1,
  "request_id": "local-report-123-revision-1",
  "issuer": "HOSPITAL-MRN",
  "patient_id": "local-patient-123",
  "title": "Controllo specialistico",
  "birth_date": "1950-01-01",
  "study_date": "2026-11-07",
  "final": true,
  "files": [{"kind":"archive","bytes":12345,"sha256":"64-lowercase-hex-characters"}]
}
```

Optional fiscal_code, accession_number, study_uid. Fiscal code is an assertion by the authenticated sender, not a substitute for identity verification. Name matching and PDF OCR are never automatic routing criteria. `final:true` is the source's publication instruction; it does not assert cryptographic verification of a PDF signature. Only call this API after the originating workflow has finalized/authorized the report.

Limits: 32 files and 1 GiB compressed per delivery, bucket plan limits may be lower; worker 2 GiB expanded, 10,000 archive entries, 512 MiB per archive member, ratio 200:1. Local phone ZIP import is separate: 64 MiB compressed, 128 MiB expanded, 1,000 entries. ZIP is a transport container, never the patient identity. No nested archives, executables, password-protected archives or mixed-patient/mixed-study archives. DICOMDIR indexes are ignored. PDF and standard Part 10 DICOM objects are accepted; ancillary CD launcher files must be removed by the source. All declared files must arrive before validation. SHA256, file size, antivirus, parser, patient/issuer/DOB, study/accession consistency and duplicate SOP checks precede publication. Each receipt represents one study; an archive containing another study must be split.

## Identity and publication

A clinical center manager verifies a mapping from `(center, issuer, external patient id)` to an active MEDIapp account already accepted by that center. A verified fiscal code is optional and unique within the center. Existing mappings cannot silently be reassigned. Unknown identity goes to review. Contradictions are blocked and require corrected data/new submission. Birth dates extracted from images are also checked against the app profile. The first rollout defaults to manual release; a manager can explicitly authorize automatic release for a source. Source revocation prevents new receipt creation and validation completion. Published documents are accessible only to their recipient and authorized clinical center managers. Nonmedical managers have no clinical-file access.

Published deliveries generate a generic in-app notification in the existing notifications table. This implementation does not yet dispatch a new FCM push for automated delivery; notification with the app closed remains a commissioning task. Access timestamps record an access request, not proof of clinical reading. Signed file links expire in 60 seconds; revoke/access changes cannot invalidate an already issued link before its expiry or a copy already downloaded. Access and publication events are audited.

## Validator deployment (required)

Build `services/imaging-worker/Dockerfile`. Supply SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY through a server-side secret store; do not put them in browser/Android assets or git. Mount a maintained ClamAV signature database read-only. Use a private EU-hosted worker, no inbound public port, an encrypted ephemeral volume, a non-root user, memory/CPU/disk quotas and monitored restarts. The service key is privileged: isolate the worker and restrict operator access. The receiver refuses new deliveries with PROCESSOR_OFFLINE until the worker has passed its antivirus check and sends a heartbeat. A failed scanner never becomes an approved study.

The worker downloads to temporary storage, validates, uploads validated files to the private imaging-clinical bucket, and completes an atomic leased job. A 30-minute lease is retried at most five times. Size infrastructure so a job finishes within its lease. Configure orphan-file cleanup and retention according to the center's agreed policy before real use; no automatic deletion policy is introduced by this change.

## App/viewer

The patient report archive gains Prestazioni del centro and a local-only ZIP opener. Cornerstone3D and codecs are bundled locally with locked dependency versions, not fetched from third-party CDNs during patient use. Build with `npm ci --prefix imaging-viewer && npm run build --prefix imaging-viewer`. Patient assets use the equivalent tools/imaging-viewer build in MEDi-X. Viewing is for personal consultation; support for real compressed/multiframe studies, Android WebView performance and clinical device requirements require commissioning. Online files are not automatically cached as plaintext for offline use. Local ZIP import never uploads content to a center.

## Commissioning still required

Deploy and monitor the validator with current antivirus signatures; configure the first source and verify actual patient mappings with the center; confirm PACS/RIS export/API adapter (this endpoint is a documented JSON intake API, not a drop-in STOW-RS or traditional DIMSE destination); test real anonymized PDF, angiography, ultrasound, CT and transfer syntaxes; validate original signed PDF behavior; connect FCM dispatch; validate Android APK and notifications on devices; agree retention, access logging, hosting responsibilities and operational procedures. Do not activate automatic clinical publication before these checks.
