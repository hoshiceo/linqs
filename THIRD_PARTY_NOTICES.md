# Third-party materials and dependencies

The Linqs application code is provided under the [MIT license](LICENSE). This does
not relicense third-party documentation, library code, fonts, or hosted services.

## Bundled Microsoft documentation

`data/vba-reference/index.json.gz` is a transformed search snapshot of documentation
by Microsoft and contributors to [MicrosoftDocs/VBA-Docs](https://github.com/MicrosoftDocs/VBA-Docs)
and the Microsoft Learn pages listed in `data/vba-reference/manifest.json`.
Documentation is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
code samples are covered by the upstream MIT code license, Copyright (c) Microsoft Corporation.

Retain `data/vba-reference/LICENSE`, `LICENSE-CODE`, `README.md` and `manifest.json`
when redistributing this dataset. The manifest records source links, revisions,
retrieval date, and checksums. The dataset is modified: publishing metadata is
removed, text is split into excerpts, long blocks are omitted, and the index is
compressed. Details are in the dataset README. Microsoft does not endorse Linqs.
Private classroom textbooks and their embeddings are not part of this distribution.

## npm packages

[docs/dependency-licenses.json](docs/dependency-licenses.json) inventories the exact
versions and declared licenses in `package-lock.json`, including optional platform
packages and development tools. Regenerate it with `npm run licenses:update` after
changing dependencies; CI checks that it matches the lockfile. Declarations are
inventory data, not an assertion that every release format has been legally reviewed.

Source-only Git exports do not include `node_modules`, compiled application bundles,
containers, or downloaded package binaries. If you distribute any of those, include
their applicable original license texts, copyright and NOTICE files, and fulfill
any corresponding source/relinking obligations. Linqs' MIT file is not a replacement.

Pay particular attention to these package families:

- Sharp: Apache-2.0; optional libvips binaries and their bundled dependencies also
  carry LGPL-3.0-or-later and other notices. Consult the original package contents,
  [Sharp's licensing guidance](https://sharp.pixelplumbing.com/install/#licensing),
  and the matching release sources in [sharp-libvips](https://github.com/lovell/sharp-libvips).
  Preserve matching source and build information when required for the binary
  release you distribute; a link to a moving default branch alone is insufficient.
- Lightning CSS: MPL-2.0, currently a development dependency. Keep its original
  license and comply with file-level source requirements if distributing covered
  files or modified covered files. See [Mozilla's MPL guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
- MIT/BSD/ISC/Apache dependencies: retain the required original copyright,
  license and NOTICE texts for the files included in your release.

## Fonts and services

The stylesheet requests DM Sans and Noto Sans JP from Google Fonts at runtime;
font binaries are not bundled in this source export. If hosting or redistributing
font files yourself, retain the licenses and notices from those font distributions.

Gemini, Supabase, Netlify, and optional Resend delivery are external services, not
MIT-licensed components of this repository. Users supply their own accounts,
credentials, recipient address, and usage payments under the respective terms.
