# Microsoft VBA reference snapshot

This server-only search corpus is derived from the official [MicrosoftDocs/VBA-Docs](https://github.com/MicrosoftDocs/VBA-Docs) repository and ten Japanese Microsoft Learn pages downloaded on 2026-10-09. `manifest.json` records source revisions, checksums, and source URLs. Microsoft attribution and the original documentation and code licenses are retained in `LICENSE` (CC BY 4.0) and `LICENSE-CODE` (MIT).

`index.json.gz` contains article titles, official URLs, languages, and bounded Markdown excerpts. Front matter and publishing boilerplate are removed. Long tables are split between complete rows with their headers repeated. Code blocks, individual rows, or paragraphs longer than 1,400 characters are omitted, and their count is recorded. The corpus is a snapshot, not a live specification. Japanese and English articles can originate from different revisions. Image contents are not indexed.

The snapshot is committed and included in the `/api/chat` server bundle, outside `public/`. Deployment requires no access to `.local/`, no new credentials, and no database migration. It is searched locally without an embedding or URL-context API call. Japanese aliases and technical identifiers guide keyword ranking; this is not semantic search, and unfamiliar wording may find no match.

To rebuild from the verified downloads, run `npm run references:build`. Changes to the snapshot require rebuilding and redeploying the application. The original downloads remain under `.local/vba-reference/` and are not committed.
