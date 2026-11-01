import { copyFile, mkdir } from 'node:fs/promises';
const dest = new URL('../public/vendor/opus/', import.meta.url);
const source = new URL('../node_modules/libopus-wasm/', import.meta.url);
await mkdir(new URL('generated/', dest), { recursive: true });
for (const [from, to] of [['dist/index.js', 'index.js'], ['dist/generated/libopus.generated.mjs', 'generated/libopus.generated.mjs'], ['LICENSE', 'LICENSE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']]) {
  await copyFile(new URL(from, source), new URL(to, dest));
}
console.log('Pinned Opus browser codec and license notices packaged.');
