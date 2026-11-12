// Finds the rescue boats' ways through the flood once, from the plan (src/core/plan.js), and writes them to
// src/core/routes.js, so the game does not search for them on a phone.
//   node scripts/gen-routes.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOAT_ROUTES, STAGING, SURVIVORS } from '../src/core/plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const routes = BOAT_ROUTES();
let s = '// Written by scripts/gen-routes.mjs from src/core/plan.js. Do not edit by hand.\n';
s += '// ROUTES[landing][survivor]: the way a boat takes between them, as [x, z] points.\n';
s += `// Landings: ${STAGING.map((q) => q.id).join(', ')}. Survivors: ${SURVIVORS.map((q) => q.id).join(', ')}.\n`;
s += 'export const ROUTES = ' + JSON.stringify(routes) + ';\n';
await writeFile(path.join(here, '..', 'src', 'core', 'routes.js'), s);
console.log('routes written: ' + routes.length * routes[0].length);
