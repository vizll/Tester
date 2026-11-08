/* Copies the Tester web app (../../dist) into ./web, which is what the desktop app ships.
   Tests and docs are left out. Run automatically by `npm start` and every `npm run dist:*`. */
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', '..', 'dist');
const dest = path.resolve(__dirname, '..', 'web');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`Can't find the Tester web app at ${src}. Keep this folder inside "Tester 3.0/apps/desktop".`);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
const skip = new Set(['tests', 'README.md', '.DS_Store']);
fs.cpSync(src, dest, { recursive: true, filter: p => !skip.has(path.basename(p)) });
console.log(`Copied the web app into ${path.relative(process.cwd(), dest) || dest}`);
