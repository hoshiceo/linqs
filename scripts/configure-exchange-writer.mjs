import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Manual administrator provisioning; this command is never run by the app or CI.
const environment = process.argv[2];
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const ownerId = process.env.CLASS_ACCOUNT_USER_ID;
if (!['development', 'production'].includes(environment) || !url || !secret || !ownerId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
  console.error('Specify development or production, SUPABASE_URL, SUPABASE_SECRET_KEY and CLASS_ACCOUNT_USER_ID.');
  process.exit(1);
}
let parsedUrl;
let publicOrigin;
try {
  parsedUrl = new URL(url);
  publicOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : undefined;
} catch {
  console.error('Check the Supabase project URL and matching environment settings.');
  process.exit(1);
}
if (!parsedUrl || parsedUrl.username || parsedUrl.password ||
    !(parsedUrl.protocol === 'https:' || (environment === 'development' && parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname))) ||
    (publicOrigin && publicOrigin !== parsedUrl.origin)) {
  console.error('Check the Supabase project URL and matching environment settings.');
  process.exit(1);
}
const directory = resolve('.local');
const file = resolve(directory, `exchange-writer.${environment}.json`);
await mkdir(directory, { recursive: true, mode: 0o700 });
let record;
try { record = JSON.parse(await readFile(file, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read existing writer record. Preserve it and check it locally.'); }
if (record) {
  if (record.url !== parsedUrl.origin || record.ownerId !== ownerId || !/^[a-f0-9]{64}$/.test(record.key ?? '')) {
    throw new Error('Existing writer record belongs to different settings. Preserve it; do not overwrite it.');
  }
  if (record.status === 'configured') {
    console.log(`Already configured. Read SUPABASE_EXCHANGE_WRITE_KEY from ${file} locally; no remote change made.`);
    process.exit(0);
  }
} else {
  record = { status: 'pending', environment, url: parsedUrl.origin, ownerId, key: randomBytes(32).toString('hex') };
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
try {
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.rpc('configure_exchange_writer', { p_owner_id: ownerId, p_write_key: record.key });
  if (error) throw new Error('Provisioning unconfirmed');
  await writeFile(file, JSON.stringify({ ...record, status: 'configured' }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Writer configured. Read SUPABASE_EXCHANGE_WRITE_KEY from ${file} locally. The key is not printed.`);
} catch {
  console.error('Configuration could not be confirmed. Apply migration 004 and check administrator settings; retry reuses the saved key.');
  process.exitCode = 1;
}
