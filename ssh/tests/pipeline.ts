import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { root, stateDir } from './vm.ts';
import { gatewayOrigin } from './network.ts';

type Stage = { name: string; command: string; args: string[] };
type Outcome = Stage & { status: 'passed' | 'failed'; durationMs: number; error?: string };

const args = process.argv.slice(2);
let reportWritten = false;
const usage = `Usage: npm run test:all -- [--stop-vm]

Run dependency installation, host checks, gateway tests, Debian provisioning,
and the complete SSH suite. Reuses the VM overlay and leaves the VM running.
An existing managed VM is stopped before gateway tests to release its ports.
--stop-vm also stops the VM after a successful suite; failures retain diagnostics.
Reports: .vm/pipeline-report.json, .vm/pipeline.log, .vm/report.json`;

if (args.includes('--help')) {
  console.log(usage);
} else if (args.some(arg => arg !== '--stop-vm')) {
  console.error(usage);
  process.exitCode = 2;
} else {
  await main().catch(error => {
    console.error(`\nPipeline failed: ${error.message}`);
    console.error(reportWritten
      ? 'Inspect .vm/pipeline-report.json and .vm/pipeline.log; VM state is retained.'
      : 'No test stages ran and no new pipeline report was written.');
    process.exitCode = 1;
  });
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error('Node.js 22.18 or later is required');
  const image = path.resolve(root, '../tests/debian-13-nocloud-amd64.qcow2');
  if (!fs.existsSync(image)) throw new Error(`Missing supplied Debian image: ${image}`);
  for (const command of ['cargo', 'npm', 'qemu-system-x86_64', 'qemu-img', 'ssh', 'ssh-keygen', 'bash']) {
    const check = spawnSync('bash', ['-c', 'command -v -- "$1" >/dev/null', 'pipeline-preflight', command], { cwd: root });
    if (check.error || check.status !== 0) throw new Error(`Required executable is unavailable: ${command}`);
  }

  const stages: Stage[] = [
    { name: 'Install locked Node dependencies', command: 'npm', args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'] },
    { name: 'Check Rust formatting', command: 'cargo', args: ['fmt', '--all', '--', '--check'] },
    { name: 'Check Rust with Clippy', command: 'cargo', args: ['clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings'] },
    { name: 'Build host binaries and PAM module', command: 'cargo', args: ['build', '--locked', '--workspace'] },
    { name: 'Run Rust unit and documentation tests', command: 'cargo', args: ['test', '--locked', '--workspace'] },
    { name: 'Type-check TypeScript', command: 'npm', args: ['run', 'typecheck'] },
    { name: 'Release ports held by the managed VM', command: 'npm', args: ['run', 'vm', '--', 'stop', '--if-running'] },
    { name: 'Run gateway contract tests', command: 'npm', args: ['test'] },
    { name: 'Prepare Debian and run guest Rust checks', command: 'npm', args: ['run', 'vm', '--', 'prepare'] },
    { name: 'Run the full OpenSSH end-to-end suite', command: 'npm', args: ['run', 'test:vm'] },
  ];
  if (args.includes('--stop-vm')) stages.push({ name: 'Stop the validated VM', command: 'npm', args: ['run', 'vm', '--', 'stop'] });

  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(stateDir, 'pipeline.lock');
  let lock: number;
  try { lock = fs.openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('A pipeline lock exists. Wait for the active run; remove .vm/pipeline.lock only after confirming its recorded PID is no longer running.');
    }
    throw error;
  }
  const report = {
    startedAt: new Date().toISOString(), finishedAt: null as string | null,
    status: 'running' as 'running' | 'passed' | 'failed',
    endpoint: '127.0.0.2:2222', gatewayOrigin, stopVmOnSuccess: args.includes('--stop-vm'),
    stages: [] as Outcome[],
  };
  const reportPath = path.join(stateDir, 'pipeline-report.json');
  const saveReport = () => {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    reportWritten = true;
  };
  let active: ChildProcess | undefined;
  let interrupted: string | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let log: number | undefined;

  function interrupt(signal: string) {
    interrupted = signal;
    if (active?.pid) {
      const pid = active.pid;
      try { process.kill(-pid, 'SIGTERM'); } catch { /* Child may already have exited. */ }
      killTimer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* Exited. */ } }, 5000);
      killTimer.unref();
    }
  }

  try {
    fs.writeFileSync(lock, `${process.pid}\n`);
    log = fs.openSync(path.join(stateDir, 'pipeline.log'), 'w', 0o600);
    saveReport();
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    for (const [index, stage] of stages.entries()) {
      if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
      const header = `\n[${index + 1}/${stages.length}] ${stage.name}\n$ ${stage.command} ${stage.args.join(' ')}\n`;
      process.stdout.write(header);
      fs.writeSync(log, header);
      const started = Date.now();
      try {
        await new Promise<void>((resolve, reject) => {
          active = spawn(stage.command, stage.args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
          active.stdout!.on('data', chunk => { process.stdout.write(chunk); fs.writeSync(log!, chunk); });
          active.stderr!.on('data', chunk => { process.stderr.write(chunk); fs.writeSync(log!, chunk); });
          active.once('error', reject);
          active.once('close', (code, signal) => {
            if (code === 0 && !interrupted) resolve();
            else reject(new Error(`${stage.name}: ${interrupted ?? signal ?? `exit ${code}`}`));
          });
        });
        report.stages.push({ ...stage, status: 'passed', durationMs: Date.now() - started });
      } catch (error) {
        report.stages.push({ ...stage, status: 'failed', durationMs: Date.now() - started, error: (error as Error).message });
        throw error;
      } finally {
        active = undefined;
        if (killTimer) clearTimeout(killTimer);
        saveReport();
      }
    }
    report.status = 'passed';
    console.log(`\nAll ${stages.length} pipeline stages passed. VM ${args.includes('--stop-vm') ? 'stopped' : 'running at 127.0.0.2:2222'}.`);
  } finally {
    if (report.status === 'running') report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    try { saveReport(); }
    finally {
      if (log !== undefined) fs.closeSync(log);
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}
