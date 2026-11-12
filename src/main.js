// DRONE 3D starts here: the font, the styles, the game, and the service worker that keeps it on the phone for
// playing offline.
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import './style.css';
import { App } from './app.js';

async function start() {
  // the painted signs of the barangay use the font: wait for it (but not for long)
  try {
    await Promise.race([
      Promise.all(['700', '800', '900'].map((w) => document.fonts.load(`${w} 24px Nunito`))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* the signs fall back to another font */ }
  const app = new App();
  window.drone3d = app;
  await app.init();
}

start().catch((e) => {
  const box = document.querySelector('#loading div:last-child');
  if (box) box.textContent = 'DRONE 3D could not start: ' + (e && e.message ? e.message : e) + '. It needs WebGL.';
  console.error(e);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* played online only */ }); });
}
