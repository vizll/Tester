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
  if (opts.before) await opts.before(page, context);
  if (opts.load !== false) await boot(page);
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
const addSet = (page, cards, title = 'Test set') => page.evaluate(([cards, title]) => SS.data.add('quizzes', { title, cards }).id, [cards, title]);
const CARDS = [['alpha', 'one'], ['beta', 'two'], ['gamma', 'three'], ['delta', 'four'], ['epsilon', 'five'], ['zeta', 'six']].map(([term, def]) => ({ term, def }));

/* Start a written-answer quiz on a set, through the UI */
async function startWrittenQuiz(page, setId, count = 6) {
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
  eq(r.s.actions, { chess: 5, solitaire: 0, '2048': 2, tetris: 1 }, 'actions');
  eq(r.s.wins['2048'], 3, 'wins kept');
  eq(r.s.progress, 2, 'progress of the selected game');
  eq(r.s.game, 'chess', 'selected game');
  eq(r.s.quiz.mode, 'written', 'quiz options');
  eq(r.s.stats.correct, 42, 'correct answers stat');
  eq(r.s.profile.banner, 'cosmos', 'banner kept'); eq(r.s.profile.frame, 'gold', 'frame kept');
  assert(!r.profileKeys.includes('points') && !r.profileKeys.includes('owned') && !r.profileKeys.includes('lifetime'), 'points/shop fields dropped');
  eq(r.s.gameData.chess.game.history, ['e4', 'e5'], 'chess history migrated');
  eq(r.s.gameData.chess.prefs.difficulty, 'expert', 'chess prefs migrated');
  eq(r.s.version, 2, 'version');
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

test('game mechanics: 2048 slide, Solitaire/Tetris sanitizers', async ({ page }) => {
  const r = await page.evaluate(() => {
    const M = window.SSArcadeMechanics;
    const s = M.slide2048([2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4, 'left');
    const noChange = M.slide2048([2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4, 'left');
    const sol = M.freshSolitaire(); const dup = JSON.parse(JSON.stringify(sol)); dup.stock[0] = dup.stock[1];
    const t = M.freshTetris({ target: 10 }); const bad = { ...t, board: t.board.slice(0, 5) };
    return { row: s.board.slice(0, 4), score: s.score, noChange: noChange.changed, solOk: !!M.sanitizeSolitaire({ game: sol }).game, solDup: !!M.sanitizeSolitaire({ game: dup }).game, tetOk: !!M.sanitizeTetris({ game: t }).game, tetBad: !!M.sanitizeTetris({ game: bad }).game };
  });
  eq(r.row, [4, 4, 0, 0], '2048 merge'); eq(r.score, 4, '2048 score'); eq(r.noChange, false, 'no-op slide detected');
  eq([r.solOk, r.solDup, r.tetOk, r.tetBad], [true, false, true, false], 'sanitizers');
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
  await page.evaluate(() => SS.play.setGame('tetris'));
  await startWrittenQuiz(page, setId, 4);
  await answer(page, true);
  const q = await currentQuestion(page);
  await flush(page);
  await boot(page);
  await page.waitForSelector('.qz-feedback.qz-correct');
  eq((await currentQuestion(page)).prompt, q.prompt, 'same question after reload');
  eq(await page.inputValue('.qz-written'), q.expected, 'answer text kept');
  assert(await page.isVisible('.qz-qfoot button:has-text("Next question")'), 'next button shown for a checked question');
  eq(await page.inputValue('.gp-select'), 'tetris', 'game selection kept');
});

test('keyboard isolation: Space on a quiz button never drops a Tetris piece', async ({ page }) => {
  const setId = await addSet(page, CARDS);
  await page.evaluate(() => { SS.play.setGame('tetris'); SS.play.state.actions.tetris = 3; SS.play.save(); });
  await startWrittenQuiz(page, setId, 4);
  await page.focus('.qz-qfoot button:has-text("End quiz")');
  await page.evaluate(() => document.querySelector('.qz-qfoot button').blur());
  await page.focus('.qz-qfoot button:has-text("Check answer")');
  await page.keyboard.press('Space');
  eq((await play(page)).actions.tetris, 3, 'Space on Check answer did not reach Tetris');
  await page.focus('.ag-tetris-board');
  await page.keyboard.press('ArrowLeft');
  eq((await play(page)).actions.tetris, 3, 'moving a piece is free');
  await page.keyboard.press('Space');
  eq((await play(page)).actions.tetris, 2, 'Space on the board drops (one move)');
  await page.focus('.gp-select');
  await page.keyboard.press('ArrowDown');
  eq((await play(page)).actions.tetris, 2, 'arrows on the game selector are not game input');
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
  eq(await page.$$eval('.widget', ns => ns.map(n => n.dataset.type)), ['timer'], 'tab 1 keeps only its widget');
  eq(await page.evaluate(id => JSON.stringify(SS.ws.page(id).widgets[0].pos), tab1), tab1Pos, 'tab 1 layout unaffected by tab 2 resize');
  await page.click('.nav-row[data-id="home"] .nav-item');
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

/* ======================= Migration & backup ======================= */
async function seedOldVersion(page) {
  await page.goto(`${BASE}/vendor/CHESS-LICENSE.txt`);
  await page.evaluate(async () => {
    localStorage.setItem('studyspace-play-v1', JSON.stringify({ version: 1, credits: { chess: 4, solitaire: 1, '2048': 0, tetris: 2 }, wins: { chess: 2, solitaire: 0, '2048': 1, tetris: 0 }, progress: { chess: 1, solitaire: 0, '2048': 0, tetris: 0 }, settings: { threshold: 3, turns: 3, autoOpen: true }, quizOptions: { rewardGame: 'chess' }, profile: { name: 'Old', bio: 'from v1', points: 777, owned: ['aurora', 'simple', 'tide'], banner: 'tide', width: 300, collapsed: false }, gameData: { chess: { history: ['e4', 'e5', 'Nf3'], difficulty: 'beginner', preset: 'forest', won: false } } }));
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
  eq(r.p.actions, { chess: 4, solitaire: 1, '2048': 0, tetris: 2 }, 'unused moves preserved');
  eq(r.p.wins, { chess: 2, solitaire: 0, '2048': 1, tetris: 0 }, 'wins preserved');
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
    SS.play.state.wins.tetris = 4; SS.play.state.actions.chess = 6; SS.play.data('chess').game = { id: 'b1', history: ['d4', 'd5'], won: false, winCounted: false }; SS.play.save();
  });
  await flush(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => SS.panels.exportBackup(true))]);
  const file = path.join(OUT, 'backup.json'); await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(json.version, 3, 'backup version'); assert(json.play && json.workspaces.pages.length === 1, 'play state and tabs included');
  assert(!('arcade' in json) && !JSON.stringify(json).includes('access_token'), 'no reward record or tokens');
  // restore into a fresh profile
  const fresh = await open(browser);
  try {
    const p2 = fresh.page;
    const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.evaluate(() => SS.panels.importBackup())]);
    await chooser.setFiles(file);
    await p2.click('dialog button:has-text("Replace everything")');
    await p2.click('dialog.dlg-confirm button:has-text("Replace")');
    await p2.waitForFunction(() => SS.ws.pages().length === 1);
    const r = await p2.evaluate(() => ({ wins: SS.play.state.wins.tetris, actions: SS.play.state.actions.chess, hist: SS.play.data('chess').game.history, tab: SS.ws.pages()[0].name, widgets: SS.ws.pages()[0].widgets.length }));
    eq(r, { wins: 4, actions: 6, hist: ['d4', 'd5'], tab: 'Backup tab', widgets: 1 }, 'restored');
    // merging the same backup again doesn't duplicate tabs/themes or add wins
    const themes = await p2.evaluate(() => SS.ws.all().length);
    const [chooser2] = await Promise.all([p2.waitForEvent('filechooser'), p2.evaluate(() => SS.panels.importBackup())]);
    await chooser2.setFiles(file);
    await p2.click('dialog button:has-text("Merge")');
    await p2.waitForTimeout(500);
    eq(await p2.evaluate(() => [SS.ws.all().length, SS.ws.pages().length, SS.play.state.wins.tetris]), [themes, 1, 4], 'merge is idempotent');
    // an old (version 2) backup with the reward record
    const old = { app: 'studyspace', version: 2, exportedAt: new Date().toISOString(), content: { quizzes: [{ id: 'oldq', title: 'From v2', cards: [{ term: 'x', def: 'y' }] }] }, workspaces: { version: 1, list: [{ id: 'ws_v2', name: 'V2 desk', appearance: {}, widgets: [{ id: 'w1', type: 'trophies', pos: { lg: { x: 0, y: 0, w: 4, h: 4 } } }, { id: 'w2', type: 'quiz-plus', pos: { lg: { x: 4, y: 0, w: 6, h: 5 } } }] }], activeId: 'ws_v2' }, prefs: {}, arcade: { version: 1, credits: { chess: 1 }, wins: { tetris: 9 }, profile: { points: 5000, owned: ['tide'] } } };
    const oldFile = path.join(OUT, 'old-backup.json'); fs.writeFileSync(oldFile, JSON.stringify(old));
    const [chooser3] = await Promise.all([p2.waitForEvent('filechooser'), p2.evaluate(() => SS.panels.importBackup())]);
    await chooser3.setFiles(oldFile);
    await p2.click('dialog button:has-text("Merge")');
    await p2.waitForTimeout(500);
    const r3 = await p2.evaluate(() => ({ types: SS.ws.all().find(w => w.name.startsWith('V2 desk')).widgets.map(w => w.type), wins: SS.play.state.wins.tetris, keys: Object.keys(SS.play.state.profile), set: SS.data.all('quizzes').some(q => q.title === 'From v2') }));
    eq(r3.types, ['flashcards'], 'old reward widgets not resurrected');
    eq(r3.wins, 9, 'merge keeps the higher win count (not 13)');
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
  const { page, context, errors } = await open(browser, { before: (p, ctx) => routeGoogle(ctx, state) });
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

test('google calendar unconfigured: local calendar keeps working, connect explains setup', async ({ page }) => {
  await page.evaluate(() => SS.gcal.panel());
  assert(await page.isDisabled('.gcal-panel button:has-text("Connect Google Calendar")'), 'connect disabled without a client ID');
  assert(/client ID/i.test(await page.textContent('.gcal-panel')), 'setup explained');
  await closeDialogs(page);
  assert(await page.isVisible('.widget[data-type=calendar] .cal-grid'), 'local calendar renders');
});

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
    for (const g of ['chess', 'solitaire', '2048', 'tetris']) {
      await page.evaluate(id => { SS.play.setGame(id); SS.play.state.panel.pane = 'game'; SS.play.save(); }, g);
      if (await page.isVisible('.qz-switch')) await page.click('.qz-switch [data-value="game"]');
      await page.waitForTimeout(g === 'chess' ? 900 : 300);
      const box = await page.evaluate(() => { const p = document.querySelector('.gp-body').getBoundingClientRect(); const b = document.querySelector('.ss-chess-board, .ag-sol-board, .ag-2048-board, .ag-tetris-board').getBoundingClientRect(); return { pw: p.width, bw: b.width, bl: b.left - p.left, br: p.right - b.right }; });
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
  const browser = await chromium.launch();
  const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (filter && !filter.test(t.name)) continue;
    const started = Date.now();
    let ctx = null;
    try {
      const run = async () => {
        if (t.opts.own) { await t.fn({ browser }); return; }
        ctx = await open(browser, { viewport: t.opts.viewport, timezoneId: t.opts.timezoneId });
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
