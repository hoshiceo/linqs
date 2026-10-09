import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { referenceChunks, MAX_EXCERPT_CHARACTERS } from './vba-reference-index.mjs';

const source = resolve(process.argv[2] || '.local/vba-reference');
const destination = resolve('data/vba-reference');
const catalog = JSON.parse(await readFile(join(source, 'catalog.json'), 'utf8'));
const documents = [];
let omittedBlocks = 0;
for (const article of catalog.articles) {
  const path = resolve(source, article.path);
  if (!path.startsWith(source + sep)) throw new Error('Invalid reference path.');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== article.sha256) throw new Error('Reference checksum mismatch: ' + article.path);
  const url = new URL(article.learn_url);
  if (url.protocol !== 'https:' || url.hostname !== 'learn.microsoft.com' || !/^\/(en-us|ja-jp)\/office\/vba\//.test(url.pathname)) throw new Error('Invalid official source URL.');
  const prepared = referenceChunks(bytes.toString('utf8'));
  omittedBlocks += prepared.omittedBlocks;
  if (!prepared.chunks.length) continue;
  documents.push({ title: article.title.replace(/\s*\| Microsoft Learn$/, ''), url: url.href, locale: article.locale, chunks: prepared.chunks });
}
if (!documents.length) throw new Error('No official references found.');
const index = { version: 1, retrievedOn: catalog.retrieved_on, sourceCommit: catalog.source_commit, documents };
const compressed = gzipSync(JSON.stringify(index), { level: 9 });
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'index.json.gz'), compressed);
for (const name of ['LICENSE', 'LICENSE-CODE']) await copyFile(join(source, 'original-en', name), join(destination, name));
await writeFile(join(destination, 'manifest.json'), JSON.stringify({
  version: 1, repository: catalog.official_repository, sourceCommit: catalog.source_commit,
  retrievedOn: catalog.retrieved_on, documents: documents.length,
  japaneseDocuments: documents.filter(doc => doc.locale === 'ja-jp').length,
  excerpts: documents.reduce((count, doc) => count + doc.chunks.length, 0),
  maxExcerptCharacters: MAX_EXCERPT_CHARACTERS, omittedOversizedBlocks: omittedBlocks,
  indexSha256: createHash('sha256').update(compressed).digest('hex'),
  sources: catalog.articles.map(({ path, source_url, source_commit, sha256 }) => ({ path, sourceUrl: source_url, sourceCommit: source_commit || catalog.source_commit, sha256 })),
}, null, 2) + '\n');
console.log(`Bundled ${documents.length} official articles; ${compressed.length} compressed bytes; ${omittedBlocks} oversized blocks omitted.`);
