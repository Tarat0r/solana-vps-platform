import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Put forwarded Node test options before the test file so name filters work.
const child = spawn(process.execPath, [
  '--experimental-strip-types', '--test', '--test-concurrency=1',
  ...process.argv.slice(2), fileURLToPath(new URL('./ssh.test.ts', import.meta.url)),
], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
