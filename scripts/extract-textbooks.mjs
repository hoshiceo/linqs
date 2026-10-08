import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
const execute = promisify(execFile);
const source = resolve(process.argv[2] || 'textbook');
const destination = resolve('.local/textbooks');
await mkdir(destination, { recursive: true, mode: 0o700 });
await chmod(destination, 0o700);
const compilerDir = join(tmpdir(), 'linqs-textbook-tools');
await mkdir(compilerDir, { recursive: true, mode: 0o700 });
const executable = join(compilerDir, 'extract-pages');
await execute('swiftc', [resolve('scripts/extract-textbook-pages.swift'), '-o', executable]);
const fontConfig = join(compilerDir, 'fonts.conf');
await writeFile(fontConfig, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/System/Library/Fonts</dir><dir>/System/Library/Fonts/Supplemental</dir><dir>/Library/Fonts</dir><cachedir>${compilerDir}/font-cache</cachedir></fontconfig>`);
const files = (await readdir(source)).filter(name => /\.(pdf|docx)$/i.test(name)).sort();
const manifest = [];
for (const filename of files) {
  const original = join(source, filename);
  const hash = createHash('sha256').update(await readFile(original)).digest('hex');
  const output = join(destination, hash + '.json');
  let book;
  try { book = JSON.parse(await readFile(output, 'utf8')); } catch {}
  const version = /\.docx$/i.test(filename) ? 2 : 1;
  if (!book || book.version !== version) {
    let input = original;
    if (/\.docx$/i.test(filename)) {
      const conversion = join(compilerDir, hash);
      await mkdir(conversion, { recursive: true });
      await execute(process.env.SOFFICE_BIN || 'soffice', ['--headless', `-env:UserInstallation=file://${compilerDir}/lo-profile`, '--convert-to', 'pdf', '--outdir', conversion, original], { env: { ...process.env, FONTCONFIG_FILE: fontConfig } });
      input = join(conversion, basename(filename).replace(/\.docx$/i, '.pdf'));
    }
    await new Promise((done, reject) => {
      const child = spawn(executable, [input, output], { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', code => code === 0 ? done() : reject(new Error(`Extraction failed: ${filename}`)));
    });
    book = JSON.parse(await readFile(output, 'utf8'));
    book.version = version;
    book.file = filename;
    book.hash = hash;
    book.format = /\.docx$/i.test(filename) ? 'docx' : 'pdf';
    await writeFile(output, JSON.stringify(book), { mode: 0o600 });
  }
  const summary = { filename, hash, format: book.format, pageCount: book.pages.length, ocrPages: book.pages.filter(page => page.method === 'ocr').length, emptyPages: book.pages.filter(page => !page.text.trim()).map(page => page.page) };
  manifest.push(summary);
  console.log('Extracted:', JSON.stringify(summary));
}
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ version: 1, books: manifest }, null, 2), { mode: 0o600 });
console.log(`Textbooks ready: ${manifest.length}`);
