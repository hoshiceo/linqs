import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const bytes = await readFile('package-lock.json');
const lock = JSON.parse(bytes);
const packages = Object.entries(lock.packages).filter(([path]) => path).map(([path, item]) => {
  if (!item.version || !item.license) throw new Error(`Review missing package version/license metadata: ${path}`);
  return { path, version: item.version, license: item.license, development: item.dev === true, optional: item.optional === true };
}).sort((a, b) => a.path.localeCompare(b.path, 'en'));
const result = JSON.stringify({ format: 1, source: 'package-lock.json', lockfileSha256: createHash('sha256').update(bytes).digest('hex'), scope: 'Declared npm metadata, including development and optional platforms. Not a substitute for original license texts or binary-distribution review.', packages }, null, 2) + '\n';
const file = 'docs/dependency-licenses.json';
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== result) throw new Error('License inventory is stale. Run npm run licenses:update and review the result.');
  console.log(`License inventory matches ${packages.length} locked packages.`);
} else {
  await mkdir('docs', { recursive: true });
  await writeFile(file, result);
  console.log(`Recorded declared licenses for ${packages.length} locked packages.`);
}
