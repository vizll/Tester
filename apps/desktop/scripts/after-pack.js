/* macOS: ad-hoc sign the packed app. Apple Silicon refuses to run an app whose signature was broken
   by packaging, and this project has no paid Apple Developer ID. An ad-hoc signature lets it launch
   (first launch: right-click → Open, or run the "Open Tester" fix described in apps/README.md). */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${path.basename(app)}`);
};
