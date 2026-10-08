import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { chunkPages, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './textbook-chunks.mjs';

const directory = resolve('.local/textbooks');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_SECRET_KEY || !process.env.CLASS_ACCOUNT_USER_ID) throw new Error('Set Gemini and local administrator environment variables first.');
const db = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 30000 } });
const vectorDirectory = join(directory, 'embeddings');
await mkdir(vectorDirectory, { recursive: true, mode: 0o700 });
const { data: existing, error } = await db.from('textbook_documents').select('filename,content_hash').eq('owner_id', process.env.CLASS_ACCOUNT_USER_ID);
if (error) throw new Error('Apply migration 003 before importing.');
const report = [];
for (const summary of manifest.books) {
  const book = JSON.parse(await readFile(join(directory, summary.hash + '.json'), 'utf8'));
  if (existing.some(doc => doc.filename === summary.filename && doc.content_hash === summary.hash) && !process.argv.includes('--force')) {
    console.log('Already imported:', summary.filename); continue;
  }
  const chunks = chunkPages(book.pages);
  const payload = [];
  for (let start = 0; start < chunks.length; start += 20) {
    const batch = chunks.slice(start, start + 20);
    const vectors = await Promise.all(batch.map(async chunk => {
      const cacheKey = createHash('sha256').update(EMBEDDING_MODEL + ':' + EMBEDDING_DIMENSIONS + ':' + summary.filename + ':' + chunk.content).digest('hex');
      try { return JSON.parse(await readFile(join(vectorDirectory, cacheKey + '.json'), 'utf8')); } catch { return null; }
    }));
    const missing = batch.map((_, index) => index).filter(index => !vectors[index]);
    if (missing.length) {
      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          response = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: missing.map(index => batch[index].content), config: { taskType: 'RETRIEVAL_DOCUMENT', title: summary.filename, outputDimensionality: EMBEDDING_DIMENSIONS } });
          break;
        } catch (error) {
          if (![429,500,503].includes(error.status) || attempt === 3) throw new Error(`Embedding failed for ${summary.filename}; HTTP ${error.status || 'unknown'}`);
          await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
        }
      }
      if (response.embeddings?.length !== missing.length) throw new Error('Unexpected embedding count.');
      for (let index = 0; index < missing.length; index++) {
        const values = response.embeddings[index].values;
        if (values?.length !== EMBEDDING_DIMENSIONS || !values.every(Number.isFinite)) throw new Error('Invalid embedding dimensions.');
        const batchIndex = missing[index];
        vectors[batchIndex] = values;
        const cacheKey = createHash('sha256').update(EMBEDDING_MODEL + ':' + EMBEDDING_DIMENSIONS + ':' + summary.filename + ':' + batch[batchIndex].content).digest('hex');
        await writeFile(join(vectorDirectory, cacheKey + '.json'), JSON.stringify(values), { mode: 0o600 });
      }
    }
    batch.forEach((chunk, index) => payload.push({ ...chunk, embedding: JSON.stringify(vectors[index]) }));
    console.log(`${summary.filename}: ${payload.length}/${chunks.length} indexed`);
  }
  const { error } = await db.rpc('replace_textbook_document', { p_owner_id: process.env.CLASS_ACCOUNT_USER_ID, p_filename: summary.filename, p_hash: summary.hash, p_format: book.format, p_page_count: book.pages.length, p_ocr_pages: summary.ocrPages, p_chunks: payload });
  if (error) throw new Error(`Import failed for ${summary.filename}; database code ${error.code || 'unknown'}`);
  report.push({ filename: summary.filename, pages: book.pages.length, chunks: chunks.length, ocrPages: summary.ocrPages });
  console.log('Imported:', summary.filename);
}
await writeFile(join(directory, 'import-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log('Import complete:', report.length);
