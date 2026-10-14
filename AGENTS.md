<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Linqs development and production releases

- Implement changes on `dev`, or on a feature branch based on `dev` that is merged into `dev` first.
- Keep `main` as the production branch. Do not push changes directly to `main` or bypass its branch protection.
- Use a `dev` → `main` pull request for production releases. Wait for `Quality checks` to succeed. For changes beyond the minor changes described below, verify the changed behavior locally at `http://localhost:3000` before merging. Do not wait for or create a Netlify development deployment.
- For minor, reversible changes such as wording, styling, or removing an unused UI control, skip manual local verification, additional test runs, and post-deployment browser checks unless the change affects authentication, permissions, data handling, AI behavior, or deployment configuration. Keep required CI and a basic deployment-status check; do not bypass branch protection. This reflects the user's explicit preference to skip verification work for minor changes.
- For ordinary application changes, ask the user to confirm production promotion only after the local development result is concrete and reviewable, unless they already explicitly authorized that release. Do not enable automatic PR merging.
- Netlify publishes only `main`. Keep branch deploys disabled and Deploy Previews disabled. Use local development for `dev`.
- Local development requires separate development credentials in `.env.development.local`. Until those exist, keep login and AI access disabled. Browser tests may mock authentication and API responses only within the test suite. Never copy production credentials or write to production Supabase from development.
- Keep the persistent `dev` branch after merging a release. Merge `origin/main` back into `dev` so later release pull requests contain only new changes.
