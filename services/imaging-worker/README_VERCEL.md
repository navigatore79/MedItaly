# Existing Vercel project: imaging service

This replaces the separate always-running validator with an authenticated, on-demand container function in **the existing med-italy project**. Vercel Container Runtime and Services are currently Beta on all plans. No new project, VM or hosting subscription is created. Normal Vercel compute, transfer and Supabase storage usage still apply; this is not a promise of zero usage cost.

Configuration keeps static dashboard files on the CDN and routes only `/api/imaging-process` and `/api/imaging-process/health` to this service. Each authorized invocation validates at most one receipt, with a database lease preventing concurrent publication. Temporary files are deleted when processing exits. Unknown identities, malformed files, malware or an unavailable/stale antivirus database never publish to the patient.

Required **production-only** Vercel environment variables:

- `MEDI_IMAGING_WORKER_SECRET`: generated random credential (at least 64 characters), same value as the private Supabase processor configuration. Never print it, commit it, expose it to the frontend or use it in a URL.
- `MEDI_IMAGING_GATEWAY_URL`: `https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/imaging-worker`.
- `PORT`: `8080` (the container also sets this default).

No Supabase service-role key is needed in Vercel. The gateway authorizes only imaging queue claims, receipt-scoped signed file transfers and validation completion. It cannot access unrelated application tables. Do not inject production secrets into PR preview builds.

Supabase settings are kept in `private.imaging_processor_settings`. Configure the exact production URL `https://med-italy.vercel.app/api/imaging-process`, the same secret, and leave `enabled=false` until the protected Vercel health check succeeds and all production smoke tests pass. Only service-role code reads this table. Then enable it, deploy the updated ingest/gateway functions, and commission a source. The ingest checks readiness before giving out upload tickets and triggers processing only after all declared files have arrived. Polling a pending receipt also retries a queued/expired job without creating another receipt.

This first deployment accepts at most **64 MiB total input**, with bounded archive expansion (192 MiB), 1,000 archive entries and 64 MiB per member. The receiver rejects larger deliveries before upload. Large studies require a later incremental/chunked import extension; never silently truncate or recompress clinical originals.

Before use: verify the image builds in the account's Container Runtime; test antivirus with a harmless EICAR fixture, fresh definition updates and outages; measure memory, cold-start/duration and temporary-disk usage. `freshclam` contacts official signature distribution endpoints only; it never receives patient documents. The service downloads definitions at cold start if its ephemeral copy is absent or older than 24 hours; a failed update closes readiness. No file is sent to a third-party antivirus scanning API.

Pending: deploy preview with synthetic data and separate test credentials, then production; add a durable periodic retry trigger if the source cannot poll receipts; connect automated FCM dispatch and test closed-app notification; real anonymized DICOM/ZIP and Android acceptance. Neither source integrations nor auto-publication are enabled merely by this configuration change.
