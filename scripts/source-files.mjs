import { readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const roots = ['api', 'src', 'public', 'scripts', 'tests', 'docs', 'native/src', 'native/vendor'];
const top = ['.gitignore', '.vercelignore', '.env.example', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md', 'README.md', 'IMPLEMENTATION_PLAN.md', 'package.json', 'package-lock.json', 'vercel.json', 'native/Cargo.toml', 'native/Cargo.lock', 'native/README.md'];
export function privatePath(path) {
  return /(^|\/)(\.git|\.local|\.idea|\.vscode|node_modules|target|coverage|evidence)(\/|$)/.test(path) ||
    /^(native\/bin|docs\/verification)(\/|$)/.test(path) ||
    /(^|\/)\.env(?:\.|$)/.test(path) && path !== '.env.example' ||
    /\.(?:log|har|pem|key|p12|pfx|wav|mp3|ogg|enc\.json)$/i.test(path) || /(^|\/)identity\.ini$/i.test(path);
}
export async function collectSourceFiles(root = projectRoot) {
  root = resolve(root); const files = [];
  async function add(path) {
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.isSymbolicLink() || privatePath(path)) throw new Error(`Unsupported public source path: ${path}`);
    files.push(path);
  }
  async function walk(path) {
    if (!(await lstat(join(root, path))).isDirectory()) throw new Error(`Not a source directory: ${path}`);
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'target', 'bin'].includes(entry.name)) continue;
      const child = `${path}/${entry.name}`;
      if (privatePath(child)) throw new Error(`Private material inside source tree: ${child}`);
      if (entry.isDirectory()) await walk(child); else await add(child);
    }
  }
  for (const directory of roots) await walk(directory);
  for (const path of top) await add(path);
  return files.sort();
}
