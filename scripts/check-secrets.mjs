import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const binary = process.env.GITLEAKS_BIN || 'gitleaks';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Security check failed: ${command}. Install Gitleaks 8.30.1 or set GITLEAKS_BIN.`);
}
const flags = ['--redact=100', '--no-banner', '--no-color', '--max-archive-depth=2'];
run(binary, ['git', '.', '--log-opts=--all', ...flags]);
const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (files.error || files.status !== 0) throw new Error('Cannot enumerate publishable files.');
const directory = await mkdtemp(join(tmpdir(), 'linqs-secret-scan-'));
try {
  // Scan only Git publication candidates, including gzip data; keep local credentials out.
  for (const file of files.stdout.split('\0').filter(Boolean)) {
    let info;
    try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink()) throw new Error('Review symbolic links before publication.');
    if (!info.isFile()) continue;
    const target = join(directory, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(file, target);
  }
  run(binary, ['dir', directory, ...flags]);
} finally { await rm(directory, { recursive: true, force: true }); }
