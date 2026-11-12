// Vite builds DRONE 3D into dist/: the page, the game's code, the font, the icons and the manifest. The last step
// writes the service worker (sw.js) with the list of every file built, so a phone that has opened the game once
// can play it offline. base './' lets the game be served from any folder (GitHub Pages serves it from
// /<repository>/).
import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** Writes dist/sw.js from sw-template.js: the files to keep, and a version that changes when any of them does. */
function serviceWorker() {
  let outDir = 'dist';
  return {
    name: 'drone3d-service-worker',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const all = files(outDir).filter((p) => !p.endsWith('sw.js') && !p.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const p of all) hash.update(relative(outDir, p)).update(readFileSync(p));
      const list = ['./', ...all.map((p) => './' + relative(outDir, p).split(sep).join('/'))];
      const sw = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', `${pkg.version}-${hash.digest('hex').slice(0, 10)}`)
        .replace('__FILES__', JSON.stringify(list, null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200, assetsInlineLimit: 0 },
  plugins: [serviceWorker()],
});
