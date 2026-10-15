import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sshRoot = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
const clippyConfig = fileURLToPath(new URL('../../clippy.toml', import.meta.url));

/** Build/stage browser assets, the gateway crate, and the Clippy settings for the readonly VM share. */
export function stageFrontend(): void {
  const run = (args: string[]) => {
    const result = spawnSync('npm', args, { cwd: frontend, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Frontend build failed', { cause: result.error });
  };
  if (!fs.existsSync(path.join(frontend, 'node_modules/vite/package.json'))) run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run(['run', 'build']);
  const cache = path.join(sshRoot, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.rmSync(path.join(cache, 'frontend'), { recursive: true, force: true });
  fs.cpSync(path.join(frontend, 'dist'), path.join(cache, 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(cache, 'backend'), { recursive: true });
  fs.copyFileSync(path.join(backend, 'Cargo.toml'), path.join(cache, 'backend/Cargo.toml'));
  fs.cpSync(path.join(backend, 'src'), path.join(cache, 'backend/src'), { recursive: true });
  fs.copyFileSync(clippyConfig, path.join(cache, 'clippy.toml'));
}
