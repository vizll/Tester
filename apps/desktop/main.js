/* Tester desktop (macOS + Windows). Serves the Tester web app from inside the app on a private,
   secure origin (tester://app) so storage (IndexedDB), Web Workers and the chess engine's WebAssembly
   all work offline and your data persists between launches. Nothing is sent anywhere. */
'use strict';
const { app, BrowserWindow, Menu, protocol, shell, nativeTheme, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const SCHEME = 'tester';
const ORIGIN = `${SCHEME}://app`;
const WEB = path.join(__dirname, 'web');
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const isMac = process.platform === 'darwin';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.gz': 'application/gzip',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

// Must happen before the app is ready: a standard, secure scheme gets its own persistent storage,
// fetch/CORS, workers and streaming like an https site.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true }
}]);

app.setName('Tester');
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;

function serveFile(request) {
  let rel;
  try { rel = decodeURIComponent(new URL(request.url).pathname); } catch (_) { return new Response('Bad request', { status: 400 }); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB, rel));
  if (file !== WEB && !file.startsWith(WEB + path.sep)) return new Response('Forbidden', { status: 403 });
  return fs.promises.readFile(file).then(
    data => new Response(data, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } }),
    () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  );
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    // only reuse a position that is still on a connected screen
    const visible = screen.getAllDisplays().some(d => s.x >= d.bounds.x - 40 && s.y >= d.bounds.y - 40 && s.x < d.bounds.x + d.bounds.width - 80 && s.y < d.bounds.y + d.bounds.height - 80);
    return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch (_) { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (_) { /* not critical */ }
}

function isInternal(url) { return url.startsWith(ORIGIN + '/') || url === ORIGIN || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('about:'); }
function openOutside(url) { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); }

function createWindow() {
  const st = readState();
  const work = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: st.width || Math.min(1440, work.width), height: st.height || Math.min(920, work.height),
    x: st.x, y: st.y,
    minWidth: 380, minHeight: 560,
    show: false,
    title: 'Tester',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0f13' : '#dfe9ee',
    // macOS: the app's own top bar is the title bar; traffic lights sit above the sidebar
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 18 } } : { autoHideMenuBar: true }),
    icon: isMac ? undefined : path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: true
    }
  });
  if (st.maximized) win.maximize();

  const wc = win.webContents;
  wc.on('dom-ready', () => {
    try { wc.insertCSS(fs.readFileSync(path.join(__dirname, 'desktop.css'), 'utf8')); } catch (_) { /* optional polish */ }
  });
  // links that open a new window go to the default browser
  wc.setWindowOpenHandler(({ url }) => { if (!isInternal(url)) openOutside(url); return { action: 'deny' }; });
  // never navigate the app itself away from Tester
  wc.on('will-navigate', (e, url) => { if (!isInternal(url)) { e.preventDefault(); openOutside(url); } });
  // Tester only blocks closing when the browser storage refused to save; ask instead of silently staying open
  wc.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Stay', 'Quit anyway'], defaultId: 0, cancelId: 0, message: 'Your latest changes aren’t saved.', detail: 'Stay to download a backup from Customize → Data, or quit and lose the unsaved changes.' });
    if (choice === 1) e.preventDefault();
  });
  // a crashed page reloads instead of showing a blank window
  wc.on('render-process-gone', (_e, details) => { if (details.reason !== 'clean-exit') setTimeout(() => wc.reload(), 400); });

  win.once('ready-to-show', () => win.show());
  ['resize', 'move', 'close'].forEach(evt => win.on(evt, saveState));
  win.on('closed', () => { win = null; });
  win.loadURL(`${ORIGIN}/index.html`);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View', submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Where is my data?', click: () => shell.openPath(app.getPath('userData')) }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  protocol.handle(SCHEME, serveFile);
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
