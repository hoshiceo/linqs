# Preparing a public source release

## What the release contains

The source release includes application code, migrations, tests with fictional
examples, setup templates with empty credentials, and the Microsoft reference
snapshot with its separate licenses. Users provide their own service accounts,
keys and legally usable textbooks. Private classroom data, environment files,
password files, `node_modules`, build outputs, audit downloads and Git metadata
must not be included. See ../THIRD_PARTY_NOTICES.md for bundled-material details.

## Review the source candidate

- Confirm rights to publish the project's own code and assets under MIT.
- Retain the Microsoft dataset's attribution, modification information and licenses.
- Run type checks, relevant tests, `licenses:check`, `security:audit` and
  `security:secrets`. Scan the exact archive that will be published too.
- Review all examples, screenshots, destination emails and setup defaults. Secret
  scanning does not identify every kind of personal data or screenshot content.
- Keep email notifications disabled until the administrator configures their own
  verified sender and `INSTRUCTOR_NOTIFICATION_TO`. There is no fallback recipient.
- Review the distribution type: source-only exports exclude dependency binaries.
  Shipping a compiled bundle or container needs its own third-party notice/source
  review as described in THIRD_PARTY_NOTICES.md.

Setup and operational instructions are in [SETUP.md](SETUP.md).

## Existing deployments and migration 010

This preparation does not change production secrets, databases, recipients, or
Edge Functions. Before deploying the updated worker, configure the intended
recipient and apply `010_notification_recipients.sql` in the release process.
Migration 010 is additive and does not resend historical questions. New jobs pin
both sender and recipient; later environment changes apply to new notifications.

Attempted legacy jobs without a recipient snapshot are moved to `needs_review`
when the new worker claims jobs. Check provider receipts and the original
installation configuration manually; never infer a recipient from a public sample
or blindly resend a possibly delivered email. Do not remove the old claim RPC in
an independent step; the new recipient-aware RPC uses the existing lease logic.

## Git history and GitHub Actions

Editing the latest source does not erase earlier emails or personal examples from
Git history, workflow logs, traces or screenshots. Review all accessible retained
Actions logs and artifacts separately before changing repository visibility.
An inaccessible or expired log cannot be represented as reviewed.

The original private deployment repository can stay private while a **new public
repository is initialized from a reviewed source-only snapshot**. This avoids
publishing the original Git history and Actions records. Do not copy `.git`,
`.local`, the original credentials, private issues, logs, or artifacts into it.
A clean export does not sanitize the original repository.

If publishing the original repository instead, separately approve and plan any
history rewrite and Actions cleanup, preserve a private backup, and verify all
branches/tags after cleanup. Changing visibility, rewriting history and deleting
remote workflow records are explicit publication/cleanup decisions, not performed
by the local export command.

## Create the reviewed source archive

Commit the reviewed preparation changes first; this command exports **HEAD only**,
not uncommitted edits. It enumerates committed files, rejects private data paths,
uses Git's source archive format without `.git`, and scans the archive with Gitleaks.

```sh
GITLEAKS_BIN=/path/to/gitleaks npm run oss:export
```

The default destination is `.local/oss-release/linqs-source.zip`, excluded from
Git. Review its contents and record its SHA-256 before explicitly approving public
publication. A source export is not a history scrub or a compiled/binary license audit.

## At the publication step

Confirm the target repository name, license and source revision, then explicitly
approve public creation or visibility changes. Enable secret scanning, push
protection and private vulnerability reporting where available. Verify that no
private Actions history has been copied and that fork/clone setup uses the user's
own keys. A paid hosted API dependency does not mean model weights or a service
account are part of this source license.

References: [GitHub visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility),
[MIT](https://opensource.org/license/mit),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
