# Security policy

Security fixes target the current `dev` branch and are released through a reviewed
`dev` → `main` pull request. Run the latest release with all database migrations.

## Reporting a vulnerability

For a public repository, enable GitHub **Private vulnerability reporting** before
accepting reports, then use the Security tab's **Report a vulnerability** button.
If private reporting is unavailable, ask the maintainer for a private contact
method without disclosing the vulnerability in a public issue.

Never attach API keys, passwords, tokens, student conversations or private
textbooks. Include the affected commit, prerequisites and reproduction steps using
synthetic data. Do not test against the live classroom service or other users'
accounts without explicit authorization.

## Maintainer checks

- Run `npm run security:audit` and `npm run security:secrets` before publication.
  The latter requires the official Gitleaks binary (version 8.30.1 in CI).
- Keep GitHub secret scanning, push protection and private vulnerability reporting
  enabled where available. Local/CI scanning also checks publication candidates
  and Git history without displaying secret values.
- Apply migration `004_server_exchange_writer.sql` and configure a separate
  `SUPABASE_EXCHANGE_WRITE_KEY` per environment. The app uses a class JWT plus
  this narrowly scoped server key; administrator credentials stay local.
- Keep development and production credentials separate. Never commit `.env*`,
  `.local/`, classroom login details or private textbooks.
- The shared class account intentionally shares history, bookmarks and deletion
  permissions. It does not provide privacy between class members.

If a secret is exposed, revoke or rotate it first, then investigate its usage and
remove it from publication candidates and Git history. Removing a file alone does
not invalidate a leaked credential.
