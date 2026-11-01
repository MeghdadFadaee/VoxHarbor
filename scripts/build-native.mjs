import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Native build step failed: ${command}`);
}
const allowed = ['PATH', 'HOME', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME', 'LANG', 'LC_ALL', 'CC', 'CXX', 'AR', 'CFLAGS', 'CXXFLAGS', 'MACOSX_DEPLOYMENT_TARGET', 'SDKROOT', 'RUSTUP_OVERRIDE_UNIX_FALLBACK_SETTINGS'];
let env = { ...Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]])), CARGO_REGISTRIES_CRATES_IO_PROTOCOL: 'sparse' };
if (process.env.VERCEL === '1') {
  run('bash', ['scripts/bootstrap-rust.sh'], env);
  env.PATH = `${process.env.HOME}/.cargo/bin:${env.PATH}`;
  env.RUSTUP_TOOLCHAIN = '1.96.0';
} else if (existsSync('/opt/homebrew/opt/rustup/bin/cargo')) {
  env.PATH = `/opt/homebrew/opt/rustup/bin:${env.PATH}`;
}
run('cargo', ['build', '--manifest-path', 'native/Cargo.toml', '--locked', '--release'], env);
await mkdir(new URL('../native/bin/', import.meta.url), { recursive: true });
const target = new URL('../native/bin/voxharbor-protocol', import.meta.url);
await copyFile(new URL('../native/target/release/voxharbor-protocol', import.meta.url), target);
await chmod(target, 0o755);
console.log('Native protocol executable packaged for this platform.');
if (process.platform === 'linux') run('ldd', [fileURLToPath(target)]);
