<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Linqs development and production releases

- Implement changes on `dev`, or on a feature branch based on `dev` that is merged into `dev` first.
- Keep `main` as the production branch. Do not push changes directly to `main` or bypass its branch protection.
- Use a `dev` → `main` pull request for production releases. Wait for `Quality checks` and the dev Netlify deployment to succeed, and verify the changed behavior in development before merging.
- For ordinary application changes, ask the user to confirm production promotion only after the dev result is concrete and reviewable, unless they already explicitly authorized that release. Do not enable automatic PR merging.
- Development and Deploy Previews require separate development credentials. Until those exist, keep login and AI access disabled. Browser tests may mock authentication and API responses only within the test suite. Never copy production credentials or write to production Supabase from development.
- Keep the persistent `dev` branch after merging a release. Merge `origin/main` back into `dev` so later release pull requests contain only new changes.
