/* Tester — automated checks. Serves this folder over HTTP (needed for the Stockfish worker/WASM), then
   drives the real app in Chromium with Playwright. Each test gets a fresh browser profile.
   Usage:  node tests/run-tests.js [filter]      (requires the `playwright` package and Chromium)
   Google Calendar tests use local fixtures for Google's sign-in script and API — they exercise Tester's
   code paths, not Google's servers. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.TEST_OUT || path.join(require('os').tmpdir(), 'tester-test-output');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8', '.gz': 'application/gzip' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

const tests = [];
const test = (name, fn, opts = {}) => tests.push({ name, fn, opts });
const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

let BASE = '';
async function open(browser, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1400, height: 900 }, timezoneId: opts.timezoneId, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(BASE)) errors.push(`http ${r.status()} ${r.url()}`); });
  // Embedding is tested at the widget boundary; no real Google account or calendar is needed.
  await context.route(/^https:\/\/calendar\.google\.com\/calendar\/embed(?:\?|$)/, r => r.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Google Calendar fixture</title></head><body>Calendar fixture</body></html>'
  }));
  if (opts.before) await opts.before(page, context);
  if (opts.load !== false) {
    await boot(page);
    // New students start with the game panel closed; game tests play beside the quiz, so open it (a student opting in).
    await page.evaluate(() => { SS.play.state.panel.visible = true; SS.play.save(); });
    // Tests written for a dashboard with a calendar use the Study & play workspace (still a built-in preset).
    if (opts.workspace) await page.evaluate(id => { const ws = SS.ws.all().find(w => w.presetId === id); SS.ws.switchTo(ws.id, { instant: true }); SS.nav.go('home', { focus: false }); }, opts.workspace);
    if (opts.workspace) await page.waitForTimeout(200);
  }
  return { context, page, errors };
}
async function boot(page, url = `${BASE}/index.html`) {
  await page.goto(url);
  await page.waitForFunction(() => window.SS && SS.nav && document.querySelector('.nav-row') && !document.documentElement.classList.contains('booting'));
  // the welcome dialog opens shortly after a first start
  await page.waitForSelector('dialog.dlg-welcome', { timeout: 1200 }).catch(() => null);
  await closeDialogs(page);
}
async function closeDialogs(page) {
  for (let i = 0; i < 3; i++) { if (await page.$('dialog[open]')) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } }
}
const flush = page => page.evaluate(() => SS.store.flush());
// navigating moves focus to the new view one frame later (SS.nav); wait for it before using the keyboard
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const addSet = (page, cards, title = 'Test set') => page.evaluate(([cards, title]) => SS.data.add('quizzes', { title, cards }).id, [cards, title]);
const CARDS = [['alpha', 'one'], ['beta', 'two'], ['gamma', 'three'], ['delta', 'four'], ['epsilon', 'five'], ['zeta', 'six']].map(([term, def]) => ({ term, def }));

/* Start a written-answer quiz on a set, through the UI */
async function startWrittenQuiz(page, setId, count = 6) {
  // the game panel starts closed for new students; these tests play alongside the quiz, so open it first
  await page.evaluate(() => { SS.play.state.panel.visible = true; SS.play.save(); });
  await page.evaluate(id => SS.quiz.practice(id), setId);
  await page.waitForSelector('.qz-quiz select');
  const selects = await page.$$('.qz-quiz select');
  await selects[0].selectOption(setId);
  await selects[1].selectOption('written');
  await page.fill('.qz-quiz input[type=number]', String(count));
  await page.click('.qz-quiz button:has-text("Start quiz")');
  await page.waitForSelector('.qz-written');
}
const currentQuestion = page => page.evaluate(() => { const s = SS.play.state.session; return s.questions[s.index]; });
async function answer(page, correct) {
  const q = await currentQuestion(page);
  await page.fill('.qz-written', correct ? q.expected : 'definitely wrong answer');
  await page.click('.qz-qfoot button:has-text("Check answer")');
  await page.waitForSelector('.qz-feedback.qz-correct, .qz-feedback.qz-incorrect');
}
const nextQuestion = page => page.click('.qz-qfoot button:not([hidden]):is(:has-text("Next question"), :has-text("See results"))');
const play = page => page.evaluate(() => ({ actions: { ...SS.play.state.actions }, progress: SS.play.state.progress, wins: { ...SS.play.state.wins }, game: SS.play.state.game }));

/* ======================= Logic ======================= */
test('play state: version-1 save migrates (moves, wins, profile kept; points/shop dropped)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const v1 = { version: 1, credits: { chess: 5, solitaire: 0, '2048': 2, tetris: 1 }, wins: { chess: 1, solitaire: 0, '2048': 3, tetris: 0 }, progress: { chess: 2, solitaire: 1, '2048': 0, tetris: 0 }, settings: { threshold: 3, turns: 3, autoOpen: true, pauseForGames: true }, quizOptions: { rewardGame: 'chess', mode: 'written', limit: 7 }, profile: { name: 'Sam', bio: 'hi', banner: 'cosmos', frame: 'gold', owned: ['aurora', 'simple', 'cosmos', 'gold'], points: 900, lifetime: 1500, correct: 42, studySeconds: 999, width: 300, collapsed: true }, gameData: { chess: { history: ['e4', 'e5'], difficulty: 'expert', won: false, white: '#eeeeee' } } };
    const s = SS.play.sanitize(v1);
    return { s, keys: Object.keys(s), profileKeys: Object.keys(s.profile) };
  });
  eq(r.s.actions, { chess: 5, solitaire: 0, '2048': 2, blocks: 1 }, 'actions (unused Tetris moves → Block Puzzle)');
  eq(r.s.wins['2048'], 3, 'wins kept');
  eq(r.s.progress, 2, 'progress of the selected game');
  eq(r.s.game, 'chess', 'selected game');
  eq(r.s.quiz.mode, 'written', 'quiz options');
  eq(r.s.stats.correct, 42, 'correct answers stat');
  eq(r.s.profile.banner, 'cosmos', 'banner kept'); eq(r.s.profile.frame, 'gold', 'frame kept');
  assert(!r.profileKeys.includes('points') && !r.profileKeys.includes('owned') && !r.profileKeys.includes('lifetime'), 'points/shop fields dropped');
  eq(r.s.gameData.chess.game.history, ['e4', 'e5'], 'chess history migrated');
  eq(r.s.gameData.chess.prefs.difficulty, 'expert', 'chess prefs migrated');
  eq(r.s.version, 3, 'version');
});

test('play state: version-2 save with Tetris becomes Block Puzzle (moves carried, Tetris wins kept on record)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const v2 = { version: 2, game: 'tetris', actions: { chess: 1, solitaire: 0, '2048': 0, tetris: 5 }, progress: 2, settings: { need: 3, grant: 3 }, wins: { chess: 1, solitaire: 0, '2048': 0, tetris: 3 }, stats: { correct: 9, answered: 12, sessions: 2, moves: { chess: 4, solitaire: 0, '2048': 0, tetris: 30 } }, gameData: { tetris: { prefs: { palette: 'neon', background: '#101010', grid: false, squareBlocks: true, target: 20 }, game: { board: [] } } } };
    const s = SS.play.sanitize(v2);
    return { s, total: SS.play.totalWins(s), again: SS.play.sanitize(JSON.parse(JSON.stringify(s))) };
  });
  eq(r.s.game, 'blocks', 'selected game'); eq(r.s.actions.blocks, 5, 'moves carried over'); assert(!('tetris' in r.s.actions), 'no Tetris moves left');
  eq(r.s.wins, { chess: 1, solitaire: 0, '2048': 0, blocks: 0 }, 'Block Puzzle starts with no wins');
  eq(r.s.legacy, { tetris: { wins: 3, moves: 30 } }, 'Tetris record kept'); eq(r.total, 4, 'total wins include Tetris wins');
  eq(r.s.gameData.blocks.prefs, { target: 6000, palette: 'neon', boardColor: '#101010', grid: false, ghost: true, clearHint: true, squareBlocks: true }, 'Tetris look carried over');
  assert(!r.s.gameData.tetris, 'old board dropped');
  eq(r.again.legacy, r.s.legacy, 'version 3 round trip keeps the record'); eq(r.again.actions, r.s.actions, 'and the moves');
});

test('learning gate: 2 correct lock, 3rd grants 3 once; wrong and repeats don’t count', async ({ page }) => {
  const r = await page.evaluate(() => {
    const P = SS.play; P.load(null); P.setGame('2048');
    const log = [];
    log.push(P.submit('s:1', true)); log.push(P.submit('s:2', false)); log.push(P.submit('s:3', true));
    const before = P.actions('2048');
    log.push(P.submit('s:3', true)); // repeat of an already counted question
    log.push(P.submit('s:4', true));
    const after = P.actions('2048');
    log.push(P.submit('s:4', true));
    return { before, after, final: P.actions('2048'), progress: P.state.progress, log };
  });
  eq(r.before, 0, 'two correct answers leave the gate locked');
  eq(r.after, 3, 'third correct answer grants 3 moves');
  eq(r.final, 3, 'repeat submission grants nothing more');
  eq(r.progress, 0, 'progress resets after a grant');
  eq(r.log[1].counted, true, 'wrong answer is counted as answered'); eq(r.log[1].granted, 0, 'but grants nothing');
  eq(r.log[3].counted, false, 'repeat key not counted');
});

test('import parser: Quizlet TSV, quoted CSV, header, custom separators, malformed rejected', async ({ page }) => {
  const r = await page.evaluate(() => {
    const p = SS.quiz.parseImport;
    return {
      tsv: p('Cell\tBasic unit of life\nMitochondria\tPowerhouse, of the cell\n'),
      csv: p('term,definition\n"Hello, world","A ""quoted"" thing"\n"multi\nline",ok\n', 'auto', '\n', true),
      custom: p('a | one\nb | two', ' | '),
      cardSep: p('a\tone;b\ttwo', '\t', ';'),
      unclosed: p('a,"oops\nb,two', ','),
      missing: p('just a line\nx\ty', '\t'),
      dash: p('Cell - Basic unit\nAtom - Smallest unit')
    };
  });
  eq(r.tsv.cards, [{ term: 'Cell', def: 'Basic unit of life' }, { term: 'Mitochondria', def: 'Powerhouse, of the cell' }], 'tab-separated');
  eq(r.tsv.separator, '\t', 'detected tab');
  eq(r.csv.cards, [{ term: 'Hello, world', def: 'A "quoted" thing' }, { term: 'multi\nline', def: 'ok' }], 'quoted CSV with header skipped');
  eq(r.custom.cards.length, 2, 'custom separator');
  eq(r.cardSep.cards, [{ term: 'a', def: 'one' }, { term: 'b', def: 'two' }], 'custom card separator');
  assert(r.unclosed.errors.some(e => /closing quote/.test(e)), 'unclosed quote reported');
  assert(r.missing.errors.length === 1 && r.missing.cards.length === 1, 'line without separator reported');
  eq(r.dash.cards.length, 2, 'spaced dash detected');
});

test('grading: typos forgiven, numbers/negation/strict enforced', async ({ page }) => {
  const r = await page.evaluate(() => { const g = SS.quiz.gradeAnswer; return [g('Powerhouse of the cel', 'Powerhouse of the cell').ok, g('1776', '1777').ok, g('not a cell', 'a cell').ok, g('PARIS', 'Paris', true).ok, g('Pariss', 'Paris', true).ok, g('', 'Paris').ok]; });
  eq(r, [true, false, false, true, false, false], 'grading results');
});

test('game mechanics: 2048 slide, Solitaire sanitizer, Block Puzzle placing/clearing/dealing', async ({ page }) => {
  const r = await page.evaluate(() => {
    const M = window.SSArcadeMechanics;
    const s = M.slide2048([2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4, 'left');
    const noChange = M.slide2048([2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4, 'left');
    const sol = M.freshSolitaire(); const dup = JSON.parse(JSON.stringify(sol)); dup.stock[0] = dup.stock[1];
    // row 0 and column 7 each miss only the top-right square: one block there clears both at once
    const b = Array(64).fill(0); for (let c = 0; c < 7; c++) b[c] = 1; for (let y = 1; y < 8; y++) b[y * 8 + 7] = 2;
    const cross = M.bbPlace(b, 'dot-0', 0, 7, 3);
    const nearlyFull = Array(64).fill(1); nearlyFull[27] = 0;
    const deals = Array.from({ length: 20 }, () => M.bbDeal(nearlyFull)).every(t => M.bbAnyFit(nearlyFull, t));
    const fresh = M.freshBlocks({ target: 3000 });
    const shapes = Object.values(M.BB_SHAPES);
    return { row: s.board.slice(0, 4), score: s.score, merged: s.merged, noChange: noChange.changed, solOk: !!M.sanitizeSolitaire({ game: sol }).game, solDup: !!M.sanitizeSolitaire({ game: dup }).game,
      cross: { lines: cross.lines, cleared: cross.cleared.length, empty: cross.board.every(v => !v) }, fits: [M.bbFits(b, 'i2-0', 0, 6), M.bbFits(b, 'i2-0', 1, 0), M.bbFits(b, 'o3-0', 6, 6)], points: M.bbScore(1, 2, 1), combo: M.bbScore(3, 1, 3), deals,
      okGame: !!M.sanitizeBlocks({ game: fresh }).game, badBoard: !!M.sanitizeBlocks({ game: { ...fresh, board: fresh.board.slice(0, 5) } }).game, badPiece: !!M.sanitizeBlocks({ game: { ...fresh, tray: [{ shape: 'nope', color: 1 }, null, null] } }).game,
      shapesOk: shapes.length > 30 && shapes.every(x => x.cells.every(([y, c]) => y < x.h && c < x.w)) };
  });
  eq(r.row, [4, 4, 0, 0], '2048 merge'); eq(r.score, 4, '2048 score'); eq(r.merged, [0], '2048 merged square'); eq(r.noChange, false, 'no-op slide detected');
  eq([r.solOk, r.solDup], [true, false], 'solitaire sanitizer');
  eq(r.cross, { lines: 2, cleared: 15, empty: true }, 'a row and a column clear together');
  eq(r.fits, [false, true, false], 'fit checks (overlap, free, off the board)');
  eq([r.points, r.combo], [310, 230], 'scoring: 10 a block, line bonus, combo boost');
  assert(r.deals, 'a new tray always has a piece that fits when anything can');
  eq([r.okGame, r.badBoard, r.badPiece], [true, false, false], 'block puzzle sanitizer'); assert(r.shapesOk, 'shape catalogue');
});

test('chess rules: castling, en passant, every promotion, check/mate, stalemate, draws', async ({ page }) => {
  await page.evaluate(() => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'vendor/chess.js'; s.onload = ok; s.onerror = fail; document.head.append(s); }));
  const r = await page.evaluate(() => {
    const C = window.Chess; const st = SS.chessTest.statusOf;
    const g = new C('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castle = ['O-O', 'O-O-O'].every(m => g.moves().includes(m));
    const ep = new C(); ['e4', 'a6', 'e5', 'd5'].forEach(m => ep.move(m)); const epMove = ep.moves({ verbose: true }).find(m => m.from === 'e5' && m.to === 'd6');
    const promo = ['q', 'r', 'b', 'n'].map(p => { const x = new C('8/P6k/8/8/8/8/8/K7 w - - 0 1'); const m = x.move({ from: 'a7', to: 'a8', promotion: p }); return m.san; });
    const mate = new C(); ['f3', 'e5', 'g4', 'Qh4#'].forEach(m => mate.move(m));
    const humanMate = new C('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1'); humanMate.move('Qg7#');
    const stale = new C('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const rep = new C(); ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'].forEach(m => rep.move(m));
    const insuf = new C('8/8/8/8/8/8/k7/K1N5 w - - 0 1');
    const fifty = new C('8/8/8/8/8/8/k7/K1R5 w - - 100 80');
    const check = new C('4k3/8/8/8/8/8/8/4K2R w - - 0 1'); check.move('Rh8+');
    const fb = SS.chessTest.fallbackMove(new C().fen(), 'expert');
    return { castle, ep: !!(epMove && epMove.flags.includes('e')), promo, mate: st(mate).text, humanMate: st(humanMate), stale: st(stale).text, rep: st(rep).text, insuf: st(insuf).text, fifty: st(fifty).text, check: st(check), fb: new C().moves({ verbose: true }).some(m => m.from + m.to === fb) };
  });
  assert(r.castle, 'both castles legal'); assert(r.ep, 'en passant available');
  eq(r.promo, ['a8=Q', 'a8=R', 'a8=B', 'a8=N'], 'all promotions');
  assert(/bot wins/.test(r.mate), 'bot checkmate'); assert(r.humanMate.win === true, 'human checkmate is a win');
  assert(/Stalemate/.test(r.stale), 'stalemate'); assert(/threefold/.test(r.rep), 'threefold'); assert(/material/.test(r.insuf), 'insufficient'); assert(/50-move/.test(r.fifty), '50-move');
  assert(r.check.check && !r.check.over, 'check'); assert(r.fb, 'fallback bot returns a legal move');
});

test('google calendar mapping: all-day/multi-day/midnight, dedupe, cancelled, DST', async ({ page }) => {
  const r = await page.evaluate(() => {
    const G = SS.gcal;
    const days = ev => G.daysOf(G.normalize(ev, 'c1'));
    const allDay = days({ id: 'a', start: { date: '2026-03-05' }, end: { date: '2026-03-06' } });
    const multi = days({ id: 'b', start: { date: '2026-03-05' }, end: { date: '2026-03-08' } });
    const overnight = days({ id: 'c', start: { dateTime: '2026-03-05T22:00:00-05:00' }, end: { dateTime: '2026-03-06T01:00:00-05:00' } });
    const toMidnight = days({ id: 'd', start: { dateTime: '2026-03-05T22:00:00-05:00' }, end: { dateTime: '2026-03-06T00:00:00-05:00' } });
    // across the US DST change on 2026-03-08 (clocks jump forward)
    const dst = days({ id: 'e', start: { dateTime: '2026-03-07T23:30:00-05:00' }, end: { dateTime: '2026-03-08T03:30:00-04:00' } });
    const cancelled = G.normalize({ id: 'x', status: 'cancelled', start: { date: '2026-03-05' }, end: { date: '2026-03-06' } }, 'c1');
    G._test.setSettings({ connected: true, calendars: [{ id: 'c1', summary: 'Mine', color: '#ff0000', selected: true }, { id: 'c2', summary: 'Shared', color: '#00ff00', selected: true }, { id: 'c3', summary: 'Hidden', selected: false }] });
    const ev = (cal, id, uid) => ({ ...G.normalize({ id, iCalUID: uid, summary: 'Team sync', start: { dateTime: '2026-03-10T09:00:00-04:00' }, end: { dateTime: '2026-03-10T10:00:00-04:00' } }, cal), calId: cal });
    const a = ev('c1', 'e1', 'uid-1'), b = ev('c2', 'e2', 'uid-1'), c = ev('c3', 'e3', 'uid-3');
    G._test.setCache({ events: { [a.key]: a, [b.key]: b, [c.key]: c } });
    const items = G.itemsBetween('2026-03-01', '2026-03-31');
    return { allDay, multi, overnight, toMidnight, dst, cancelled, items: items.map(i => [i.title, i.date, i.time, i.calendar]) };
  });
  eq(r.allDay, ['2026-03-05'], 'all-day end is exclusive');
  eq(r.multi, ['2026-03-05', '2026-03-06', '2026-03-07'], 'multi-day all-day');
  eq(r.overnight, ['2026-03-05', '2026-03-06'], 'overnight timed event');
  eq(r.toMidnight, ['2026-03-05'], 'ends at midnight stays on one day');
  eq(r.dst, ['2026-03-07', '2026-03-08'], 'DST-spanning event');
  eq(r.cancelled, null, 'cancelled excluded');
  eq(r.items, [['Team sync', '2026-03-10', '09:00', 'Mine']], 'deduped across calendars, unselected hidden');
}, { timezoneId: 'America/New_York' });

/* ======================= Quiz & play ======================= */
test('split session: gate unlocks after 3 correct, game playable immediately, no remount', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await page.evaluate(() => { const d = SS.play.data('2048'); d.game = { id: 'g1', n: 4, goal: 2048, board: [2, 2, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0, moves: 0, won: false, winCounted: false, over: false }; SS.play.setGame('2048'); SS.play.save(); });
  await startWrittenQuiz(page, setId, 6);
  await page.evaluate(() => { document.querySelector('.gp .ag-game').dataset.marker = 'same'; });
  assert(await page.isDisabled('.ag-direction-pad button >> nth=0'), 'controls disabled with no moves');
  await answer(page, true); await nextQuestion(page);
  await answer(page, false);
  // double-click Check on an answered question must not count again
  await page.evaluate(() => { const b = [...document.querySelectorAll('.qz-qfoot button')].find(x => /Check/.test(x.textContent)); b && b.click(); });
  await nextQuestion(page);
  await answer(page, true);
  eq((await play(page)).actions['2048'], 0, 'two correct answers: still locked');
  assert(/2 of 3 correct/.test(await page.textContent('.qz-meter')), 'inline progress shows 2 of 3');
  await nextQuestion(page);
  await answer(page, true);
  eq((await play(page)).actions['2048'], 3, 'third correct answer grants 3 moves');
  assert(/3 moves available/.test(await page.textContent('.gp-moves')), 'panel shows 3 moves');
  assert(!(await page.isDisabled('.ag-direction-pad button >> nth=0')), 'controls enabled immediately');
  eq(await page.evaluate(() => document.querySelector('.gp .ag-game').dataset.marker), 'same', 'game was not remounted');
  // feedback for the checked question is still on screen
  assert(await page.isVisible('.qz-feedback.qz-correct'), 'feedback stays');
  // arrow keys typed in the quiz don't reach the game
  await nextQuestion(page);
  await page.focus('.qz-written');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
  eq((await play(page)).actions['2048'], 3, 'keys in the answer box cost nothing');
  // a no-op slide costs nothing, a real slide costs one
  await page.focus('.ag-2048-board');
  await page.keyboard.press('ArrowUp');           // [2,2,..] top row, [4] below: up changes nothing? (2 is above 4 → no change)
  const afterNoop = (await play(page)).actions['2048'];
  await page.keyboard.press('ArrowLeft');
  const afterMove = (await play(page)).actions['2048'];
  eq(afterNoop, 3, 'no-op slide free'); eq(afterMove, 2, 'real slide uses one move');
  eq(await page.evaluate(() => SS.play.data('2048').game.board[0]), 4, 'tiles merged');
}, { viewport: { width: 1440, height: 900 } });

test('session and board survive reload; checked feedback restored', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await page.evaluate(() => SS.play.setGame('blocks'));
  await startWrittenQuiz(page, setId, 4);
  await answer(page, true);
  const q = await currentQuestion(page);
  await flush(page);
  await boot(page);
  await page.waitForSelector('.qz-feedback.qz-correct');
  eq((await currentQuestion(page)).prompt, q.prompt, 'same question after reload');
  eq(await page.inputValue('.qz-written'), q.expected, 'answer text kept');
  assert(await page.isVisible('.qz-qfoot button:has-text("Next question")'), 'next button shown for a checked question');
  eq(await page.inputValue('.gp-select'), 'blocks', 'game selection kept');
});

test('keyboard isolation: keys in the quiz never pick up or place a Block Puzzle piece', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await page.evaluate(() => { SS.play.setGame('blocks'); SS.play.state.actions.blocks = 3; SS.play.save(); });
  await startWrittenQuiz(page, setId, 4);
  await page.focus('.qz-qfoot button:has-text("Check answer")');
  await page.keyboard.press('1');
  await page.keyboard.press('Space');
  eq((await play(page)).actions.blocks, 3, 'Space on Check answer did not reach the game');
  eq(await page.$$eval('.ag-bb-cell.ghost', n => n.length), 0, '“1” in the quiz did not pick up a piece');
  await page.focus('.ag-bb-board');
  await page.keyboard.press('1');
  assert(await page.$$eval('.ag-bb-cell.ghost', n => n.length) > 0, '“1” on the board picks up piece 1 and shows where it goes');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  eq((await play(page)).actions.blocks, 3, 'moving a picked-up piece is free');
  await page.keyboard.press('Space');
  eq((await play(page)).actions.blocks, 2, 'Space on the board places it (one move)');
  await page.focus('.gp-select');
  await page.keyboard.press('ArrowDown');
  eq((await play(page)).actions.blocks, 2, 'arrows on the game selector are not game input');
});

test('divider resize, hide/show and narrow switcher keep the game mounted', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await startWrittenQuiz(page, setId, 3);
  await page.evaluate(() => { document.querySelector('.gp .ag-game').dataset.marker = 'keep'; });
  const r0 = await page.evaluate(() => SS.play.state.panel.ratio);
  await page.focus('.qz-divider'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  const r1 = await page.evaluate(() => SS.play.state.panel.ratio);
  assert(r1 > r0, 'divider widened the game panel');
  await page.click('.gp button[aria-label="Hide the game panel"]');
  assert(await page.isHidden('.gp'), 'game hidden');
  assert(await page.isVisible('.qz-show-game'), 'show-game button available');
  await page.click('.qz-show-game');
  eq(await page.evaluate(() => document.querySelector('.gp .ag-game').dataset.marker), 'keep', 'same game instance after hide/show');
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(300);
  assert(await page.isVisible('.qz-switch'), 'switcher on narrow widths');
  await page.click('.qz-switch [data-value="game"]');
  assert(await page.isVisible('.gp') && await page.isHidden('.qz-quiz'), 'game pane shown');
  eq(await page.evaluate(() => document.querySelector('.gp .ag-game').dataset.marker), 'keep', 'not remounted when switching panes');
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  assert(overflow <= 0, `no page-wide horizontal overflow (${overflow}px)`);
});

test('results, missed review and retry; flashcard flips don’t unlock moves', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await page.evaluate(() => SS.play.setGame('chess'));
  await startWrittenQuiz(page, setId, 3);
  await answer(page, true); await nextQuestion(page);
  await answer(page, false); await nextQuestion(page);
  await answer(page, false); await nextQuestion(page);
  await page.waitForSelector('.qz-result');
  assert(/1 of 3 correct/.test(await page.textContent('.qz-result')), 'score');
  eq(await page.$$eval('.qz-review-item.miss', n => n.length), 2, 'two missed listed');
  await page.click('button:has-text("I was right") >> nth=0');
  assert(/2 of 3 correct/.test(await page.textContent('.qz-result')), 'override updates the score');
  eq((await play(page)).progress, 1, 'override does not count toward moves');
  await page.click('button:has-text("Retry 1 missed")');
  await page.waitForSelector('.qz-written');
  eq(await page.evaluate(() => SS.play.state.session.questions.length), 1, 'retry has only the missed question');
  // flashcards
  await page.evaluate(id => SS.cards.study(id), setId);
  await page.waitForSelector('.flashcard');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Space');
  await closeDialogs(page);
  eq((await play(page)).progress, 1, 'flipping cards adds nothing');
});

/* ======================= Set management ======================= */
test('sets: create with reorder, duplicate, delete with undo, guard unsaved edits', async ({ page }) => {
  await page.evaluate(() => SS.quiz.open('sets'));
  await page.click('button:has-text("New set")');
  await page.fill('.qz-editor input[aria-label="Study set title"]', 'Spanish');
  const rows = await page.$$('.qz-row');
  const fill = async (i, t, d) => { const ta = await rows[i].$$('textarea'); await ta[0].fill(t); await ta[1].fill(d); };
  await fill(0, 'uno', 'one'); await fill(1, 'dos', 'two'); await fill(2, 'tres', 'three');
  await (await rows[2].$$('textarea'))[0].focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.click('.qz-editor .dlg-foot button:has-text("Create study set")');
  const set = await page.evaluate(() => SS.data.all('quizzes').find(q => q.title === 'Spanish'));
  eq(set.cards.map(c => c.term), ['uno', 'tres', 'dos'], 'reordered with Alt+↑');
  // unsaved edits are protected
  await page.waitForFunction(() => !document.querySelector('dialog.qz-editor'));
  await page.evaluate(id => SS.quiz.edit(id), set.id);
  await page.fill('dialog.qz-editor:not(.closing) .qz-row textarea >> nth=0', 'changed');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.dlg-confirm');
  assert(/Discard/.test(await page.textContent('dialog.dlg-confirm')), 'discard confirmation shown');
  await page.click('dialog.dlg-confirm button:has-text("Keep editing")');
  assert(await page.isVisible('.qz-editor'), 'editor still open');
  await page.click('.qz-editor .dlg-foot button:has-text("Cancel")');
  await page.click('dialog.dlg-confirm button:has-text("Discard changes")');
  await page.waitForTimeout(300);
  eq(await page.evaluate(id => SS.data.get('quizzes', id).cards[0].term, set.id), 'uno', 'discarded edit not saved');
  // duplicate & delete with undo
  await page.evaluate(() => SS.quiz.open('sets'));
  await page.click('.qz-set:has-text("Spanish") button[aria-label^="More options"]');
  await page.click('.ctx-menu button:has-text("Duplicate")');
  assert(await page.evaluate(() => SS.data.all('quizzes').some(q => q.title === 'Spanish (copy)')), 'duplicated');
  await page.click('.qz-set:has-text("Spanish (copy)") button[aria-label^="More options"]');
  await page.click('.ctx-menu button:has-text("Delete set")');
  await page.click('dialog.dlg-confirm button:has-text("Delete set")');
  await page.waitForTimeout(200);
  assert(!(await page.evaluate(() => SS.data.all('quizzes').some(q => q.title === 'Spanish (copy)'))), 'deleted');
  await page.click('.toast button:has-text("Undo")');
  assert(await page.evaluate(() => SS.data.all('quizzes').some(q => q.title === 'Spanish (copy)')), 'undo restores');
  // search and subject filter
  await page.fill('.qz-search', 'tres');
  await page.waitForTimeout(250);
  eq(await page.$$eval('.qz-set h3', ns => ns.map(n => n.textContent).sort()), ['Spanish', 'Spanish (copy)'], 'search finds sets by card text');
});

test('import: valid Quizlet text adds cards; malformed input adds nothing; export round-trips', async ({ page }) => {
  await page.evaluate(() => SS.quiz.open('sets'));
  await page.click('button:has-text("Import")');
  await page.fill('.qz-editor input[aria-label="Study set title"]', 'Imported');
  await page.fill('.qz-import-area', 'apple\tmanzana\nbread\tpan\ncheese\tqueso');
  await page.waitForTimeout(300);
  assert(/3 cards ready/.test(await page.textContent('.qz-preview')), 'preview counts cards');
  await page.click('button:has-text("Add these cards")');
  await page.click('.qz-editor .dlg-foot button:has-text("Create study set")');
  const set = await page.evaluate(() => SS.data.all('quizzes').find(q => q.title === 'Imported'));
  eq(set.cards.length, 3, 'imported 3 cards');
  // malformed
  await page.click('button:has-text("Import")');
  await page.fill('.qz-editor input[aria-label="Study set title"]', 'Broken');
  await page.fill('.qz-import-area', 'good\tline\n"unclosed\tquote\nno separator here');
  await page.waitForTimeout(300);
  assert(await page.isVisible('.qz-errors'), 'errors listed');
  await page.click('button:has-text("Add these cards")');
  eq(await page.$$eval('.qz-row', rows => rows.filter(r => [...r.querySelectorAll('textarea')].some(t => t.value)).length), 0, 'nothing added from malformed input');
  await page.click('.qz-editor .dlg-foot button:has-text("Cancel")');
  if (await page.$('dialog.dlg-confirm')) await page.click('dialog.dlg-confirm button:has-text("Discard changes")');
  // export TSV and parse it back
  await page.click('.qz-set:has-text("Imported") button[aria-label^="More options"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.ctx-menu button:has-text("Export for Quizlet")')]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  const back = await page.evaluate(t => SS.quiz.parseImport(t).cards, text);
  eq(back, set.cards, 'exported TSV parses back to the same cards');
});

/* ======================= Games ======================= */
test('wins count once: finishing 2048, reload, re-render, new game', async ({ page }) => {
  await page.evaluate(() => { const d = SS.play.data('2048'); d.game = { id: 'w1', n: 4, goal: 2048, board: [1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0, moves: 0, won: false, winCounted: false, over: false }; SS.play.setGame('2048'); SS.play.state.actions['2048'] = 5; SS.play.save(); SS.quiz.open('practice'); });
  await page.waitForSelector('.ag-2048-board');
  await page.focus('.ag-2048-board'); await page.keyboard.press('ArrowLeft');
  eq((await play(page)).wins['2048'], 1, 'win counted');
  await page.keyboard.press('ArrowRight');
  eq((await play(page)).wins['2048'], 1, 'more moves on a won board add nothing');
  await page.selectOption('.gp-select', 'chess'); await page.selectOption('.gp-select', '2048');
  await flush(page); await boot(page);
  eq((await play(page)).wins['2048'], 1, 'still one after re-render and reload');
  await page.evaluate(() => SS.quiz.open('games'));
  assert(/1\s*win/.test(await page.textContent('.qz-game:has-text("2048") .qz-game-wins')), 'wins shown in Games & wins');
});

test('solitaire: legal move costs one, illegal costs none, finishing counts one win', async ({ page }) => {
  await page.evaluate(() => {
    // all cards home except the King of spades (card 12) on the waste
    const f = [0, 1, 2, 3].map(s => Array.from({ length: 13 }, (_, i) => s * 13 + i));
    f[0].pop();
    SS.play.data('solitaire').game = { id: 's1', stock: [], waste: [12], foundations: f, tableau: [[], [], [], [], [], [], []], moves: 0, won: false, winCounted: false, recycled: 0 };
    SS.play.setGame('solitaire'); SS.play.state.actions.solitaire = 2; SS.play.save(); SS.quiz.open('practice');
  });
  await page.waitForSelector('.ag-sol-board');
  await page.click('.ag-sol-upper .ag-face[aria-label^="King of spades"]');
  await page.click('.ag-sol-columns .ag-sol-empty >> nth=0'); // King to an empty column: legal
  eq((await play(page)).actions.solitaire, 1, 'legal move costs one');
  await page.click('.ag-sol-columns .ag-face[aria-label^="King of spades"]');
  await page.click('.ag-sol-upper .ag-face[aria-label^="King of hearts"]');
  eq((await play(page)).actions.solitaire, 1, 'illegal move costs nothing');
  assert(/isn’t legal/.test(await page.textContent('.ag-solitaire .ag-status')), 'illegal move explained; selection kept');
  await page.click('button:has-text("To foundation")');
  const p = await play(page);
  eq(p.wins.solitaire, 1, 'win counted'); eq(p.actions.solitaire, 0, 'final move used');
});

test('chess vs Stockfish: move costs one, bot reply free; reset during search ignores the stale reply', async ({ page }) => {
  await page.evaluate(() => { SS.play.setGame('chess'); SS.play.state.actions.chess = 3; SS.play.data('chess').prefs = { ...(SS.play.data('chess').prefs || {}), difficulty: 'beginner' }; SS.play.save(); SS.quiz.open('practice'); });
  await page.waitForSelector('.ss-chess-square[data-sq="e2"]');
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('.ss-chess-status').textContent), null, { timeout: 25000 });
  await page.click('.ss-chess-square[data-sq="e2"]'); await page.click('.ss-chess-square[data-sq="e4"]');
  await page.waitForFunction(() => (SS.play.data('chess').game.history || []).length === 2, null, { timeout: 20000 });
  eq((await play(page)).actions.chess, 2, 'one move used; bot reply free');
  // illegal destination is free
  await page.click('.ss-chess-square[data-sq="d2"]'); await page.click('.ss-chess-square[data-sq="d5"]');
  eq((await play(page)).actions.chess, 2, 'illegal move free');
  // slow bot, then reset while it thinks
  await page.evaluate(() => SS.play.kit.setPref('chess', 'difficulty', 'expert'));
  await page.click('.ss-chess-square[data-sq="g1"]'); await page.click('.ss-chess-square[data-sq="f3"]');
  await page.waitForFunction(() => /thinking/.test(document.querySelector('.ss-chess-status').textContent));
  await page.click('button:has-text("New game")');
  await page.click('dialog.dlg-confirm button:has-text("New game")');
  await page.waitForTimeout(6500);
  eq(await page.evaluate(() => SS.play.data('chess').game.history), [], 'no stale bot move applied to the new game');
  // leave while the bot thinks, come back: exactly one reply
  await page.evaluate(() => SS.play.kit.setPref('chess', 'difficulty', 'professional'));
  await page.click('.ss-chess-square[data-sq="e2"]'); await page.click('.ss-chess-square[data-sq="e4"]');
  await page.evaluate(() => SS.nav.go('home'));
  await page.waitForTimeout(300);
  await page.evaluate(() => SS.nav.go('quiz'));
  await page.waitForFunction(() => SS.play.data('chess').game.history.length === 2, null, { timeout: 25000 });
  await page.waitForTimeout(2500);
  eq(await page.evaluate(() => SS.play.data('chess').game.history.length), 2, 'exactly one bot reply after navigation');
}, { timeout: 90000 });

test('block puzzle: dragging outlines where the piece lands (red when it won’t fit); only a placed piece costs a move', async ({ page }) => {
  await page.evaluate(() => {
    const board = Array(64).fill(0); board[5 * 8 + 5] = 4;
    SS.play.data('blocks').game = { id: 'bd1', board, tray: [{ shape: 'i3-0', color: 1 }, { shape: 'dot-0', color: 2 }, { shape: 'o2-0', color: 3 }], score: 0, lines: 0, streak: 0, moves: 0, won: false, winCounted: false, over: false, goal: 3000 };
    SS.play.setGame('blocks'); SS.play.state.actions.blocks = 2; SS.play.save(); SS.quiz.open('practice');
  });
  await page.waitForSelector('.ag-bb-piece[data-slot="2"]');
  await page.waitForTimeout(600);   // let the tray's entrance animation finish
  // pointer position that holds a 2 × 2 piece over the squares starting at (r, c)
  const over = (r, c) => page.evaluate(([r, c]) => { const cells = document.querySelectorAll('.ag-bb-cell'); const a = cells[r * 8 + c].getBoundingClientRect(), b = cells[(r + 1) * 8 + c + 1].getBoundingClientRect(); return { x: (a.left + b.right) / 2, y: (a.top + b.bottom) / 2 }; }, [r, c]);
  const ghosts = () => page.evaluate(() => ({ cells: [...document.querySelectorAll('.ag-bb-cell')].map((n, i) => n.classList.contains('ghost') ? i : -1).filter(i => i >= 0), bad: document.querySelectorAll('.ag-bb-cell.ghost.bad').length, float: !!document.querySelector('.ag-bb-float') }));
  const grab = async () => { const box = await (await page.$('.ag-bb-piece[data-slot="2"]')).boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); };
  await grab();
  const blocked = await over(4, 4);
  await page.mouse.move(blocked.x, blocked.y, { steps: 10 });
  eq(await ghosts(), { cells: [36, 37, 44, 45], bad: 4, float: true }, 'red outline over a spot where it doesn’t fit');
  await page.screenshot({ path: path.join(OUT, 'blocks-drag-bad.png') });
  await page.mouse.up(); await page.waitForTimeout(350);
  eq((await play(page)).actions.blocks, 2, 'a drop that doesn’t fit is free');
  eq(await page.evaluate(() => SS.play.data('blocks').game.tray[2].shape), 'o2-0', 'the piece went back to the tray');
  eq((await ghosts()).float, false, 'nothing left floating');
  await grab();
  const free = await over(1, 2);
  await page.mouse.move(free.x, free.y, { steps: 10 });
  eq(await ghosts(), { cells: [10, 11, 18, 19], bad: 0, float: true }, 'outline exactly where the piece will land');
  await page.screenshot({ path: path.join(OUT, 'blocks-drag-ok.png') });
  await page.mouse.up(); await page.waitForTimeout(100);
  const g = await page.evaluate(() => SS.play.data('blocks').game);
  eq((await play(page)).actions.blocks, 1, 'placing uses one move');
  eq([g.board[10], g.board[11], g.board[18], g.board[19], g.tray[2], g.score], [3, 3, 3, 3, null, 40], 'placed where the outline showed');
});

test('block puzzle: keys pick and place, a full row clears, reaching the target counts one win', async ({ page }) => {
  await page.evaluate(() => {
    const board = Array(64).fill(0); for (let c = 2; c < 8; c++) board[c] = 5;
    SS.play.data('blocks').game = { id: 'bd2', board, tray: [{ shape: 'i2-0', color: 1 }, { shape: 'dot-0', color: 2 }, { shape: 'dot-0', color: 3 }], score: 2900, lines: 0, streak: 0, moves: 0, won: false, winCounted: false, over: false, goal: 3000 };
    SS.play.setGame('blocks'); SS.play.state.actions.blocks = 3; SS.play.save(); SS.quiz.open('practice');
  });
  await page.waitForSelector('.ag-bb-board .ag-bb-cell');
  await frames(page);
  await page.focus('.ag-bb-board');
  await page.keyboard.press('1');
  eq(await page.evaluate(() => [document.querySelectorAll('.ag-bb-cell.ghost').length, document.querySelectorAll('.ag-bb-cell.hint').length]), [2, 6], 'outline plus the row it would clear');
  await page.keyboard.press('Enter');
  const p = await play(page);
  eq(p.actions.blocks, 2, 'placing costs one'); eq(p.wins.blocks, 1, 'score target reached → one win');
  const g = await page.evaluate(() => SS.play.data('blocks').game);
  eq([g.board.slice(0, 8).every(v => !v), g.lines, g.score, g.won], [true, 1, 3020, true], 'row cleared and scored');
  await page.keyboard.press('2'); await page.keyboard.press('Enter');
  eq((await play(page)).wins.blocks, 1, 'further pieces add no wins');
  await flush(page); await boot(page);
  eq((await play(page)).wins.blocks, 1, 'still one after reload');
});

test('chess levels: nine levels from Starter to Grandmaster; Starter searches one ply deep', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const sent = [];
    const W = window.Worker;
    window.Worker = class { constructor() { setTimeout(() => this.onmessage({ data: 'uciok' }), 5); } postMessage(m) { sent.push(m); if (m === 'isready') setTimeout(() => this.onmessage({ data: 'readyok' }), 5); if (/^go /.test(m)) setTimeout(() => this.onmessage({ data: 'bestmove e7e5' }), 5); } terminate() {} };
    try {
      const e = SS.chessTest.createEngine(() => {}); e.start();
      await new Promise(r => setTimeout(r, 40));
      const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
      const a = await e.search(fen, SS.chessTest.LEVELS.starter);
      const b = await e.search(fen, SS.chessTest.LEVELS.grandmaster);
      e.destroy();
      return { a, b, go: sent.filter(m => /^go /.test(m)), levels: Object.keys(SS.chessTest.LEVELS), bad: SS.chessTest.sanitize({ prefs: { difficulty: 'nope', contrast: 'weird' } }).prefs, keep: SS.chessTest.sanitize({ prefs: { difficulty: 'club', contrast: 'high' } }).prefs };
    } finally { window.Worker = W; }
  });
  eq(r.levels, ['starter', 'beginner', 'casual', 'intermediate', 'club', 'professional', 'master', 'expert', 'grandmaster'], 'levels in order');
  eq(r.go, ['go depth 1', 'go movetime 9000'], 'Starter is depth-limited; Grandmaster thinks longest');
  eq([r.a, r.b], ['e7e5', 'e7e5'], 'replies returned');
  eq([r.bad.difficulty, r.bad.contrast, r.keep.difficulty, r.keep.contrast], ['intermediate', 'clear', 'club', 'high'], 'level and contrast sanitized');
  // the level picker on the board changes the saved difficulty
  await page.evaluate(() => { SS.play.setGame('chess'); SS.quiz.open('practice'); });
  await page.waitForSelector('.ss-chess-level');
  await page.selectOption('.ss-chess-level', 'master');
  eq(await page.evaluate(() => SS.play.data('chess').prefs.difficulty), 'master', 'quick level picker saves the level');
});

test('every built-in theme renders Home and Quiz without console errors', async ({ page }) => {
  const ids = await page.evaluate(() => SS.ws.all().map(w => w.id));
  for (const id of ids) {
    await page.evaluate(i => { SS.ws.switchTo(i, { instant: true }); SS.nav.go('home'); }, id);
    await page.waitForTimeout(250);
    await page.evaluate(() => SS.nav.go('quiz'));
    await page.waitForTimeout(150);
  }
  assert(ids.length >= 11, 'all built-in themes present');
});

test('chess without Stockfish (worker blocked): the built-in bot replies, retry is offered', async ({ browser }) => {
  const { page, context, errors } = await open(browser, { before: (p, ctx) => ctx.route('**/vendor/stockfish-19-lite-single.js', r => r.fulfill({ status: 404, body: '' })) });
  try {
    await page.evaluate(() => { SS.play.setGame('chess'); SS.play.state.actions.chess = 2; SS.play.save(); SS.quiz.open('practice'); });
    await page.waitForSelector('.ss-chess-square[data-sq="e2"]');
    await page.waitForFunction(() => /simple built-in bot/.test(document.querySelector('.ss-chess-status').textContent), null, { timeout: 25000 });
    assert(await page.isVisible('button:has-text("Retry Stockfish")'), 'retry offered');
    await page.click('.ss-chess-square[data-sq="d2"]'); await page.click('.ss-chess-square[data-sq="d4"]');
    await page.waitForFunction(() => SS.play.data('chess').game.history.length === 2, null, { timeout: 10000 });
    eq((await play(page)).actions.chess, 1, 'one move used, fallback reply free');
    assert(!errors.filter(e => !/stockfish|404/i.test(e)).length, 'no unexpected errors: ' + errors.join('; '));
  } finally { await context.close(); }
}, { own: true, timeout: 60000 });

test('cleanup: repeated navigation and game switching leave no extra listeners or workers', async ({ browser }) => {
  const { page, context } = await open(browser, { before: p => p.addInitScript(() => {
    const W = window.Worker; window.__workers = { made: 0, ended: 0 };
    window.Worker = class extends W { constructor(...a) { super(...a); window.__workers.made++; } terminate() { window.__workers.ended++; return super.terminate(); } };
  }) });
  try {
    await page.evaluate(() => { SS.play.setGame('chess'); SS.quiz.open('practice'); });
    await page.waitForSelector('.ss-chess-square');
    await page.evaluate(() => SS.nav.go('home')); await page.waitForTimeout(200);
    const base = await page.evaluate(() => SS.bus.size());
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => SS.quiz.open('practice')); await page.waitForSelector('.gp .ag-game');
      for (const g of ['solitaire', '2048', 'blocks', 'chess']) await page.selectOption('.gp-select', g);
      await page.evaluate(() => SS.quiz.open('games', { game: 'blocks' })); await page.waitForTimeout(80);
      await page.evaluate(() => SS.nav.go('home')); await page.waitForTimeout(80);
    }
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ bus: SS.bus.size(), w: window.__workers, games: document.querySelectorAll('.ag-game').length }));
    eq(after.bus, base, 'event subscriptions back to the baseline');
    eq(after.games, 0, 'no game left mounted off-screen');
    eq(after.w.made - after.w.ended, 0, `every Stockfish worker terminated (${after.w.made} started)`);
  } finally { await context.close(); }
}, { own: true, timeout: 90000 });

test('chess: checkmating the bot counts one win, once (also after reload)', async ({ page }) => {
  await page.evaluate(() => { const d = SS.play.data('chess'); d.game = { id: 'm1', history: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'], won: false, winCounted: false }; SS.play.setGame('chess'); SS.play.state.actions.chess = 2; SS.play.save(); SS.quiz.open('practice'); });
  await page.waitForSelector('.ss-chess-square[data-sq="h5"] .ss-chess-piece');
  await page.click('.ss-chess-square[data-sq="h5"]'); await page.click('.ss-chess-square[data-sq="f7"]');
  await page.waitForFunction(() => /you win/.test(document.querySelector('.ss-chess-status').textContent));
  eq((await play(page)).wins.chess, 1, 'checkmate counted');
  eq(await page.evaluate(() => SS.play.data('chess').game.history.slice(-1)[0]), 'Qxf7#', 'mate recorded');
  await flush(page); await boot(page);
  await page.evaluate(() => SS.quiz.open('practice'));
  await page.waitForFunction(() => /you win/.test((document.querySelector('.ss-chess-status') || {}).textContent || ''));
  eq((await play(page)).wins.chess, 1, 'restoring the finished board adds nothing');
  eq((await play(page)).actions.chess, 1, 'only the mating move was spent');
}, { timeout: 60000 });

test('chess: inline promotion picker, saved position restored after reload', async ({ page }) => {
  await page.evaluate(() => { const d = SS.play.data('chess'); d.game = { id: 'p1', history: ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6'], won: false, winCounted: false }; SS.play.setGame('chess'); SS.play.state.actions.chess = 2; SS.play.save(); SS.quiz.open('practice'); });
  await page.waitForSelector('.ss-chess-square[data-sq="b7"] .ss-chess-piece.white');
  await page.click('.ss-chess-square[data-sq="b7"]'); await page.click('.ss-chess-square[data-sq="b8"]');
  await page.waitForSelector('.ss-chess-promo:not([hidden])');
  eq(await page.$$eval('.ss-chess-promo button', ns => ns.map(n => n.textContent.trim())), ['♕Queen', '♖Rook', '♗Bishop', '♘Knight', 'Cancel'], 'all four choices offered');
  await page.click('.ss-chess-promo button:has-text("Knight")');
  const h = await page.evaluate(() => SS.play.data('chess').game.history);
  eq(h[8], 'b8=N', 'promoted to a knight');
  eq((await play(page)).actions.chess, 1, 'promotion cost one move');
  await flush(page); await boot(page);
  await page.evaluate(() => SS.quiz.open('practice'));
  await page.waitForSelector('.ss-chess-square[data-sq="b8"] .ss-chess-piece');
  eq(await page.textContent('.ss-chess-square[data-sq="b8"] .ss-chess-piece'), '♘', 'restored position');
}, { timeout: 60000 });

test('game customization: settings apply to preview and docked game, persist', async ({ page }) => {
  await page.evaluate(() => SS.quiz.open('games', { game: '2048' }));
  await page.waitForSelector('.qz-game.open .qz-preview-box .ag-2048-board');
  await page.locator('.qz-game.open input[aria-label="2048 board colour"]').evaluate((i) => { i.value = '#123456'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  eq(await page.evaluate(() => getComputedStyle(document.querySelector('.qz-preview-box .ag-2048-board')).backgroundColor), 'rgb(18, 52, 86)', 'preview updated');
  await flush(page); await boot(page);
  eq(await page.evaluate(() => SS.play.data('2048').prefs.boardColor), '#123456', 'saved');
  await page.evaluate(() => { SS.play.setGame('2048'); SS.quiz.open('practice'); });
  await page.waitForSelector('.gp .ag-2048-board');
  eq(await page.evaluate(() => getComputedStyle(document.querySelector('.gp .ag-2048-board')).backgroundColor), 'rgb(18, 52, 86)', 'docked game uses it');
});

/* ======================= Tabs & sidebar ======================= */
test('custom tabs: start empty, independent layouts, reorder, rename, delete+undo, persist', async ({ page }) => {
  const homeCount = await page.evaluate(() => SS.ws.active().widgets.length);
  await page.click('.nav-add');
  await page.fill('dialog input[aria-label="Tab name"]', 'Exam week');
  await page.click('dialog button:has-text("Create tab")');
  await page.waitForSelector('.dash-empty');
  assert(/empty/.test(await page.textContent('.dash-empty h2')), 'new tab starts empty');
  assert(await page.isVisible('.dash-empty button:has-text("Add a widget")'), 'obvious Add widget');
  await page.evaluate(() => SS.dash.add('timer', { quiet: true }));
  const tab1 = await page.evaluate(() => SS.ws.view());
  await page.click('.nav-add');
  await page.fill('dialog input[aria-label="Tab name"]', 'Reading');
  await page.click('dialog .nav-icon-pick[data-icon="book"]');
  await page.click('dialog button:has-text("Create tab")');
  await page.waitForSelector('.dash-empty');
  await page.evaluate(() => { SS.dash.add('note', { quiet: true }); SS.dash.add('todo', { quiet: true }); });
  const tab2 = await page.evaluate(() => SS.ws.view());
  const tab1Pos = await page.evaluate(id => JSON.stringify(SS.ws.page(id).widgets[0].pos), tab1);
  await page.evaluate(() => { const w = SS.ws.surface().widgets[0]; SS.dash.setSize(w.id, 'xl'); });
  await page.click(`.nav-row[data-id="${tab1}"] .nav-item`);
  await frames(page);
  eq(await page.$$eval('.widget', ns => ns.map(n => n.dataset.type)), ['timer'], 'tab 1 keeps only its widget');
  eq(await page.evaluate(id => JSON.stringify(SS.ws.page(id).widgets[0].pos), tab1), tab1Pos, 'tab 1 layout unaffected by tab 2 resize');
  await page.click('.nav-row[data-id="home"] .nav-item');
  await frames(page);
  eq(await page.evaluate(() => SS.ws.active().widgets.length), homeCount, 'home layout unchanged');
  // keyboard reorder and rename
  await page.focus(`.nav-row[data-id="${tab2}"] .nav-item`);
  await page.keyboard.press('Alt+ArrowUp');
  const order = await page.evaluate(() => SS.ws.state.order);
  assert(order.indexOf(tab2) < order.indexOf(tab1), 'Alt+↑ moved the tab up');
  await page.click(`.nav-row[data-id="${tab1}"] .nav-more`);
  await page.click('.ctx-menu button:has-text("Rename")');
  await page.fill('dialog:not(.closing) input[aria-label="Rename tab"]', 'Finals');
  await page.keyboard.press('Enter');
  await page.waitForFunction(id => SS.ws.page(id).name === 'Finals', tab1, { timeout: 3000 }).catch(() => {});
  eq(await page.evaluate(id => SS.ws.page(id).name, tab1), 'Finals', 'renamed');
  // width & collapse
  await page.focus('.nav-resize'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const width = await page.evaluate(() => SS.prefs.get('sidebar').width);
  assert(width > 248, 'sidebar wider');
  await page.click('.nav-collapse');
  assert(await page.evaluate(() => document.body.classList.contains('nav-collapsed')), 'collapsed');
  // delete with confirmation, shared content kept, undo
  const notes = await page.evaluate(() => SS.data.all('notes').length);
  await page.click('.nav-collapse');
  await page.click(`.nav-row[data-id="${tab2}"] .nav-more`);
  await page.click('.ctx-menu button:has-text("Delete tab")');
  await page.click('dialog.dlg-confirm button:has-text("Delete tab")');
  await page.waitForFunction(id => !SS.ws.page(id), tab2, { timeout: 3000 }).catch(() => {});
  assert(!(await page.evaluate(id => !!SS.ws.page(id), tab2)), 'tab deleted');
  eq(await page.evaluate(() => SS.data.all('notes').length), notes, 'shared notes kept');
  await page.click('.toast button:has-text("Undo")');
  assert(await page.evaluate(id => !!SS.ws.page(id), tab2), 'undo restores the tab');
  // Quiz can't be deleted
  await page.click('.nav-row[data-id="quiz"] .nav-more');
  assert(await page.isVisible('.ctx-menu button:has-text("can’t be deleted")'), 'Quiz protected');
  await page.keyboard.press('Escape');
  await page.click(`.nav-row[data-id="${tab1}"] .nav-item`);
  await flush(page); await boot(page);
  eq(await page.evaluate(() => SS.ws.view()), tab1, 'active tab restored');
  eq(await page.evaluate(() => SS.ws.state.order), order, 'order restored');
  eq(await page.evaluate(() => SS.prefs.get('sidebar').width), width, 'width restored');
  eq(await page.$$eval('.widget', ns => ns.map(n => n.dataset.type)), ['timer'], 'tab layout restored');
});

test('sidebar: drag a tab to reorder it with the mouse', async ({ page }) => {
  const id = await page.evaluate(() => SS.ws.createPage({ name: 'Dragged' }).id);
  const from = await page.locator(`.nav-row[data-id="${id}"] .nav-item`).boundingBox();
  const to = await page.locator('.nav-row[data-id="home"] .nav-item').boundingBox();
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y - 10, { steps: 4 });
  await page.mouse.move(to.x + 40, to.y + 4, { steps: 6 });
  await page.mouse.up();
  eq(await page.evaluate(() => SS.ws.state.order[0]), id, 'dragged tab is now first');
  eq(await page.evaluate(() => SS.ws.view()), 'home', 'dragging did not also open the tab');
});

test('keyboard focus is visible on sidebar, quiz answers, divider and board', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await page.evaluate(id => SS.quiz.practice(id), setId);
  await page.waitForSelector('.qz-quiz select');
  await page.click('.qz-quiz button:has-text("Start quiz")');
  await page.waitForSelector('.qz-question');
  const outlineOf = sel => page.evaluate(s => { const n = document.querySelector(s); n.focus(); const cs = getComputedStyle(n); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 || cs.boxShadow !== 'none'; }, sel);
  await page.keyboard.press('Tab'); // switch the page into keyboard modality for :focus-visible
  for (const sel of ['.nav-row[data-id="quiz"] .nav-item', '.qz-divider', '.qz-tab.on', '.gp-select']) assert(await outlineOf(sel), `visible focus on ${sel}`);
  if (await page.$('.qz-option')) assert(await outlineOf('.qz-option'), 'visible focus on an answer option');
  await page.selectOption('.gp-select', 'chess');
  await page.waitForSelector('.ss-chess-square[data-sq="e2"]');
  assert(await outlineOf('.ss-chess-square[tabindex="0"]'), 'visible focus on a chess square');
});

/* ======================= Migration & backup ======================= */
async function seedOldVersion(page) {
  await page.goto(`${BASE}/vendor/CHESS-LICENSE.txt`);
  await page.evaluate(async () => {
    localStorage.setItem('studyspace-play-v1', JSON.stringify({ version: 1, credits: { chess: 4, solitaire: 1, '2048': 0, tetris: 2 }, wins: { chess: 2, solitaire: 0, '2048': 1, tetris: 1 }, progress: { chess: 1, solitaire: 0, '2048': 0, tetris: 0 }, settings: { threshold: 3, turns: 3, autoOpen: true }, quizOptions: { rewardGame: 'chess' }, profile: { name: 'Old', bio: 'from v1', points: 777, owned: ['aurora', 'simple', 'tide'], banner: 'tide', width: 300, collapsed: false }, gameData: { chess: { history: ['e4', 'e5', 'Nf3'], difficulty: 'beginner', preset: 'forest', won: false } } }));
    localStorage.setItem('studyspace-play-widgets-ws_old', '1');
    const db = await new Promise((ok, fail) => { const r = indexedDB.open('studyspace', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('images', { keyPath: 'id' }); }; r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
    const put = (k, v) => new Promise(ok => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; });
    const w = (type, x, y, wd, h) => ({ id: 'w_' + type, type, title: '', pos: { lg: { x, y, w: wd, h } }, config: {}, style: {} });
    await put('meta', { version: 2, createdAt: Date.now(), presetsSeen: ['study-play', 'ocean', 'minimal', 'midnight', 'academia', 'forest', 'sakura', 'pastel', 'mono', 'ios', 'focus'] });
    await put('workspaces', { version: 1, activeId: 'ws_old', list: [{ id: 'ws_old', name: 'My desk', icon: '✦', presetId: 'study-play', appearance: {}, layout: { mode: 'grid' }, widgets: [w('quiz-plus', 0, 0, 8, 7), w('trophies', 0, 7, 6, 4), w('game-chess', 6, 7, 3, 4), w('timer', 8, 0, 4, 7)] }] });
    await put('c:quizzes', [{ id: 'q_old', title: 'Old deck', cards: [{ term: 'a', def: 'b' }] }]);
    await put('prefs', { onboarded: true, name: 'Old' });
    db.close();
  });
}
test('migration: old save keeps decks, layouts, boards, wins; removed rewards stay gone', async ({ browser }) => {
  const { page, context, errors } = await open(browser, { load: false });
  try {
  await seedOldVersion(page);
  await boot(page);
  const r = await page.evaluate(() => ({ p: SS.play.state, types: SS.ws.active().widgets.map(w => w.type), decks: SS.data.all('quizzes').map(q => q.title), legacy: localStorage.getItem('studyspace-play-v1'), flag: localStorage.getItem('studyspace-play-widgets-ws_old'), nav: [...document.querySelectorAll('.nav-row')].map(n => n.dataset.id), width: SS.prefs.get('sidebar').width, reg: ['trophies', 'game-chess', 'quiz-plus'].map(t => SS.registry.has(t)) }));
  eq(r.p.actions, { chess: 4, solitaire: 1, '2048': 0, blocks: 2 }, 'unused moves preserved (Tetris → Block Puzzle)');
  eq(r.p.wins, { chess: 2, solitaire: 0, '2048': 1, blocks: 0 }, 'wins preserved');
  eq(r.p.legacy, { tetris: { wins: 1, moves: 0 } }, 'Tetris win kept on record');
  eq(r.p.gameData.chess.game.history, ['e4', 'e5', 'Nf3'], 'board preserved');
  eq(r.p.profile.banner, 'tide', 'chosen cosmetic kept');
  eq(r.types.sort(), ['flashcards', 'timer'], 'quiz lab → flashcards; trophies and arcade tiles removed');
  eq(r.decks, ['Old deck'], 'decks preserved');
  eq(r.legacy, null, 'old localStorage record removed after migration');
  eq(r.flag, null, 'old widget-injection flag removed');
  eq(r.reg, [false, false, false], 'removed widget types are not registered');
  eq(r.width, 300, 'sidebar width carried over');
  const text = await page.evaluate(() => document.body.innerText);
  assert(!/Reward shop|Trophy cabinet|Study arcade|study points/i.test(text), 'no reward UI text');
  // idempotent: reload doesn't change anything
  await flush(page); await boot(page);
  eq(await page.evaluate(() => SS.play.state.wins), r.p.wins, 'wins unchanged after second start');
  eq(await page.evaluate(() => SS.ws.active().widgets.map(w => w.type).sort()), ['flashcards', 'timer'], 'layout unchanged after second start');
  assert(!errors.length, 'no console errors: ' + errors.join('; '));
  } finally { await context.close(); }
}, { own: true });

test('backup: round trip restores tabs, boards, wins; old backups import without rewards or duplicates', async ({ page, browser }) => {
  await page.evaluate(() => {
    const t = SS.ws.createPage({ name: 'Backup tab', icon: 'star' }); t.widgets.push(SS.registry.newInstance('timer')); SS.ws.save();
    SS.play.state.wins.blocks = 3; SS.play.state.legacy = { tetris: { wins: 4, moves: 10 } }; SS.play.state.actions.chess = 6; SS.play.data('chess').game = { id: 'b1', history: ['d4', 'd5'], won: false, winCounted: false }; SS.play.save();
  });
  await flush(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => SS.panels.exportBackup(true))]);
  const file = path.join(OUT, 'backup.json'); await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(json.version, 3, 'backup version'); assert(json.play && json.workspaces.pages.some(p => p.name === 'Backup tab'), 'play state and tabs included');
  assert(!('arcade' in json) && !JSON.stringify(json).includes('access_token'), 'no reward record or tokens');
  // restore into a fresh profile
  const fresh = await open(browser);
  try {
    const p2 = fresh.page;
    const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.evaluate(() => SS.panels.importBackup())]);
    await chooser.setFiles(file);
    await p2.click('dialog button:has-text("Replace everything")');
    await p2.click('dialog.dlg-confirm button:has-text("Replace")');
    // (fresh installs also have a Planner tab, so wait for the restored one by name)
    await p2.waitForFunction(() => SS.ws.pages().some(p => p.name === 'Backup tab') && SS.play.state.legacy.tetris);
    const pagesAfterRestore = await p2.evaluate(() => SS.ws.pages().length);
    const r = await p2.evaluate(() => { const t = SS.ws.pages().find(p => p.name === 'Backup tab'); return { wins: SS.play.state.wins.blocks, tetris: SS.play.state.legacy.tetris.wins, actions: SS.play.state.actions.chess, hist: SS.play.data('chess').game.history, tab: t.name, widgets: t.widgets.length }; });
    eq(r, { wins: 3, tetris: 4, actions: 6, hist: ['d4', 'd5'], tab: 'Backup tab', widgets: 1 }, 'restored');
    // merging the same backup again doesn't duplicate tabs/themes or add wins
    const themes = await p2.evaluate(() => SS.ws.all().length);
    const [chooser2] = await Promise.all([p2.waitForEvent('filechooser'), p2.evaluate(() => SS.panels.importBackup())]);
    await chooser2.setFiles(file);
    await p2.click('dialog button:has-text("Merge")');
    await p2.waitForTimeout(500);
    eq(await p2.evaluate(() => [SS.ws.all().length, SS.ws.pages().length, SS.play.state.wins.blocks, SS.play.state.legacy.tetris.wins]), [themes, pagesAfterRestore, 3, 4], 'merge is idempotent');
    // an old (version 2) backup with the reward record
    const old = { app: 'studyspace', version: 2, exportedAt: new Date().toISOString(), content: { quizzes: [{ id: 'oldq', title: 'From v2', cards: [{ term: 'x', def: 'y' }] }] }, workspaces: { version: 1, list: [{ id: 'ws_v2', name: 'V2 desk', appearance: {}, widgets: [{ id: 'w1', type: 'trophies', pos: { lg: { x: 0, y: 0, w: 4, h: 4 } } }, { id: 'w2', type: 'quiz-plus', pos: { lg: { x: 4, y: 0, w: 6, h: 5 } } }] }], activeId: 'ws_v2' }, prefs: {}, arcade: { version: 1, credits: { chess: 1 }, wins: { tetris: 9 }, profile: { points: 5000, owned: ['tide'] } } };
    const oldFile = path.join(OUT, 'old-backup.json'); fs.writeFileSync(oldFile, JSON.stringify(old));
    const [chooser3] = await Promise.all([p2.waitForEvent('filechooser'), p2.evaluate(() => SS.panels.importBackup())]);
    await chooser3.setFiles(oldFile);
    await p2.click('dialog button:has-text("Merge")');
    await p2.waitForTimeout(500);
    const r3 = await p2.evaluate(() => ({ types: SS.ws.all().find(w => w.name.startsWith('V2 desk')).widgets.map(w => w.type), wins: SS.play.state.legacy.tetris.wins, keys: Object.keys(SS.play.state.profile), set: SS.data.all('quizzes').some(q => q.title === 'From v2') }));
    eq(r3.types, ['flashcards'], 'old reward widgets not resurrected');
    eq(r3.wins, 9, 'merge keeps the higher Tetris win count (not 13)');
    assert(!r3.keys.includes('points') && r3.set, 'no points; content merged');
  } finally { await fresh.context.close(); }
});

/* ======================= Google Calendar (fixtures) ======================= */
const FAKE_GSI = `window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { window.__gsiCfg = cfg; return { requestAccessToken(o) { window.__gsiReq = (window.__gsiReq || 0) + 1; setTimeout(() => { if (window.__gsiMode === 'deny') cfg.callback({ error: 'access_denied' }); else if (window.__gsiMode === 'closed') cfg.error_callback({ type: 'popup_closed' }); else cfg.callback({ access_token: 'fake-token-123', expires_in: 3599, scope: cfg.scope }); }, 20); } }; },
  hasGrantedAllScopes(resp, ...scopes) { return scopes.every(s => (resp.scope || '').split(' ').includes(s)); },
  revoke(t, cb) { window.__revoked = t; cb && cb(); } } } };`;
async function routeGoogle(context, state) {
  await context.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GSI }));
  await context.route('https://www.googleapis.com/calendar/v3/**', async r => {
    const url = new URL(r.request().url());
    state.calls.push(url.pathname + url.search);
    if (r.request().headers().authorization !== 'Bearer fake-token-123') return r.fulfill({ status: 401, body: '{}' });
    if (state.fail401) return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { status: 'UNAUTHENTICATED' } }) });
    if (url.pathname.endsWith('/calendarList')) {
      if (!url.searchParams.get('pageToken')) return r.fulfill({ json: { items: [{ id: 'primary@x', summary: 'Me', primary: true, backgroundColor: '#3366ff' }], nextPageToken: 'p2' } });
      return r.fulfill({ json: { items: [{ id: 'team@x', summary: 'Team', backgroundColor: '#ff8800' }] } });
    }
    const today = new Date(); const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = new Date(today); t.setDate(today.getDate() + 1);
    if (url.pathname.includes('primary%40x') || url.pathname.includes('primary@x')) {
      if (!url.searchParams.get('pageToken')) return r.fulfill({ json: { items: [{ id: 'g1', summary: 'Google study group', start: { dateTime: `${iso(t)}T15:00:00Z` }, end: { dateTime: `${iso(t)}T16:00:00Z` }, htmlLink: 'https://www.google.com/calendar/event?eid=1' }], nextPageToken: 'n2' } });
      return r.fulfill({ json: { items: state.deleted ? [] : [{ id: 'g2', summary: 'Field trip', start: { date: iso(t) }, end: { date: iso(new Date(t.getTime() + 2 * 864e5)) } }] } });
    }
    return r.fulfill({ json: { items: [] } });
  });
}
test('google calendar: connect, read-only events beside local ones, refresh, errors, disconnect', async ({ browser }) => {
  const state = { calls: [] };
  const { page, context, errors } = await open(browser, { before: (p, ctx) => routeGoogle(ctx, state), workspace: 'study-play' });
  try {
    const localEvents = await page.evaluate(() => SS.data.all('events').length);
    await page.evaluate(() => SS.gcal.setClientId('123-test.apps.googleusercontent.com'));
    // denied consent
    await page.evaluate(() => { window.__gsiMode = 'deny'; SS.gcal.panel(); });
    await page.click('.gcal-panel button:has-text("Connect Google Calendar")');
    await page.waitForSelector('.gcal-state.st-error');
    assert(/wasn’t allowed/.test(await page.textContent('.gcal-state')), 'denied consent message');
    await page.evaluate(() => { window.__gsiMode = 'closed'; });
    await page.click('.gcal-panel button:has-text("Connect Google Calendar")');
    await page.waitForFunction(() => /closed before finishing/.test(document.querySelector('.gcal-state').textContent));
    await page.evaluate(() => { window.__gsiMode = 'ok'; });
    await page.click('.gcal-panel button:has-text("Connect Google Calendar")');
    await page.waitForSelector('.gcal-state.st-ok');
    eq(await page.$$eval('.gcal-cals label', ns => ns.map(n => n.textContent.trim())), ['Me (main)', 'Team'], 'calendar list (paginated)');
    assert(state.calls.some(c => c.includes('singleEvents=true') && c.includes('timeZone=')), 'recurring expanded with time zone');
    assert(state.calls.some(c => c.includes('pageToken=n2')), 'events paginated');
    await closeDialogs(page);
    await page.waitForSelector('.cal-chip.k-gcal, .wl-item.k-gcal');
    const chip = page.locator('.widget[data-type=calendar] .cal-chip.k-gcal').first();
    eq(await chip.evaluate(n => n.draggable), false, 'Google events are not draggable');
    await chip.click();
    await page.waitForSelector('dialog:has-text("read-only")');
    assert(await page.isVisible('dialog a:has-text("Open in Google Calendar")'), 'read-only details with link');
    await closeDialogs(page);
    // stored data never contains the token
    await flush(page);
    const stored = await page.evaluate(async () => JSON.stringify([await SS.store.get('gcal'), await SS.store.get('gcal-cache'), await SS.store.get('play'), await SS.store.get('prefs'), { ...localStorage }]));
    assert(!stored.includes('fake-token-123'), 'token never stored');
    assert(stored.includes('Google study group'), 'event cache stored separately');
    // deleted upstream → refresh removes it; 401 → sign-in needed
    state.deleted = true;
    await page.evaluate(() => SS.gcal.refresh());
    await page.waitForFunction(() => !SS.gcal.itemsBetween(SS.util.addDays(SS.util.todayISO(), -1), SS.util.addDays(SS.util.todayISO(), 5)).some(i => /Field trip/.test(i.title)));
    state.fail401 = true;
    await page.evaluate(() => SS.gcal.refresh());
    await page.waitForFunction(() => SS.gcal.status().state === 'needs-auth' || SS.gcal.status().state === 'error');
    assert(/expired|sign in/i.test(await page.evaluate(() => SS.gcal.status().message)), 'expired session message');
    state.fail401 = false;
    // offline keeps cached events
    await context.setOffline(true);
    await page.evaluate(() => dispatchEvent(new Event('offline')));
    assert(/offline/i.test(await page.evaluate(() => SS.gcal.status().message)), 'offline message');
    await context.setOffline(false);
    // disconnect: Google events go, local events stay
    await page.evaluate(() => SS.gcal.panel());
    await page.click('.gcal-panel button:has-text("Disconnect")');
    await page.click('dialog.dlg-confirm button:has-text("Disconnect")');
    await closeDialogs(page);
    await page.waitForTimeout(200);
    eq(await page.$$eval('.widget[data-type=calendar] .k-gcal', ns => ns.length), 0, 'Google events removed');
    eq(await page.evaluate(() => SS.data.all('events').length), localEvents, 'local events untouched');
    eq(await page.evaluate(async () => (await SS.store.get('gcal-cache')) === undefined), true, 'cache deleted');
    assert(!errors.length, 'no console errors: ' + errors.join('; '));
  } finally { await context.close(); }
}, { own: true });

test('google calendar unconfigured: visible widget button offers usable paste setup', async ({ page }) => {
  await page.click('.widget[data-type=calendar] .cal-google-toggle');
  await page.waitForSelector('.gcal-link-input');
  assert(await page.isEnabled('.gcal-link-input'), 'calendar input works without app credentials');
  assert(await page.isEnabled('.gcal-link-add'), 'adding an embed does not require a client ID');
  assert(/Calendar ID|email|embed/i.test(await page.textContent('.gcal-panel')), 'accepted input is explained');
  await closeDialogs(page);
  assert(await page.isVisible('.widget[data-type=calendar] .cal-grid'), 'local calendar renders');
}, { workspace: 'study-play' });

test('google calendar links: IDs, links and multi-calendar embed code normalize safely', async ({ page }) => {
  const r = await page.evaluate(() => {
    const G = SS.gcal;
    const primary = 'student@example.com';
    const secondary = 'study-team@group.calendar.google.com';
    const holiday = 'en.usa#holiday@group.v.calendar.google.com';
    const url = new URL('https://calendar.google.com/calendar/embed');
    url.searchParams.append('src', primary); url.searchParams.append('src', secondary);
    url.searchParams.append('src', primary); // a repeated calendar should render only once
    const parsed = [
      G.parseLinked('  ' + primary + '  '),
      G.parseLinked(secondary),
      G.parseLinked(holiday),
      G.parseLinked(url.href),
      G.parseLinked('<iframe src="' + url.href.replace(/&/g, '&amp;') + '" width="800" height="600" frameborder="0"></iframe>')
    ];
    const invalid = [
      '', 'not a calendar', 'https://example.com/calendar/embed?src=' + primary,
      'https://calendar.google.com.evil.example/calendar/embed?src=' + primary,
      'javascript:alert(1)', '<script>window.__linkedInjected = 1</script>',
      '<iframe src="https://evil.example/"></iframe>',
      'https://calendar.google.com/calendar/ical/' + encodeURIComponent(primary) + '/private-secret/basic.ics'
    ].map(input => {
      try { G.parseLinked(input); return ''; } catch (e) { return String(e.message || e); }
    });
    return { parsed: parsed.map(p => p.ids), invalid, injected: !!window.__linkedInjected };
  });
  eq(r.parsed, [
    ['student@example.com'], ['study-team@group.calendar.google.com'], ['en.usa#holiday@group.v.calendar.google.com'],
    ['student@example.com', 'study-team@group.calendar.google.com'], ['student@example.com', 'study-team@group.calendar.google.com']
  ], 'supported inputs yield calendar IDs and deduplicate sources');
  assert(r.invalid.every(message => message.length > 4), 'unsupported and unsafe inputs produce useful errors');
  assert(!r.injected, 'pasted input never executes');
});

test('google calendar links: canonical URLs, failed replacement and saved settings', async ({ page }) => {
  const r = await page.evaluate(() => {
    const G = SS.gcal;
    const input = 'https://calendar.google.com/calendar/embed?src=student%40example.com&src=study-team%40group.calendar.google.com&evil=ignored';
    const success = G.setLinked(input, 'Study calendar');
    const before = G.linked();
    let failed = false;
    try { failed = G.setLinked('https://evil.example/', 'Broken') === false; } catch (_) { failed = true; }
    const after = G.linked();
    const urls = ['month', 'week', 'agenda'].map(view => {
      const u = new URL(G.embedUrl(view, '2026-03-09'));
      return { origin: u.origin, path: u.pathname, ids: u.searchParams.getAll('src'), mode: u.searchParams.get('mode'), zone: u.searchParams.get('ctz'), evil: u.searchParams.has('evil') };
    });
    const open = new URL(G.openLinkedUrl());
    return { success, before, failed, after, urls, open: { origin: open.origin, path: open.pathname, ids: [...open.searchParams.getAll('src'), ...open.searchParams.getAll('cid')] } };
  });
  eq(r.success, true, 'saving a valid link succeeds');
  assert(r.failed, 'invalid replacement is rejected');
  eq(r.after, r.before, 'invalid replacement preserves the previous calendar');
  eq(r.before, { ids: ['student@example.com', 'study-team@group.calendar.google.com'], name: 'Study calendar' }, 'calendar IDs and name saved');
  eq(r.urls.map(u => u.mode), ['MONTH', 'WEEK', 'AGENDA'], 'widget views map to Google display modes');
  assert(r.urls.every(u => u.origin === 'https://calendar.google.com' && u.path === '/calendar/embed' && !u.evil), 'only a canonical Google iframe URL is generated');
  assert(r.urls.every(u => u.zone && JSON.stringify(u.ids) === JSON.stringify(r.before.ids)), 'all sources and a time zone are included');
  eq(r.open.origin, 'https://calendar.google.com', 'fallback opens Google Calendar');
  assert(r.open.path.startsWith('/calendar') && r.open.ids.length > 0, 'fallback retains the selected calendar');
  await flush(page); await boot(page);
  eq(await page.evaluate(() => SS.gcal.linked()), r.before, 'calendar link survives a reload');
});

test('google calendar widget: add, change view, local toggle, reload and remove', async ({ page }) => {
  const localEvents = await page.evaluate(() => JSON.stringify(SS.data.all('events')));
  await page.click('.widget[data-type=calendar] .cal-google-toggle');
  await page.fill('.gcal-link-input', '<script>window.__linkedInjected = 1</script>');
  await page.click('.gcal-link-add');
  await page.waitForSelector('.gcal-link-error:not(:empty)');
  eq(await page.evaluate(() => SS.gcal.linked()), null, 'bad input does not add a calendar');
  eq(await page.evaluate(() => !!window.__linkedInjected), false, 'bad input is never inserted into the page');

  const embed = '<iframe src="https://calendar.google.com/calendar/embed?src=student%40example.com&amp;ctz=America%2FNew_York" style="border:0" width="800" height="600" frameborder="0" scrolling="no"></iframe>';
  await page.fill('.gcal-link-input', embed);
  await page.fill('.gcal-link-name', 'My study calendar');
  await page.click('.gcal-link-add');
  await closeDialogs(page);
  await page.waitForSelector('.widget[data-type=calendar] .cal-google-frame');
  const widget = page.locator('.widget[data-type=calendar]').first();
  const src = new URL(await widget.locator('.cal-google-frame').getAttribute('src'));
  eq([src.origin, src.pathname, src.searchParams.getAll('src')], ['https://calendar.google.com', '/calendar/embed', ['student@example.com']], 'widget embeds a normalized Google URL');
  eq(await page.evaluate(() => SS.ws.active().widgets.find(w => w.type === 'calendar').config.googleView), true, 'successful setup selects Google view');
  assert(!(await page.isVisible('.gcal-link-error')), 'setup has closed');

  for (const [view, mode] of [['week', 'WEEK'], ['agenda', 'AGENDA'], ['month', 'MONTH']]) {
    await widget.locator('[aria-label="' + view + ' view"]').click();
    await page.waitForFunction(expected => {
      const frame = document.querySelector('.widget[data-type=calendar] .cal-google-frame');
      return frame && new URL(frame.src).searchParams.get('mode') === expected;
    }, mode);
  }
  await flush(page); await boot(page);
  await page.waitForSelector('.widget[data-type=calendar] .cal-google-frame');
  eq(await page.evaluate(() => SS.gcal.linked().name), 'My study calendar', 'saved calendar survives reload');

  await page.click('.widget[data-type=calendar] .cal-google-local');
  await page.waitForSelector('.widget[data-type=calendar] .cal-grid');
  eq(await page.evaluate(() => SS.gcal.linked().ids), ['student@example.com'], 'returning to Tester keeps the Google link');
  await flush(page); await boot(page);
  assert(await page.isVisible('.widget[data-type=calendar] .cal-grid'), 'Tester view choice survives reload');
  await page.click('.widget[data-type=calendar] .cal-google-toggle');
  await page.waitForSelector('.widget[data-type=calendar] .cal-google-frame');
  await page.click('.widget[data-type=calendar] .cal-google-settings');
  await page.click('.gcal-link-remove');
  await closeDialogs(page);
  await page.waitForSelector('.widget[data-type=calendar] .cal-grid');
  eq(await page.evaluate(() => SS.gcal.linked()), null, 'removing the link restores the local calendar');
  eq(await page.evaluate(() => JSON.stringify(SS.data.all('events'))), localEvents, 'removing Google leaves local events intact');
  eq(await page.$$eval('.widget[data-type=calendar] .cal-google-frame', frames => frames.length), 0, 'removed iframe is gone');
}, { workspace: 'study-play' });

test('google calendar widget settings: adding a calendar selects Google view', async ({ page }) => {
  await page.evaluate(() => SS.panels.widgetSettings(SS.ws.active().widgets.find(w => w.type === 'calendar').id));
  await page.click('dialog[open] button:has-text("Add or manage Google Calendar")');
  await page.fill('.gcal-link-input', 'settings@example.com');
  await page.fill('.gcal-link-name', 'Added from settings');
  await page.click('.gcal-link-add');
  await closeDialogs(page);
  await page.waitForSelector('.widget[data-type=calendar] .cal-google-frame');
  eq(await page.evaluate(() => SS.ws.active().widgets.find(w => w.type === 'calendar').config.googleView), true, 'the settings action selects Google view after saving');
  eq(await page.evaluate(() => SS.gcal.linked()), { ids: ['settings@example.com'], name: 'Added from settings' }, 'calendar added through widget settings');
}, { workspace: 'study-play' });

for (const [w, h, label] of [[1400, 900, 'desktop'], [390, 844, 'phone']]) {
  test(`google calendar responsive ${label}: setup fits, embed stays in widget, ranges navigate`, async ({ page }) => {
    await page.click('.widget[data-type=calendar] .cal-google-toggle');
    await page.waitForSelector('.gcal-link-input');
    const setup = await page.evaluate(() => {
      const input = document.querySelector('.gcal-link-input');
      const dialog = input.closest('dialog');
      const d = dialog.getBoundingClientRect(), i = input.getBoundingClientRect();
      return { pageOverflow: document.scrollingElement.scrollWidth - innerWidth, dialogOverflow: dialog.scrollWidth - dialog.clientWidth, left: d.left, right: d.right, viewport: innerWidth, inputWidth: i.width, inputLeft: i.left, inputRight: i.right };
    });
    assert(setup.pageOverflow <= 1 && setup.dialogOverflow <= 1, 'setup has no horizontal overflow');
    assert(setup.left >= -1 && setup.right <= setup.viewport + 1, 'setup dialog stays within the screen');
    assert(setup.inputWidth >= 200 && setup.inputLeft >= setup.left && setup.inputRight <= setup.right, 'paste field has a usable width inside the dialog');
    await page.screenshot({ path: path.join(OUT, `calendar-${label}-setup.png`) });
    await page.fill('.gcal-link-input', 'responsive@example.com');
    await page.fill('.gcal-link-name', 'Study schedule');
    await page.click('.gcal-link-add');
    await closeDialogs(page);
    const widget = page.locator('.widget[data-type=calendar]').first();
    await widget.locator('.cal-google-frame').waitFor({ state: 'visible' });
    await widget.scrollIntoViewIfNeeded();
    const embedded = await widget.evaluate(node => {
      const w = node.getBoundingClientRect(), f = node.querySelector('.cal-google-frame').getBoundingClientRect();
      return { pageOverflow: document.scrollingElement.scrollWidth - innerWidth, left: f.left - w.left, right: w.right - f.right, top: f.top - w.top, bottom: w.bottom - f.bottom, width: f.width, height: f.height };
    });
    assert(embedded.pageOverflow <= 1, 'embedded calendar has no horizontal page overflow');
    assert(embedded.left >= -1 && embedded.right >= -1 && embedded.top >= -1 && embedded.bottom >= -1, 'iframe remains inside its widget');
    assert(embedded.width >= 200 && embedded.height >= 150, `iframe remains usable (${Math.round(embedded.width)} by ${Math.round(embedded.height)})`);
    await page.screenshot({ path: path.join(OUT, `calendar-${label}-embedded.png`) });

    for (const [view, step] of [['week', 7], ['agenda', 30]]) {
      await widget.locator('[aria-label="' + view + ' view"]').click();
      const before = await widget.evaluate(node => ({ label: node.querySelector('.cal-label').textContent, dates: new URL(node.querySelector('.cal-google-frame').src).searchParams.get('dates') }));
      assert(/\d/.test(before.label) && /[–-]/.test(before.label), `${view} heading displays a date range`);
      await widget.locator('[aria-label="Next"]').click();
      await page.waitForFunction(previous => document.querySelector('.widget[data-type=calendar] .cal-label').textContent !== previous, before.label);
      const after = await widget.evaluate(node => ({ label: node.querySelector('.cal-label').textContent, dates: new URL(node.querySelector('.cal-google-frame').src).searchParams.get('dates') }));
      const startUTC = dates => { const d = dates.split('/')[0]; return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))); };
      eq((startUTC(after.dates) - startUTC(before.dates)) / 864e5, step, `${view} next advances the requested Google range`);
      assert(after.label !== before.label, `${view} heading updates with the requested range`);
    }
  }, { viewport: { width: w, height: h }, workspace: 'study-play' });
}

/* ======================= Corner resizing & adaptive widgets ======================= */
/* A dashboard with only the given widgets: [{ type, x, y, w, h, locked }] → their ids */
async function freshDash(page, specs, mode = 'grid') {
  return page.evaluate(([specs, mode]) => {
    if (SS.dash.editing) SS.dash.setEditing(false);
    const ws = SS.ws.surface(); ws.widgets.splice(0); ws.layout.mode = mode; ws.layout.mobileOrder = null; ws.layout.mdCustom = false; ws.layout.allowOverlap = false;
    SS.dash.render();
    const ids = specs.map(sp => { const inst = SS.dash.add(sp.type, { quiet: true }); inst.pos.lg = { x: sp.x, y: sp.y, w: sp.w, h: sp.h }; inst.locked = !!sp.locked; return inst.id; });
    if (mode === 'canvas') { const width = SS.dash.inner.clientWidth; const look = SS.ws.active().appearance; SS.layout.canvasFromGrid(ws, width, look.gap, SS.layout.ROW[look.density]); }
    SS.ws.touch(ws, { layout: true }); SS.dash.render();
    return ids;
  }, [specs, mode]);
}
const lg = (page, id) => page.evaluate(i => { const w = SS.dash.findWidget(i); return { ...w.pos.lg }; }, id);
const canvasOf = (page, id) => page.evaluate(i => ({ ...SS.dash.findWidget(i).canvas }), id);
const frameRect = (page, id) => page.evaluate(i => { const r = SS.dash.instances.get(i).el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, id);
/* one grid step in px (column + gap, row + gap) */
const step = page => page.evaluate(() => { const w = SS.dash.inner.clientWidth; const look = SS.ws.active().appearance; const gap = Math.min(36, Math.max(6, look.gap)); const m = SS.layout.metrics(w, 12, gap, SS.layout.ROW[look.density]); return { x: m.colW + gap, y: m.rowH + gap }; });
/* Drag a corner handle with the mouse: hover near the corner (reveals it), press, move, release (or Escape) */
async function dragCorner(page, id, corner, dx, dy, opts = {}) {
  const r = await frameRect(page, id);
  const x = corner === 'br' ? r.right - 10 : r.left + 10, y = r.bottom - 10;
  await page.mouse.move(x - (corner === 'br' ? 20 : -20), y - 20);
  await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(220);   // the handle fades in
  const visible = await page.evaluate(([i, c]) => { const h = SS.dash.instances.get(i).el.querySelector(`.w-resize-${c}`); return getComputedStyle(h).opacity === '1' && getComputedStyle(h).pointerEvents !== 'none'; }, [id, corner]);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  const mid = opts.inspect ? await opts.inspect() : null;
  if (opts.escape) { await page.keyboard.press('Escape'); await page.mouse.up(); }
  else await page.mouse.up();
  await page.waitForTimeout(420);   // let the frame settle onto its cells (0.34s transition)
  return { visible, mid };
}

test('corner resize (grid): both corners grow and shrink with the opposite top corner anchored, limits hold', async ({ page }) => {
  const [a, b] = await freshDash(page, [{ type: 'todo', x: 4, y: 0, w: 4, h: 5 }, { type: 'reminders', x: 8, y: 0, w: 4, h: 5 }]);
  const s = await step(page);
  // bottom-right: wider and taller, top-left fixed, neighbour pushed below (no overlap)
  const r1 = await dragCorner(page, a, 'br', s.x * 2, s.y);
  assert(r1.visible, 'hovering near the bottom-right corner reveals its handle outside edit mode');
  eq(await lg(page, a), { x: 4, y: 0, w: 6, h: 6 }, 'bottom-right grows from a fixed top-left corner');
  const nb = await lg(page, b);
  assert(nb.y >= 6 || nb.x >= 10, `neighbour made room (${JSON.stringify(nb)})`);
  // bottom-left: leftwards, top-right corner (x + w = 10) stays put
  const r2 = await dragCorner(page, a, 'bl', -s.x * 3, -s.y * 2);
  assert(r2.visible, 'hovering near the bottom-left corner reveals its handle');
  eq(await lg(page, a), { x: 1, y: 0, w: 9, h: 4 }, 'bottom-left grows left and shrinks height with the top-right fixed');
  // past the left edge: clamps at column 0, right edge still 10
  await dragCorner(page, a, 'bl', -s.x * 6, 0);
  eq(await lg(page, a), { x: 0, y: 0, w: 10, h: 4 }, 'bottom-left stops at the dashboard edge');
  // far past the minimum: no inversion, the right edge still doesn't move
  const lim = await page.evaluate(() => SS.registry.limits('todo', 12));
  await dragCorner(page, a, 'bl', s.x * 20, -s.y * 20);
  eq(await lg(page, a), { x: 10 - lim.minW, y: 0, w: lim.minW, h: lim.minH }, 'shrinking past the minimum stops at the minimum, anchored');
  // bottom-right past the right edge
  await dragCorner(page, a, 'br', s.x * 20, 0);
  const g = await lg(page, a);
  eq([g.x, g.x + g.w], [10 - lim.minW, 12], 'bottom-right stops at the right edge');
  // the frame snaps exactly onto the grid after release
  const fr = await frameRect(page, a); const exp = await page.evaluate(i => { const w = SS.dash.findWidget(i).pos.lg; const look = SS.ws.active().appearance; const m = SS.layout.metrics(SS.dash.inner.clientWidth, 12, Math.min(36, Math.max(6, look.gap)), SS.layout.ROW[look.density]); return m.rect(w); }, a);
  assert(Math.abs(fr.width - exp.width) <= 1.5 && Math.abs(fr.height - exp.height) <= 1.5, 'frame snapped to its grid cells');
  // no two widgets overlap
  const overlap = await page.evaluate(() => { const ws = SS.ws.surface().widgets.map(w => ({ id: w.id, ...w.pos.lg })); return ws.some(p => ws.some(q => SS.layout.collides(p, q))); });
  assert(!overlap, 'no overlapping widgets after resizing');
  await page.screenshot({ path: path.join(OUT, 'resize-grid.png') });
});

test('corner resize: Escape cancels to the starting layout; one undo per resize (with neighbours), redo, reload', async ({ page }) => {
  const [a, b] = await freshDash(page, [{ type: 'todo', x: 0, y: 0, w: 4, h: 4 }, { type: 'assignments', x: 4, y: 0, w: 4, h: 4 }]);
  const s = await step(page);
  const before = await page.evaluate(() => SS.ws.surface().widgets.map(w => ({ ...w.pos.lg })));
  const undo0 = await page.evaluate(() => SS.undo.size);
  const { mid } = await dragCorner(page, a, 'br', s.x * 3, s.y * 2, { escape: true, inspect: () => lg(page, b) });
  void mid;
  eq(await page.evaluate(() => SS.ws.surface().widgets.map(w => ({ ...w.pos.lg }))), before, 'Escape restores every widget');
  eq(await page.evaluate(() => SS.undo.size), undo0, 'a cancelled resize adds no undo step');
  assert(!(await page.evaluate(() => document.documentElement.classList.contains('dragging-widget') || !!document.querySelector('.dash-ph'))), 'drag state cleaned up');
  // a real resize that pushes the neighbour
  await dragCorner(page, a, 'br', s.x * 2, 0);
  const after = await page.evaluate(() => SS.ws.surface().widgets.map(w => ({ ...w.pos.lg })));
  eq(after[0], { x: 0, y: 0, w: 6, h: 4 }, 'resized');
  assert(JSON.stringify(after[1]) !== JSON.stringify(before[1]), 'neighbour moved');
  eq(await page.evaluate(() => SS.undo.size), undo0 + 1, 'one undo step');
  await page.keyboard.press('Control+z'); await frames(page);
  eq(await page.evaluate(() => SS.ws.surface().widgets.map(w => ({ ...w.pos.lg }))), before, 'undo restores the widget and its neighbour');
  await page.keyboard.press('Control+Shift+z'); await frames(page);
  eq(await page.evaluate(() => SS.ws.surface().widgets.map(w => ({ ...w.pos.lg }))), after, 'redo reapplies the resize');
  await flush(page);
  await page.reload(); await page.waitForFunction(() => window.SS && SS.dash && SS.dash.instances.size >= 2);
  eq(await page.evaluate(() => SS.ws.surface().widgets.map(w => ({ ...w.pos.lg }))), after, 'resized geometry survives a reload');
});

test('corner resize: locked widgets stay put (no handles, no drag, no keyboard, no presets)', async ({ page }) => {
  const [a] = await freshDash(page, [{ type: 'todo', x: 0, y: 0, w: 4, h: 4, locked: true }, { type: 'note', x: 4, y: 0, w: 4, h: 4 }]);
  const s = await step(page);
  const r = await dragCorner(page, a, 'br', s.x * 2, s.y * 2);
  assert(!r.visible, 'no hover handle on a locked widget');
  eq(await lg(page, a), { x: 0, y: 0, w: 4, h: 4 }, 'dragging a locked corner changes nothing');
  await page.evaluate(i => { SS.dash.nudge(i, 1, 1, true, 'br'); SS.dash.nudge(i, -1, 0, true, 'bl'); SS.dash.setSize(i, 'xl'); }, a);
  eq(await lg(page, a), { x: 0, y: 0, w: 4, h: 4 }, 'keyboard and presets respect the lock');
  // in edit mode the handles are shown but refuse
  await page.evaluate(() => SS.dash.setEditing(true));
  const h = await page.evaluate(i => { const r = SS.dash.instances.get(i).resize.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, a);
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x + 200, h.y + 120, { steps: 8 }); await page.mouse.up();
  eq(await lg(page, a), { x: 0, y: 0, w: 4, h: 4 }, 'edit-mode handle refuses a locked widget');
  // growing an unlocked neighbour into the locked widget stops at its edge
  const b = await page.evaluate(() => SS.ws.surface().widgets[1].id);
  await page.evaluate(() => SS.dash.setEditing(false));
  await dragCorner(page, b, 'bl', -s.x * 3, 0);
  const nb = await lg(page, b);
  assert(nb.x >= 4 && nb.x + nb.w === 8, `neighbour stops at the locked widget, right edge fixed (${JSON.stringify(nb)})`);
});

test('keyboard corner resizing in edit mode keeps focus; both corners announced', async ({ page }) => {
  const [a] = await freshDash(page, [{ type: 'assignments', x: 4, y: 0, w: 4, h: 5 }]);
  await page.evaluate(() => SS.dash.setEditing(true));
  const labels = await page.evaluate(i => [SS.dash.instances.get(i).resize.getAttribute('aria-label'), SS.dash.instances.get(i).resizeBL.getAttribute('aria-label')], a);
  assert(/bottom-right/.test(labels[0]) && /bottom-left/.test(labels[1]), 'each corner has its own accessible name');
  await page.evaluate(i => SS.dash.instances.get(i).resizeBL.focus(), a);
  await page.keyboard.press('ArrowLeft'); await frames(page);
  eq(await lg(page, a), { x: 3, y: 0, w: 5, h: 5 }, 'bottom-left ← widens leftwards');
  await page.keyboard.press('ArrowDown'); await frames(page);
  eq(await lg(page, a), { x: 3, y: 0, w: 5, h: 6 }, '↓ adds a row');
  assert(await page.evaluate(() => document.activeElement.classList.contains('w-resize-bl')), 'focus stays on the bottom-left handle');
  await page.evaluate(i => SS.dash.instances.get(i).resize.focus(), a);
  await page.keyboard.press('ArrowRight'); await frames(page);
  eq(await lg(page, a), { x: 3, y: 0, w: 6, h: 6 }, 'bottom-right → widens rightwards');
  assert(await page.evaluate(() => document.activeElement.classList.contains('w-resize-br')), 'focus stays on the bottom-right handle');
  // the tab order only includes handles in edit mode
  await page.evaluate(() => SS.dash.setEditing(false));
  eq(await page.evaluate(i => [SS.dash.instances.get(i).resize.tabIndex, SS.dash.instances.get(i).resizeBL.tabIndex], a), [-1, -1], 'handles leave the tab order outside edit mode');
});

test('corner resize (canvas): bottom-left keeps the right edge, snaps, stops at neighbours without overlap', async ({ page }) => {
  const [a, b] = await freshDash(page, [{ type: 'todo', x: 0, y: 0, w: 3, h: 5 }, { type: 'note', x: 6, y: 0, w: 4, h: 5 }], 'canvas');
  const c0 = await canvasOf(page, b), f0 = await frameRect(page, b);
  await dragCorner(page, b, 'bl', -90, 40);
  const c1 = await canvasOf(page, b), f1 = await frameRect(page, b);
  assert(Math.abs(f1.right - f0.right) <= 1.5, `right edge stays put (${f0.right} → ${f1.right})`);
  assert(f1.width > f0.width + 60 && c1.h > c0.h, 'grew left and down');
  assert(Math.round(c1.x) % 8 === 0 || Math.round(f1.left - (await page.evaluate(() => SS.dash.inner.getBoundingClientRect().left))) % 8 === 0, 'moving edge snapped to the 8px grid');
  // grow into the neighbour on the left: stops at its edge
  await dragCorner(page, b, 'bl', -600, 0);
  const fa = await frameRect(page, a), fb = await frameRect(page, b);
  assert(fb.left >= fa.right - 1, `stops at the neighbour (${fa.right} vs ${fb.left})`);
  assert(Math.abs(fb.right - f0.right) <= 1.5, 'right edge still fixed');
  // bottom-right below the minimum: clamps to the minimum pixel size
  const min = await page.evaluate(() => SS.layout.minPx(SS.registry.get('note')));
  await dragCorner(page, b, 'br', -2000, -2000);
  const fm = await frameRect(page, b);
  assert(Math.abs(fm.width - min.w) <= 2 && Math.abs(fm.height - min.h) <= 2, `minimum size kept (${fm.width}×${fm.height})`);
  await page.screenshot({ path: path.join(OUT, 'resize-canvas.png') });
});

test('adaptive widgets: shapes change presentation, also within one coarse size category', async ({ page }) => {
  await page.evaluate(() => { const t = SS.util.todayISO(); ['Lab report', 'Essay', 'Problem set', 'Poster'].forEach((title, i) => SS.data.add('assignments', { title, dueDate: SS.util.addDays(t, i + 1), priority: 'medium' })); SS.data.add('habits', { name: 'Read', color: '#5b7cfa', log: {} }); });
  const [asg, hab, cal, tim] = await freshDash(page, [{ type: 'assignments', x: 0, y: 0, w: 6, h: 2 }, { type: 'habits', x: 6, y: 0, w: 5, h: 4 }, { type: 'calendar', x: 0, y: 2, w: 6, h: 2 }, { type: 'timer', x: 6, y: 4, w: 4, h: 2 }]);
  await frames(page);
  const shape = id => page.evaluate(i => SS.dash.instances.get(i).el.dataset.shape, id);
  eq(await shape(asg), 'strip', 'a 2-row assignments widget is a strip');
  assert(await page.$(`.widget[data-id="${asg}"] .w-strip .w-pill`), 'strip shows upcoming items as pills');
  assert(await page.$(`.widget[data-id="${cal}"] .cal-strip .cal-sday`), 'calendar strip shows the week');
  assert(await page.$(`.widget[data-id="${tim}"] .td-strip .timer-main`), 'timer strip keeps start/pause');
  // make them bigger: full presentations return; saved views are untouched
  const views = await page.evaluate(i => SS.dash.findWidget(i).config.view, cal);
  await page.evaluate(([a, c]) => { const ws = SS.ws.surface(); ws.widgets.find(w => w.id === a).pos.lg = { x: 0, y: 0, w: 6, h: 6 }; ws.widgets.find(w => w.id === c).pos.lg = { x: 0, y: 6, w: 6, h: 7 }; SS.dash.layoutPass(); }, [asg, cal]);
  await page.waitForTimeout(120);
  assert(await page.$(`.widget[data-id="${asg}"] .w-tabs`), 'square assignments show tabs and the list');
  assert(await page.$(`.widget[data-id="${cal}"] .cal-month .cal-grid`), 'calendar shows its month again');
  eq(await page.evaluate(i => SS.dash.findWidget(i).config.view, cal), views, 'size never rewrites the saved calendar view');
  // habits: widen by one column (same coarse width category) → more days shown
  const days = () => page.evaluate(i => SS.dash.instances.get(i).el.querySelectorAll('.hab-head .hab-day').length, hab);
  const cat = () => page.evaluate(i => SS.dash.instances.get(i).el.dataset.w, hab);
  const d0 = await days(), c0 = await cat();
  await page.evaluate(i => { SS.dash.findWidget(i).pos.lg.w = 6; SS.dash.layoutPass(); }, hab);
  await page.waitForTimeout(120);
  const d1 = await days(), c1 = await cat();
  console.log(`      habits: ${d0} → ${d1} days (width category ${c0} → ${c1})`);
  assert(d1 > d0, 'wider habit tracker shows more days');
  if (c0 === c1) console.log('      (change happened inside one width category)');
  // no horizontal overflow or clipped controls in any widget
  const problems = await page.evaluate(() => [...SS.dash.instances.values()].filter(inst => inst.body.scrollWidth - inst.body.clientWidth > 1).map(inst => inst.def.type));
  eq(problems, [], 'no widget body overflows horizontally');
});

test('adaptive widgets keep state while resizing: note draft, running timer, calendar iframe', async ({ page }) => {
  await page.evaluate(() => SS.gcal.setLinked('student@example.com', 'School'));
  const [note, tim, cal] = await freshDash(page, [{ type: 'note', x: 0, y: 0, w: 4, h: 4 }, { type: 'timer', x: 4, y: 0, w: 4, h: 5 }, { type: 'calendar', x: 8, y: 0, w: 4, h: 5 }]);
  await page.evaluate(i => { const inst = SS.dash.instances.get(i); inst.ctx.setConfig({ googleView: true }); }, cal);
  await page.waitForSelector(`.widget[data-id="${cal}"] .cal-google-frame`);
  await page.evaluate(i => { const f = SS.dash.instances.get(i).el.querySelector('.cal-google-frame'); f.dataset.marker = 'same'; window.__frameLoads = 0; f.addEventListener('load', () => window.__frameLoads++); }, cal);
  await page.waitForTimeout(400); await page.evaluate(() => { window.__frameLoads = 0; });
  const s = await step(page);
  await page.click(`.widget[data-id="${note}"] .wg-note-text`);
  await page.keyboard.type('Unsaved draft line');
  await page.evaluate(() => SS.timer.toggle());
  const r0 = await page.evaluate(() => SS.timer.view().remainingNow);
  await page.waitForTimeout(1100);
  await dragCorner(page, note, 'br', s.x * 2, -s.y * 2);   // into a strip and wider
  await dragCorner(page, tim, 'bl', 0, -s.y * 3);
  await dragCorner(page, tim, 'br', -s.x, s.y * 3);
  eq(await page.evaluate(i => SS.dash.instances.get(i).el.querySelector('.wg-note-text').value, note), 'Unsaved draft line', 'the draft survives resizing');
  const v = await page.evaluate(() => SS.timer.view());
  assert(v.running && v.remainingNow < r0, 'the timer kept running through resizes');
  // the embedded Google Calendar shrinks to a strip and back without being recreated or reloaded
  await dragCorner(page, cal, 'bl', -s.x * 2, -s.y * 3);
  eq(await page.evaluate(i => SS.dash.instances.get(i).el.dataset.shape, cal), 'strip', 'calendar became a strip');
  await dragCorner(page, cal, 'br', 0, s.y * 3);
  const fr = await page.evaluate(i => { const f = SS.dash.instances.get(i).el.querySelector('.cal-google-frame'); return { same: f && f.dataset.marker === 'same', loads: window.__frameLoads, visible: !!(f && f.getBoundingClientRect().height > 100) }; }, cal);
  assert(fr.same && fr.loads === 0 && fr.visible, `calendar iframe kept (${JSON.stringify(fr)})`);
  await page.evaluate(() => SS.timer.reset());
});

test('narrow screens: phones stack widgets with no freeform handles; tablets resize with the same rules', async ({ page }) => {
  const [a] = await freshDash(page, [{ type: 'todo', x: 0, y: 0, w: 4, h: 4 }]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  eq(await page.evaluate(() => SS.dash.bp), 'sm', 'phone layout');
  const shown = await page.evaluate(i => [...SS.dash.instances.get(i).el.querySelectorAll('.w-resize')].some(h => getComputedStyle(h).display !== 'none'), a);
  assert(!shown, 'no resize handles in the phone stack');
  eq(await page.evaluate(i => SS.dash.instances.get(i).el.dataset.shape, a), 'stack', 'stacked shape');
  const o = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth); assert(o <= 0, 'no horizontal overflow');
  await page.setViewportSize({ width: 1060, height: 1180 }); await page.waitForTimeout(300);
  eq(await page.evaluate(() => SS.dash.bp), 'md', 'tablet layout');
  await page.evaluate(() => SS.dash.setEditing(true));
  await page.evaluate(i => SS.dash.instances.get(i).resizeBL.focus(), a);
  const before = await page.evaluate(i => SS.layout.itemsFor(SS.ws.surface(), 'md').find(p => p.id === i), a);
  await page.keyboard.press('ArrowRight'); await frames(page);
  const after = await page.evaluate(i => SS.layout.itemsFor(SS.ws.surface(), 'md').find(p => p.id === i), a);
  eq(after.x + after.w, before.x + before.w, 'tablet bottom-left resize keeps the right edge');
});

test('size limits apply to presets and old saves (normalized to the nearest usable size)', async ({ page }) => {
  const [c] = await freshDash(page, [{ type: 'calculator', x: 0, y: 0, w: 12, h: 3 }]);
  await page.evaluate(() => { SS.layout.normalize(SS.ws.surface()); SS.dash.layoutPass(); });
  const lim = await page.evaluate(() => SS.registry.limits('calculator', 12));
  const g = await lg(page, c);
  assert(g.w === lim.maxW && g.h === lim.minH, `out-of-range calculator normalized (${JSON.stringify(g)})`);
  for (const k of ['s', 'm', 'l', 'xl']) {
    await page.evaluate(([i, k]) => SS.dash.setSize(i, k), [c, k]);
    const p = await lg(page, c);
    assert(p.w >= lim.minW && p.w <= lim.maxW && p.h >= lim.minH && p.h <= lim.maxH, `preset ${k} within limits`);
  }
  const classes = await page.evaluate(() => SS.registry.all().map(d => d.adapt));
  assert(classes.every(c => ['free', 'limited', 'constrained'].includes(c)), 'every widget has an adapt class');
});

/* ======================= Today, styles, class pages, examples, assignment progress ======================= */
const vis = (page, sel) => page.evaluate(s => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 }; }, sel);

test('first run: Today is home, welcome offers 3 styles and Start fresh / Try with examples', async ({ browser }) => {
  const { page, context, errors } = await open(browser, { load: false });
  try {
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('dialog.dlg-welcome');
    eq(await page.$$eval('dialog.dlg-welcome .sp-pick', ns => ns.map(n => n.querySelector('.sp-pick-text b').textContent)), ['Calm', 'Paper', 'Night'], 'three curated styles');
    eq(await page.$$eval('dialog.dlg-welcome .ob-opt', ns => ns.map(n => n.dataset.start)), ['fresh', 'examples'], 'start choices');
    const r = await page.evaluate(() => ({ preset: SS.ws.active().presetId, types: SS.ws.active().widgets.map(w => w.type), order: SS.ws.state.order.map(id => (SS.ws.page(id) ? SS.ws.page(id).name : id)), demo: SS.demo.count(), assignments: SS.data.all('assignments').length, game: SS.play.state.panel.visible }));
    eq(r.preset, 'today', 'fresh installs open the Today workspace');
    assert(['today', 'due', 'weekstrip', 'nextclass'].every(t => r.types.includes(t)), 'Today layout widgets');
    eq(r.order, ['home', 'Planner', 'quiz'], 'Planner tab keeps the full calendar and assignment list one click away');
    eq([r.demo, r.assignments], [0, 0], 'nothing pretend until the student asks for examples');
    eq(r.game, false, 'the game panel starts closed');
    // pick Night and examples
    await page.click('dialog.dlg-welcome .sp-pick[data-id="night"]');
    eq(await page.evaluate(() => document.documentElement.dataset.mode), 'dark', 'style preview applies live');
    await page.click('dialog.dlg-welcome .ob-opt[data-start="examples"]');
    await page.click('dialog.dlg-welcome .ob-go');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    const after = await page.evaluate(() => ({ demo: SS.demo.count(), onboarded: SS.prefs.get('onboarded'), cls: SS.ws.pages().filter(p => p.subjectId).map(p => p.name), labels: document.querySelectorAll('.widget[data-type="due"] .chip-example').length }));
    assert(after.demo > 20, 'examples added and tracked');
    eq(after.cls, ['Biology'], 'an example class page is pinned');
    assert(after.labels > 0, 'example items are labelled');
    assert(after.onboarded, 'onboarding completes');
    assert(await page.isVisible('.td-demo'), 'Today shows that examples are on, with Remove');
    assert(!errors.length, errors.join('; '));
  } finally { await context.close(); }
}, { own: true });

test('Today at laptop size: + New and the next deadline are visible without scrolling; phones put due work first', async ({ page }) => {
  await page.evaluate(() => SS.demo.seed());
  await page.waitForTimeout(200);
  const nb = await vis(page, '.td-new'); const row = await vis(page, '.widget[data-type="due"] .dw-row');
  assert(nb && nb.inView, '+ New visible on load');
  assert(row && row.inView, 'first deadline visible on load');
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('addBtn')).display), 'none', 'one primary + New (top-bar duplicate hidden on Today)');
  await page.click('.td-new');
  await page.waitForSelector('dialog .qa-input');
  await closeDialogs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const order = await page.evaluate(() => [...document.querySelectorAll('.widget')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(n => n.dataset.type));
  eq(order.slice(0, 2), ['today', 'due'], 'phone: due work comes before secondary widgets');
  const o = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  assert(o <= 0, `phone: no horizontal overflow (${o}px)`);
  await page.screenshot({ path: path.join(OUT, 'today-phone.png'), fullPage: true });
}, { viewport: { width: 1366, height: 768 } });

test('Today empty state: polished, with direct ways to add', async ({ page }) => {
  assert(await page.isVisible('.widget[data-type="due"] .dw-empty'), 'empty due panel');
  assert(await page.isVisible('.dw-empty button:has-text("Add assignment")'), 'direct add');
  await page.click('.dw-empty button:has-text("Add assignment")');
  await page.fill('dialog input[aria-label="Title"]', 'Read pages 10–20');
  await page.click('dialog button:has-text("Add assignment")');
  await page.waitForSelector('.widget[data-type="due"] .dw-row');
  eq(await page.textContent('.widget[data-type="due"] .dw-title'), 'Read pages 10–20', 'new work shows on Today');
});

test('examples: one-step removal keeps personal content (also under example classes); undo restores', async ({ page }) => {
  await page.evaluate(() => SS.demo.seed());
  const mine = await page.evaluate(() => {
    const bio = SS.data.all('subjects').find(s => s.name === 'Biology');
    const folder = SS.data.all('folders').find(f => f.name === 'Biology');
    const a = SS.data.add('assignments', { title: 'My own bio homework', subjectId: bio.id, dueDate: SS.util.addDays(SS.util.todayISO(), 1) });
    const n = SS.data.add('notes', { title: 'My bio note', folderId: folder.id, subjectId: bio.id });
    const t = SS.data.add('todos', { listId: 'inbox', text: 'My own to-do' });
    return { a: a.id, n: n.id, t: t.id, bio: bio.id, folder: folder.id, total: SS.demo.count() };
  });
  await page.click('.td-demo button:has-text("Remove")');
  await page.click('dialog.dlg-confirm button:has-text("Remove examples")');
  await page.waitForFunction(() => !SS.demo.count());
  const r = await page.evaluate(m => ({ a: SS.data.has('assignments', m.a), n: SS.data.has('notes', m.n), t: SS.data.has('todos', m.t), bio: SS.data.has('subjects', m.bio), folder: SS.data.has('folders', m.folder), others: SS.data.all('assignments').length, math: SS.data.all('subjects').some(s => s.name === 'Math'), cls: SS.ws.pages().filter(p => p.subjectId).length, sets: SS.data.all('quizzes').length, tt: SS.data.all('timetable').length, demoPill: !!document.querySelector('.td-demo') }), mine);
  eq([r.a, r.n, r.t], [true, true, true], 'personal records kept');
  eq([r.bio, r.folder], [true, true], 'an example class and folder that personal work uses are kept');
  eq([r.others, r.math, r.cls, r.sets, r.tt], [1, false, 0, 0, 0], 'every unused example removed, including the example class page');
  assert(!r.demoPill, 'the examples notice disappears');
  await page.click('.toast button:has-text("Undo")');
  eq(await page.evaluate(() => SS.demo.count()), mine.total + 0, 'undo restores the examples and their tracking');
});

test('style-only switching keeps widget positions, sizes, filters, overrides, spacing and density', async ({ page }) => {
  const before = await page.evaluate(() => {
    const ws = SS.ws.active();
    const due = ws.widgets.find(w => w.type === 'due'); due.config.days = 30; due.style = { radius: 9 };
    ws.appearance.gap = 22; ws.appearance.density = 'compact'; SS.ws.touch(ws);
    return JSON.stringify({ w: ws.widgets.map(w => ({ id: w.id, pos: w.pos, config: w.config, style: w.style })), gap: 22, density: 'compact' });
  });
  for (const id of ['paper', 'night', 'preset:sakura', 'calm']) {
    await page.evaluate(i => SS.planner.applyStyle(i), id);
    const now = await page.evaluate(() => { const ws = SS.ws.active(); return { s: JSON.stringify({ w: ws.widgets.map(w => ({ id: w.id, pos: w.pos, config: w.config, style: w.style })), gap: ws.appearance.gap, density: ws.appearance.density }), cur: SS.planner.currentStyleId(), mode: ws.appearance.mode }; });
    eq(now.s, before, `${id}: arrangement untouched`);
    eq(now.cur, id, `${id}: recognised as the current style`);
  }
  eq(await page.evaluate(() => SS.ws.active().appearance.font), 'inter', 'typography follows the style');
  // Layout presets keep the style
  await page.evaluate(() => SS.planner.applyStyle('paper'));
  const look = await page.evaluate(() => JSON.stringify(SS.ws.active().appearance));
  await page.evaluate(() => SS.ws.applyTemplate('study-play'));
  eq(await page.evaluate(() => JSON.stringify(SS.ws.active().appearance)), look, 'a layout preset keeps the current style');
  assert(await page.evaluate(() => SS.ws.active().widgets.some(w => w.type === 'flashcards')), 'Study & play layout applied');
  // Customize → Style shows curated previews up front and granular controls under Advanced
  await page.evaluate(() => SS.panels.customize('appearance'));
  await page.waitForSelector('.dlg-customize .sp-pick');
  assert(await page.$('.dlg-customize details.cz-advanced:not([open])'), 'Advanced is tucked away');
  assert(await page.$('.dlg-customize .sp-prev .sp-row .sp-tag'), 'previews show a deadline row with a subject tag');
});

test('class pages: pin from a subject, own layout, subject defaults, prefilled Quick Add reaches Today and the calendar', async ({ page }) => {
  const sid = await page.evaluate(() => SS.data.add('subjects', { name: 'Chemistry', color: '#9b5de5' }).id);
  await page.evaluate(id => SS.panels.subject(id), sid);
  await page.click('dialog.dlg-subject button:has-text("Pin as class page")');
  await page.waitForSelector('.widget[data-type="classhead"]');
  const pid = await page.evaluate(() => SS.ws.view());
  assert(await page.isVisible(`.nav-classes .nav-row[data-id="${pid}"]`), 'class page pinned under Classes');
  const cfg = await page.evaluate(() => SS.ws.surface().widgets.filter(w => 'subjectId' in w.config).map(w => w.config.subjectId));
  assert(cfg.length >= 3 && cfg.every(x => x === cfg[0]) && cfg[0], 'widgets default to the class subject');
  // a widget added on the page starts with the class subject
  const added = await page.evaluate(() => SS.dash.add('assignments', { quiet: true }).config.subjectId);
  eq(added, sid, 'new widget defaults to the class subject');
  // rearrange; Home is unaffected and the arrangement persists
  const homeBefore = await page.evaluate(() => JSON.stringify(SS.ws.active().widgets.map(w => w.pos)));
  await page.evaluate(() => { const w = SS.ws.surface().widgets.find(x => x.type === 'timer'); SS.dash.setSize(w.id, 's'); });
  const mine = await page.evaluate(() => JSON.stringify(SS.ws.surface().widgets.map(w => [w.type, w.pos.lg])));
  // Quick add from the page: the subject is prefilled
  await page.keyboard.press('n');
  await page.waitForSelector('dialog .qa-ctx');
  assert(/Chemistry/.test(await page.textContent('dialog .qa-ctx')), 'Quick add shows the class');
  await page.fill('dialog .qa-input', 'Titration worksheet tomorrow');
  await page.keyboard.press('Enter');
  const a = await page.evaluate(() => SS.data.all('assignments').find(x => x.title === 'Titration worksheet'));
  assert(a, 'captured as an assignment');
  eq(a.subjectId, sid, 'subject prefilled');
  await flush(page); await boot(page);
  eq(await page.evaluate(() => SS.ws.view()), pid, 'class page reopened');
  eq(await page.evaluate(() => JSON.stringify(SS.ws.surface().widgets.map(w => [w.type, w.pos.lg]))), mine, 'class page arrangement persists');
  eq(await page.evaluate(() => JSON.stringify(SS.ws.active().widgets.map(w => w.pos))), homeBefore, 'Home layout untouched');
  // the same record on Today and in the calendar
  await page.click('.nav-row[data-id="home"] .nav-item');
  await page.waitForSelector('.widget[data-type="due"] .dw-row');
  assert(/Titration worksheet/.test(await page.textContent('.widget[data-type="due"]')), 'shows on Today');
  const inCal = await page.evaluate(id => SS.data.agenda({ from: SS.util.todayISO(), to: SS.util.addDays(SS.util.todayISO(), 3), kinds: ['assignment'] }).some(x => x.id === id), a.id);
  assert(inCal, 'in the calendar feed');
  const planner = await page.evaluate(() => SS.ws.pages().find(p => p.template === 'planner').id);
  await page.click(`.nav-row[data-id="${planner}"] .nav-item`);
  await page.waitForSelector('.widget[data-type="calendar"]');
  assert(/Titration/.test(await page.textContent('.widget[data-type="calendar"]')), 'Planner calendar shows it');
  // Add tab offers the page templates
  await page.click('.nav-add');
  eq(await page.$$eval('dialog .tab-tpl b span', ns => ns.map(n => n.textContent)), ['Class', 'Weekly Planner', 'Exam Prep', 'Blank page'], 'Add tab templates');
});

test('assignment progress: old saves migrate (done → Done, open → To do); statuses, quick completion and links', async ({ browser }) => {
  const { page, context, errors } = await open(browser, { load: false });
  try {
    await page.goto(`${BASE}/vendor/CHESS-LICENSE.txt`);
    await page.evaluate(async () => {
      const db = await new Promise((ok, fail) => { const r = indexedDB.open('studyspace', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('images', { keyPath: 'id' }); }; r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
      const put = (k, v) => new Promise(ok => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; });
      const t = new Date(); const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      await put('meta', { version: 3, createdAt: Date.now(), whatsNew: 4, presetsSeen: ['study-play', 'ocean', 'minimal', 'midnight', 'academia', 'forest', 'sakura', 'pastel', 'mono', 'ios', 'focus'] });
      await put('workspaces', { version: 2, activeId: 'ws_mine', list: [{ id: 'ws_mine', name: 'My desk', icon: '✦', presetId: 'study-play', appearance: { accent: '#ff0066', bg: { type: 'solid', colors: ['#123456'] }, gap: 30 }, layout: { mode: 'grid' }, widgets: [{ id: 'w_a', type: 'assignments', pos: { lg: { x: 0, y: 0, w: 6, h: 7 } }, config: { filter: 'all' }, style: {} }] }], pages: [], order: ['home', 'quiz'], view: 'home' });
      await put('c:assignments', [{ id: 'a_done', title: 'Old finished', done: true, completedAt: Date.now(), dueDate: iso }, { id: 'a_open', title: 'Old open', done: false, dueDate: iso }]);
      await put('prefs', { onboarded: true, name: 'Sam' });
      db.close();
    });
    await boot(page);
    const r = await page.evaluate(() => ({ s: SS.data.all('assignments').map(a => [a.id, a.status, a.done]), ws: { id: SS.ws.active().id, accent: SS.ws.active().appearance.accent, gap: SS.ws.active().appearance.gap, types: SS.ws.active().widgets.map(w => w.type) }, presets: SS.ws.all().map(w => w.presetId), pages: SS.ws.pages().length }));
    eq(r.s, [['a_done', 'done', true], ['a_open', 'todo', false]], 'statuses migrated');
    eq(r.ws, { id: 'ws_mine', accent: '#ff0066', gap: 30, types: ['assignments'] }, 'existing workspace, look and layout kept');
    assert(r.presets.includes('today'), 'Today added as a preset for upgraders');
    eq(r.pages, 0, 'no tabs injected into an existing setup');
    await flush(page);
    const saved = await page.evaluate(() => new Promise(ok => { const q = indexedDB.open('studyspace', 1); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('c:assignments'); g.onsuccess = () => ok(g.result.map(a => a.status)); }; }));
    eq(saved, ['done', 'todo'], 'migration saved');
    // status ↔ done stay consistent
    const flow = await page.evaluate(() => {
      const D = SS.data; const out = [];
      D.update('assignments', 'a_open', { status: 'progress' }); out.push([D.get('assignments', 'a_open').status, D.get('assignments', 'a_open').done]);
      D.update('assignments', 'a_open', { status: 'submitted' }); out.push([D.get('assignments', 'a_open').status, D.get('assignments', 'a_open').done]);
      D.update('assignments', 'a_open', { done: false }); out.push([D.get('assignments', 'a_open').status, D.get('assignments', 'a_open').done]);
      D.update('assignments', 'a_open', { done: true }); out.push([D.get('assignments', 'a_open').status, D.get('assignments', 'a_open').done]);
      return out;
    });
    eq(flow, [['progress', false], ['submitted', true], ['todo', false], ['done', true]], 'status and quick completion agree');
    // editor: progress labels + assignment link
    await page.evaluate(() => { SS.data.update('assignments', 'a_open', { done: false }); SS.editors.assignment('a_open'); });
    await page.waitForSelector('dialog .asg-status-seg');
    eq(await page.$$eval('dialog .asg-status-seg .seg-btn span', ns => ns.map(n => n.textContent)), ['To do', 'In progress', 'Submitted', 'Done'], 'progress labels in the details');
    assert(await page.isHidden('dialog .asg-open-link'), 'no open button without a link');
    await page.fill('dialog input[aria-label="Assignment link"]', 'not a link at all');
    await page.click('dialog .btn-primary:has-text("Save")');
    assert(await page.$('dialog .asg-link-row .input.invalid'), 'invalid link rejected');
    await page.fill('dialog input[aria-label="Assignment link"]', 'classroom.google.com/c/abc');
    assert(await page.isVisible('dialog .asg-open-link'), 'open action appears');
    eq(await page.getAttribute('dialog .asg-open-link', 'href'), 'https://classroom.google.com/c/abc', 'link normalised');
    await page.click('dialog .asg-status-seg [data-value="progress"]');
    await page.click('dialog .btn-primary:has-text("Save")');
    const saved2 = await page.evaluate(() => SS.data.get('assignments', 'a_open'));
    eq([saved2.status, saved2.link], ['progress', 'https://classroom.google.com/c/abc'], 'status and link saved');
    assert(!errors.length, errors.join('; '));
  } finally { await context.close(); }
}, { own: true });

test('Study tab: flashcards, quizzes and a full-size focus timer; Study & Play stays a preset', async ({ page }) => {
  await page.evaluate(() => { SS.play.state.panel.visible = false; SS.play.save(); });   // as for a new student
  await page.click('.nav-row[data-id="quiz"] .nav-item');
  await page.waitForSelector('.qz-tab');
  eq(await page.$$eval('.qz-tab span', ns => ns.map(n => n.textContent)), ['Study sets', 'Quiz', 'Focus timer', 'Games & wins', 'Settings'], 'Study sections');
  eq(await page.textContent('.nav-row[data-id="quiz"] .nav-label'), 'Study', 'sidebar label');
  await page.click('.qz-tab[data-id="timer"]');
  await page.waitForSelector('.qz-timer .timer-ring');
  const size = await page.evaluate(() => document.querySelector('.qz-timer .embed-widget').getBoundingClientRect().width);
  assert(size >= 400, `timer is full-size (${Math.round(size)}px)`);
  await page.click('.qz-timer .timer-main');
  assert(await page.evaluate(() => SS.timer.state.running), 'timer starts from the Study tab');
  await page.click('.qz-timer .timer-main');
  assert(await page.evaluate(() => SS.ws.all().some(w => w.presetId === 'study-play')), 'Study & Play preset available');
  const setId = await addSet(page, CARDS);
  await page.evaluate(id => SS.quiz.practice(id), setId);
  await page.waitForSelector('.qz-quiz select');
  await page.click('.qz-quiz button:has-text("Start quiz")');
  await page.waitForSelector('.qz-show-game');
  assert(await page.isHidden('.gp-body'), 'game panel closed until the student opts in');
  await page.click('.qz-show-game');
  await page.waitForSelector('.gp-body');
});

for (const [mode, w, h] of [['light', 1440, 900], ['dark', 1440, 900], ['light', 390, 844], ['dark', 390, 844]]) {
  test(`look: Today, a class page and Customize at ${w}px in ${mode} (screenshots, no overflow)`, async ({ page }) => {
    await page.evaluate(m => { SS.demo.seed(); if (m === 'dark') SS.planner.applyStyle('night'); }, mode);
    await page.waitForTimeout(300);
    for (const [name, fn] of [['today', () => SS.nav.go('home')], ['class', () => SS.nav.go(SS.ws.pages().find(p => p.subjectId).id)], ['planner', () => SS.nav.go(SS.ws.pages().find(p => p.template === 'planner').id)]]) {
      await page.evaluate(fn); await page.waitForTimeout(450);
      const o = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      assert(o <= 0, `${name}: horizontal overflow ${o}px`);
      await page.screenshot({ path: path.join(OUT, `look-${name}-${mode}-${w}.png`) });
    }
    await page.evaluate(() => SS.panels.customize('appearance')); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `look-customize-${mode}-${w}.png`) });
  }, { viewport: { width: w, height: h } });
}

/* ======================= Layout & widths ======================= */
for (const [w, h, label] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'phone']]) {
  test(`layout at ${label} (${w}×${h}): no horizontal overflow, games fit, screenshots`, async ({ page }) => {
    const setId = await addSet(page, CARDS);
    for (const view of ['home', 'quiz']) {
      await page.evaluate(v => SS.nav.go(v), view);
      await page.waitForTimeout(300);
      const o = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      assert(o <= 0, `${view}: horizontal overflow ${o}px`);
      await page.screenshot({ path: path.join(OUT, `${label}-${view}.png`) });
    }
    await startWrittenQuiz(page, setId, 3);
    for (const g of ['chess', 'solitaire', '2048', 'blocks']) {
      await page.evaluate(id => { SS.play.setGame(id); SS.play.state.panel.pane = 'game'; SS.play.save(); }, g);
      if (await page.isVisible('.qz-switch')) await page.click('.qz-switch [data-value="game"]');
      await page.waitForTimeout(g === 'chess' ? 900 : 300);
      const box = await page.evaluate(() => { const p = document.querySelector('.gp-body').getBoundingClientRect(); const b = document.querySelector('.ss-chess-board, .ag-sol-board, .ag-2048-board, .ag-bb-board').getBoundingClientRect(); return { pw: p.width, bw: b.width, bl: b.left - p.left, br: p.right - b.right }; });
      console.log(`      ${label} ${g}: board ${Math.round(box.bw)}px in a ${Math.round(box.pw)}px panel`);
      assert(box.bw >= 150, `${g}: board legible (${Math.round(box.bw)}px)`);
      assert(box.bl >= -1 && box.br >= -1, `${g}: board inside panel`);
      const o = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      assert(o <= 0, `${g}: horizontal overflow ${o}px`);
      await page.screenshot({ path: path.join(OUT, `${label}-game-${g}.png`) });
    }
  }, { viewport: { width: w, height: h } });
}

/* ======================= Runner ======================= */
(async () => {
  const server = await serve();
  BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || undefined });
  const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (filter && !filter.test(t.name)) continue;
    const started = Date.now();
    let ctx = null;
    try {
      const run = async () => {
        if (t.opts.own) { await t.fn({ browser }); return; }
        ctx = await open(browser, { viewport: t.opts.viewport, timezoneId: t.opts.timezoneId, workspace: t.opts.workspace });
        await t.fn({ page: ctx.page, context: ctx.context, browser });
        const errs = ctx.errors.filter(e => !/net::ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|gsi\/client/.test(e));
        if (errs.length) throw new Error('Console errors: ' + errs.join(' | '));
      };
      await Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), t.opts.timeout || 45000))]);
      pass++; console.log(`✓ ${t.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (err) {
      fail++; console.log(`✗ ${t.name}\n    ${String(err && err.message || err).split('\n').filter(l => !/^\s*(\x1b\[2m)?\s*-|Call log/.test(l)).slice(0, 6).join('\n    ')}`);
      if (ctx) await ctx.page.screenshot({ path: path.join(OUT, `FAIL-${t.name.replace(/\W+/g, '_').slice(0, 60)}.png`) }).catch(() => {});
    } finally { if (ctx) await ctx.context.close().catch(() => {}); }
  }
  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed. Screenshots: ${OUT}`);
  process.exit(fail ? 1 : 0);
})();
