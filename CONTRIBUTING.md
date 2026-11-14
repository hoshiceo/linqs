# Contributing to Linqs

Thank you for helping improve the learning assistant. Contributions should contain
only material you have the right to submit under this project's MIT license.
Preserve third-party licenses and attribution for material you add.

## Propose and develop a change

1. Describe the problem in an issue using synthetic data. For vulnerabilities,
   follow [SECURITY.md](SECURITY.md) instead of opening a public disclosure.
2. Start a branch from `dev` and submit the pull request to `dev`. Production
   releases use a reviewed `dev` → `main` PR after required checks succeed.
3. Keep changes focused. Explain the resulting behavior, validation, and any
   migration or configuration changes in the PR.

Use Node.js 22+ and `npm ci`. Follow the README to configure a separate development
Supabase/Gemini project. Never use a live classroom account or production history
for tests. Browser tests mock authentication, model calls, and email delivery;
database tests run the SQL in PGlite. Use fictitious names and reserved
`example.com` addresses in examples, screenshots and fixtures.

```sh
npm run typecheck
npm test
npm run licenses:check
npm run security:audit
# Install Gitleaks 8.30.1, then:
npm run security:secrets
```

Run meaningful browser tests for changed interactions, using the isolated build
and dummy public settings documented in README.md. Minor cosmetic changes follow
AGENTS.md. Test notification delivery only with a mocked provider; never send a
test message to an actual instructor. `tests/edge-runtime-smoke.mjs` can run under
Deno with `--allow-net=127.0.0.1`, using an automatically selected local port.

After changing `package-lock.json`, run `npm run licenses:update`, review the
license declarations and commit the inventory with the dependency change.

## Do not submit

- API keys, account passwords, tokens, `.env` values, `.local` files or DB exports.
- Student questions, private textbook text or screenshots of a real class.
- A real installation's email address as a default notification recipient.
- Third-party code or assets without their license and attribution information.

If sensitive information was committed, contact the maintainer privately and
rotate affected credentials. Deleting the latest file does not remove Git history.
