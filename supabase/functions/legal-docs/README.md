# Public legal documents

Source matching deployed Meditaly legal-docs version 14 (2026-10-23). Adds account deletion request instructions to the retention document and an Elimina account navigation link. Other document bodies are preserved. The function serves static content and does not delete records or receive deletion requests itself.

Public browser links:
- https://med-italy.vercel.app/?legal=retention
- https://med-italy.vercel.app/?legal=privacy

Use these rendered website links for Google Play. Direct Edge Function HTML responses may be displayed as plain text by the gateway. The website currently requires the explicit legal query parameter for document rendering.

Deploy legal-docs with its existing public (verify_jwt=false) configuration. Verify the center, privacy, retention, deletion route and unknown-document 404. Requests are handled manually at the published support address; operational retention periods still require an owner-approved schedule.
