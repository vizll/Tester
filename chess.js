/* Tester chess: legal rules from chess.js (vendor/chess.js), the bot from Stockfish running locally in a
   Web Worker (vendor/stockfish-19-lite-single.js + .wasm). You play White; each legal move uses one
   earned move and the bot's reply is free. If Stockfish can't run (old browser, file://, blocked worker)
   a small built-in bot keeps the game playable. Engine replies are matched to the exact position they
   were asked about, so a reset, navigation or new game can never apply an outdated move. */
(function (SS) {
  'use strict';
  const P = SS.play;
  const U = SS.util;
  const { el } = U;
  const K = P.kit;
  const RULES_SRC = 'vendor/chess.js';
  const ENGINE_SRC = 'vendor/stockfish-19-lite-single.js';
  const ENGINE_LOAD_MS = 20000;
  const glyph = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
  const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
  const LEVELS = { beginner: { skill: 0, ms: 300, label: 'Beginner' }, intermediate: { skill: 7, ms: 700, label: 'Intermediate' }, professional: { skill: 14, ms: 1600, label: 'Professional' }, expert: { skill: 20, ms: 5000, label: 'Expert' } };
  const FONTS = ['Georgia', 'Times New Roman', 'Palatino Linotype', 'Segoe UI Symbol', 'Arial', 'Verdana', 'Trebuchet MS', 'Courier New'];
  const FILES = 'abcdefgh';
  const svgBackground = (a, b, c) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="45"/></filter></defs><path fill="url(#g)" d="M0 0h800v800H0z"/><g opacity=".4" filter="url(#f)"><circle cx="170" cy="150" r="150" fill="${c}"/><circle cx="680" cy="600" r="220" fill="${a}"/></g><path d="M0 650Q220 330 450 490T800 210" fill="none" stroke="white" stroke-opacity=".2" stroke-width="80"/></svg>`);
  const PRESETS = {
    ocean: { label: 'Ocean glass', url: svgBackground('#bfe8f5', '#84babf', '#eaf4dd') },
    forest: { label: 'Forest', url: svgBackground('#d2d6b8', '#87aa8b', '#e7e2c4') },
    nebula: { label: 'Nebula', url: svgBackground('#9c87b4', '#b6b7e8', '#f6d4db') },
    sunset: { label: 'Sunset', url: svgBackground('#f6d9a8', '#e9b3a8', '#f8e9d1') }
  };
  const DEFAULT_PREFS = { difficulty: 'intermediate', preset: 'ocean', pieces: 'classic', white: '#ffffff', black: '#172e44', font: 'Georgia', fog: 8, dark: '#16415c', image: '' };

  /* Accepts the version 1 shape (flat fields) and the current { prefs, game } shape */
  function sanitize(data) {
    const flat = !U.isObj(data.prefs) && !U.isObj(data.game);
    const raw = flat ? data : (U.isObj(data.prefs) ? data.prefs : {});
    const prefs = {
      difficulty: LEVELS[raw.difficulty] ? raw.difficulty : DEFAULT_PREFS.difficulty,
      preset: PRESETS[raw.preset] ? raw.preset : DEFAULT_PREFS.preset,
      pieces: ['classic', 'solid', 'letters'].includes(raw.pieces) ? raw.pieces : 'classic',
      white: U.hex(raw.white, DEFAULT_PREFS.white), black: U.hex(raw.black, DEFAULT_PREFS.black), dark: U.hex(raw.dark, DEFAULT_PREFS.dark),
      font: typeof raw.font === 'string' && /^[\w\s-]{1,40}$/.test(raw.font) ? raw.font : DEFAULT_PREFS.font,
      fog: U.clampNum(raw.fog, 0, 20, 8),
      image: typeof raw.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(raw.image) && raw.image.length < 3e6 ? raw.image : ''
    };
    const g = flat ? data : data.game;
    const history = (U.isObj(g) && Array.isArray(g.history) ? g.history : []).filter(m => typeof m === 'string' && /^[\w=+#-]{2,8}$/.test(m)).slice(0, 1200);
    const won = U.isObj(g) && !!g.won;
    return { prefs, game: { id: U.isObj(g) && typeof g.id === 'string' ? g.id.slice(0, 40) : U.uid('g'), history, won, winCounted: U.isObj(g) && g.winCounted !== undefined ? !!g.winCounted : won } };
  }

  /* ---------------- Rules library (loaded once, retried after a failure) ---------------- */
  let rulesPromise = null;
  const loadRules = () => (window.Chess ? Promise.resolve() : (rulesPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = RULES_SRC;
    s.onload = () => (window.Chess ? resolve() : reject(new Error('rules')));
    s.onerror = () => { s.remove(); reject(new Error('rules')); };
    document.head.append(s);
  }).catch(err => { rulesPromise = null; throw err; })));

  /* ---------------- Stockfish worker ---------------- */
  function createEngine(onChange) {
    let worker = null, state = 'off', error = '', loadTimer = null, current = null, queued = null;
    const post = msg => { try { worker && worker.postMessage(msg); } catch (_) { /* worker gone */ } };
    const settle = (req, value) => { if (!req) return; clearTimeout(req.timer); req.resolve(value); };
    function fail(message) {
      clearTimeout(loadTimer);
      try { worker && worker.terminate(); } catch (_) { /* already stopped */ }
      worker = null; state = 'failed'; error = message;
      settle(current, null); current = null; settle(queued, null); queued = null;
      onChange();
    }
    /* The search in flight is no longer wanted: answer its caller now, stop the engine, and drop the late
       "bestmove" when it arrives (the next search waits for it, so replies can't be mismatched). */
    function abandon() {
      if (!current || current.stale) return;
      current.stale = true; clearTimeout(current.timer); current.resolve(null);
      current.timer = setTimeout(() => fail('Stockfish stopped responding.'), 8000);
      post('stop');
    }
    function run(req) {
      current = req;
      post(`setoption name Skill Level value ${req.level.skill}`);
      post(`position fen ${req.fen}`);
      post(`go movetime ${req.level.ms}`);
      req.timer = setTimeout(() => fail('Stockfish stopped responding.'), req.level.ms + 15000);
    }
    const api = {
      get state() { return state; },
      get error() { return error; },
      start() {
        api.destroy();
        state = 'loading'; error = ''; onChange();
        let w;
        try { w = worker = new Worker(ENGINE_SRC); } catch (_) { fail('This browser can’t start the Stockfish worker here.'); return; }
        w.onerror = e => { if (worker === w) { e.preventDefault?.(); fail(location.protocol === 'file:' ? 'Stockfish needs the page to be served over http(s), not opened as a file.' : 'Stockfish couldn’t load.'); } };
        w.onmessage = e => {
          if (worker !== w) return;
          const line = String(e.data);
          if (line === 'uciok') { post('setoption name Hash value 16'); post('setoption name UCI_LimitStrength value false'); post('isready'); }
          else if (line === 'readyok' && state === 'loading') { clearTimeout(loadTimer); state = 'ready'; onChange(); if (queued) { const q = queued; queued = null; run(q); } }
          else if (line.startsWith('bestmove')) {
            const req = current; current = null;
            if (req) { clearTimeout(req.timer); if (!req.stale) req.resolve(line.split(' ')[1] || null); }
            if (queued && state === 'ready') { const q = queued; queued = null; run(q); }
          }
        };
        post('uci');
        loadTimer = setTimeout(() => { if (state === 'loading') fail('Stockfish took too long to load.'); }, ENGINE_LOAD_MS);
      },
      /* Resolves with a UCI move for exactly this position, or null if it was cancelled or failed */
      search(fen, level) {
        return new Promise(resolve => {
          const req = { fen, level, resolve, stale: false, timer: null };
          if (state !== 'ready' && state !== 'loading') { resolve(null); return; }
          settle(queued, null);
          if (current || state === 'loading') { abandon(); queued = req; return; }
          run(req);
        });
      },
      /* Forget any outstanding search; its late reply is ignored */
      cancel() { abandon(); settle(queued, null); queued = null; },
      destroy() { clearTimeout(loadTimer); settle(current, null); settle(queued, null); current = queued = null; try { worker && worker.terminate(); } catch (_) { /* fine */ } worker = null; state = 'off'; }
    };
    return api;
  }

  /* ---------------- Built-in fallback bot (two-ply material search) ---------------- */
  const VALUE = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };
  function material(game) { let s = 0; game.board().forEach(r => r.forEach(p => { if (p) s += (p.color === 'b' ? 1 : -1) * VALUE[p.type]; })); return s; }
  function fallbackMove(fen, difficulty) {
    const game = new window.Chess(fen);
    const moves = game.moves({ verbose: true });
    if (!moves.length) return null;
    const scored = moves.map(m => {
      game.move(m);
      let score;
      if (game.isCheckmate()) score = 1000;
      else if (game.isDraw()) score = -0.5;
      else {
        let worst = Infinity;
        for (const r of game.moves({ verbose: true })) { game.move(r); worst = Math.min(worst, game.isCheckmate() ? -1000 : material(game)); game.undo(); }
        score = worst === Infinity ? material(game) : worst;
      }
      game.undo();
      return { m, score: score + Math.random() * 0.2 };
    }).sort((a, b) => b.score - a.score);
    const spread = { beginner: 0.6, intermediate: 0.25, professional: 0.08, expert: 0 }[difficulty] ?? 0.25;
    const pick = scored[Math.floor(Math.random() * Math.max(1, Math.round(scored.length * spread)))] || scored[0];
    return pick.m.from + pick.m.to + (pick.m.promotion || '');
  }

  /* ---------------- Board background crop ---------------- */
  function cropImage(file, done) {
    if (!file || !file.type.startsWith('image/')) { SS.ui.toast('Choose an image file.', { kind: 'error' }); return; }
    if (file.size > 15 * 1024 * 1024) { SS.ui.toast('Choose an image smaller than 15 MB.', { kind: 'error' }); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); SS.ui.toast('This image could not be opened.', { kind: 'error' }); };
    img.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 768;
      const ctx = canvas.getContext('2d');
      let zoom = 1, x = 50, y = 50;
      const paint = () => { const side = Math.min(img.width, img.height) / zoom; ctx.clearRect(0, 0, 768, 768); ctx.drawImage(img, (img.width - side) * x / 100, (img.height - side) * y / 100, side, side, 0, 0, 768, 768); };
      const finish = () => { try { paint(); done(canvas.toDataURL('image/jpeg', 0.86)); } catch (_) { SS.ui.toast('This image could not be used. Try a PNG, JPEG or WebP image.', { kind: 'error' }); } finally { URL.revokeObjectURL(url); } };
      if (img.width === img.height) { finish(); return; }
      const d = SS.ui.dialog({ eyebrow: 'Board background', title: 'Crop your image to a square', subtitle: 'Move and zoom the preview, then apply the crop.', size: 'md', onClose: () => URL.revokeObjectURL(url) });
      canvas.className = 'ss-chess-crop'; d.body.append(canvas);
      const range = (label, min, max, value, change) => SS.ui.field(label, el('input', { type: 'range', min, max, step: 1, value, aria: { label }, on: { input: e => { change(Number(e.target.value)); paint(); } } }));
      d.body.append(range('Zoom', 100, 300, 100, v => { zoom = v / 100; }), range('Horizontal position', 0, 100, 50, v => { x = v; }), range('Vertical position', 0, 100, 50, v => { y = v; }));
      d.foot.append(el('button.btn', { type: 'button', text: 'Cancel', on: { click: () => d.close() } }), el('button.btn.btn-primary', { type: 'button', text: 'Use square crop', on: { click: () => { finish(); d.close(); } } }));
      paint();
    };
    img.src = url;
  }

  function statusOf(game) {
    if (game.isCheckmate()) return game.turn() === 'b' ? { over: true, text: 'Checkmate — you win! 🏆', win: true } : { over: true, text: 'Checkmate — the bot wins. Start a new game when you’re ready.' };
    if (game.isStalemate()) return { over: true, text: 'Stalemate — it’s a draw.' };
    if (game.isThreefoldRepetition()) return { over: true, text: 'Draw by threefold repetition.' };
    if (game.isInsufficientMaterial()) return { over: true, text: 'Draw — not enough material left to checkmate.' };
    if (game.isDrawByFiftyMoves()) return { over: true, text: 'Draw by the 50-move rule.' };
    return { over: false, check: game.isCheck() };
  }

  P.register('chess', {
    title: 'Chess', icon: '♟', description: 'Play White against a local Stockfish bot at four levels.',
    rules: 'Each legal move you make uses one move; the bot’s reply is free. Selecting pieces and illegal moves are free.',
    sanitize,
    settings(id = 'chess') {
      const p = P.data(id).prefs || DEFAULT_PREFS; const set = (k, v) => K.setPref(id, k, v);
      const upload = el('input', { type: 'file', accept: 'image/*', aria: { label: 'Upload your own chess board background' }, on: { change: e => { cropImage(e.target.files[0], image => { const d = P.data(id); d.prefs = { ...d.prefs, image }; P.changed({ type: 'prefs', game: id, key: 'image' }); }); e.target.value = ''; } } });
      return [
        K.field('Bot difficulty', K.select('Chess bot difficulty', Object.entries(LEVELS).map(([k, v]) => [k, `${v.label} · skill ${v.skill}/20`]), p.difficulty, v => set('difficulty', v)), 'Applies from the bot’s next move.'),
        K.field('Board background', K.select('Chess board background', Object.entries(PRESETS).map(([k, v]) => [k, v.label]), p.preset, v => { const d = P.data(id); d.prefs = { ...d.prefs, preset: v, image: '' }; P.changed({ type: 'prefs', game: id, key: 'preset' }); })),
        K.field('Piece style', K.select('Chess piece style', [['classic', 'Classic outline'], ['solid', 'Solid silhouettes'], ['letters', 'Minimal letters']], p.pieces, v => set('pieces', v))),
        K.field('Piece font', K.select('Chess piece font', FONTS.map(f => [f, f]), FONTS.includes(p.font) ? p.font : 'Georgia', v => set('font', v))),
        K.field('White pieces', K.color('White piece colour', p.white, v => set('white', v))),
        K.field('Black pieces', K.color('Black piece colour', p.black, v => set('black', v))),
        K.field('Dark square tint', K.color('Dark square tint', p.dark, v => set('dark', v))),
        K.field('Dark square blur', K.range('Dark square blur', 0, 20, p.fog, v => set('fog', v))),
        K.field('Your own board image', upload, p.image ? 'Using your image.' : 'Non-square images open a crop preview.'),
        p.image ? el('button.btn.btn-sm', { type: 'button', text: 'Use the preset image again', on: { click: () => set('image', '') } }) : null
      ].filter(Boolean);
    },
    summary: data => (data.game && data.game.history.length ? `${Math.ceil(data.game.history.length / 2)} moves played${data.game.won ? ' · won' : ''}` : 'Not started'),
    mount(host, opts = {}) {
      const data = P.data('chess');
      Object.assign(data, sanitize(data));
      const preview = !!opts.preview;
      let game = null, selected = null, cursor = 'e2', promo = null, thinking = false, destroyed = false, note = '', lastMove = null, usingFallback = false;
      const engine = preview ? null : createEngine(() => { if (!destroyed) { paintStatus(); maybeBot(); } });
      const status = el('p.ag-status.ss-chess-status', { attrs: { 'aria-live': 'polite' } });
      const detail = el('div.ag-score');
      const board = el('div.ss-chess-board', { role: 'group', aria: { label: 'Chess board. You play White. Arrow keys move between squares; Enter or Space selects.' } });
      const promoBox = el('div.ss-chess-promo', { hidden: true, role: 'dialog', aria: { label: 'Choose a piece for promotion' } });
      const history = el('div.ss-chess-history', { aria: { label: 'Move list' } });
      const retry = el('button.btn.btn-sm', { type: 'button', hidden: true, on: { click: () => { usingFallback = false; note = ''; engine.start(); } } }, 'Retry Stockfish');
      const newGame = el('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        if (!game) return;
        if (!(await K.confirmNew(game.history().length && !statusOf(game).over))) return;
        if (destroyed) return;
        engine && engine.cancel();
        thinking = false; selected = null; promo = null; lastMove = null; note = '';
        game.reset();
        data.game = { id: U.uid('g'), history: [], won: false, winCounted: false };
        P.changed({ type: 'board', game: 'chess' });
        paint();
      } } }, 'New game');
      const root = el('div.ag-game.ss-chess', { class: preview ? 'ag-preview' : '' },
        el('div.ag-top', detail, status),
        el('div.ag-stage.ss-chess-stage', el('div.ss-chess-wrap', board, promoBox)),
        preview ? null : el('div.ag-controls', newGame, retry),
        preview ? null : history,
        preview ? null : el('details.hint.ss-chess-credits', el('summary', { text: 'Chess engine & licences' }), el('p', 'Stockfish 19 runs locally in your browser. ', el('a', { href: 'vendor/STOCKFISH-LICENSE.txt', target: '_blank', rel: 'noopener', text: 'Stockfish licence (GPLv3)' }), ' · ', el('a', { href: 'vendor/STOCKFISH-SOURCE.tar.gz', text: 'Corresponding source' }), ' · ', el('a', { href: 'vendor/CHESS-LICENSE.txt', target: '_blank', rel: 'noopener', text: 'chess.js licence (BSD)' }))));
      host.replaceChildren(root);
      board.append(el('p.ss-chess-loading', { text: 'Loading chess rules…' }));

      function persist() { data.game.history = game.history(); }
      function paint() {
        if (!game || destroyed) return;
        const p = data.prefs;
        board.style.backgroundImage = `url("${p.image || PRESETS[p.preset].url}")`;
        ['white', 'black', 'dark'].forEach(k => board.style.setProperty(`--chess-${k}`, p[k]));
        board.style.setProperty('--chess-font', `"${p.font}"`); board.style.setProperty('--chess-fog', `${p.fog}px`);
        const hadFocus = board.contains(document.activeElement);
        const targets = selected ? game.moves({ square: selected, verbose: true }) : [];
        const st = statusOf(game);
        const kingInCheck = st.check ? game.board().flat().find(x => x && x.type === 'k' && x.color === game.turn())?.square : null;
        board.replaceChildren();
        game.board().forEach((rank, row) => rank.forEach((piece, col) => {
          const square = FILES[col] + (8 - row);
          const light = (row + col) % 2 === 0;
          const move = targets.find(m => m.to === square);
          const last = lastMove && (lastMove.from === square || lastMove.to === square);
          const label = `${square}${piece ? `, ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : ', empty'}${selected === square ? ', selected' : ''}${move ? (move.captured ? ', capture available' : ', legal move') : ''}`;
          const b = el('button.ss-chess-square', { type: 'button', tabIndex: !preview && square === cursor ? 0 : -1, dataset: { sq: square }, class: [light ? 'light' : 'dark', selected === square ? 'selected' : '', move ? (move.captured ? 'capture' : 'legal') : '', last ? 'last' : '', square === kingInCheck ? 'check' : ''].join(' '), aria: { label, pressed: String(selected === square) }, on: { click: () => clickSquare(square), focus: () => { cursor = square; } } });
          if (piece) b.append(el('span.ss-chess-piece', { class: piece.color === 'w' ? 'white' : 'black', text: p.pieces === 'letters' ? (piece.color === 'w' ? piece.type.toUpperCase() : piece.type) : p.pieces === 'solid' ? glyph.b[piece.type] : glyph[piece.color][piece.type], aria: { hidden: 'true' } }));
          if (col === 0) b.append(el('small.ss-chess-rank', { text: String(8 - row), aria: { hidden: 'true' } }));
          if (row === 7) b.append(el('small.ss-chess-file', { text: FILES[col], aria: { hidden: 'true' } }));
          board.append(b);
        }));
        if (hadFocus && !promo) board.querySelector(`[data-sq="${cursor}"]`)?.focus({ preventScroll: true });
        const n = game.history().length;
        detail.replaceChildren(el('span', { text: `${LEVELS[p.difficulty].label} bot${usingFallback ? ' (simple)' : ''}` }), el('span', { text: n ? `Move ${Math.floor(n / 2) + 1}` : 'White to move' }), el('span', { text: `${game.history({ verbose: true }).filter(m => m.color === 'w' && m.captured).length} captures` }));
        history.textContent = game.history().map((m, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '') + m).join('  ') || 'Your moves will appear here.';
        history.scrollTop = history.scrollHeight;
        paintStatus();
      }
      function paintStatus() {
        if (!game || destroyed) return;
        const st = statusOf(game);
        const eng = engine ? engine.state : 'off';
        retry.hidden = preview || eng !== 'failed';
        let text;
        if (st.over) text = st.text;
        else if (note) text = note;
        else if (game.turn() === 'b') text = thinking ? 'The bot is thinking…' : eng === 'loading' && !usingFallback ? 'Loading Stockfish…' : 'Bot to move.';
        else if (!P.actions('chess')) text = K.noMoves('chess');
        else text = `${st.check ? 'Check! ' : ''}Your move — pick a white piece, then where it goes.`;
        if (eng === 'failed' && !st.over) text += ` ${engine.error} Using the simple built-in bot instead.`;
        status.textContent = text;
        status.classList.toggle('ag-blocked', !P.actions('chess') && !st.over && game.turn() === 'w');
      }
      function clickSquare(square) {
        if (!game || preview || promo) return;
        cursor = square;
        const st = statusOf(game);
        if (st.over) { note = ''; paint(); return; }
        if (game.turn() !== 'w' || thinking) { note = 'Wait for the bot’s reply.'; paintStatus(); return; }
        const piece = game.get(square);
        if (piece && piece.color === 'w') { selected = selected === square ? null : square; note = ''; paint(); return; }
        if (!selected) { note = piece ? 'That’s a black piece — choose one of your white pieces.' : 'Choose one of your white pieces first.'; paintStatus(); return; }
        const choices = game.moves({ square: selected, verbose: true }).filter(m => m.to === square);
        if (!choices.length) { note = 'That move isn’t legal. No move used.'; selected = null; paint(); return; }
        if (!P.actions('chess')) { note = K.noMoves('chess'); paintStatus(); return; }
        if (choices.some(m => m.promotion)) { askPromotion(selected, square); return; }
        play(selected, square);
      }
      function askPromotion(from, to) {
        promo = { from, to };
        promoBox.hidden = false;
        promoBox.replaceChildren(el('p', { text: 'Promote to' }),
          ...[['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']].map(([pc, name]) => el('button.btn', { type: 'button', aria: { label: `Promote to ${name}` }, on: { click: () => { const pr = promo; closePromotion(); play(pr.from, pr.to, pc); } } }, el('span.ss-chess-promo-piece', { text: glyph.w[pc], aria: { hidden: 'true' } }), name)),
          el('button.btn.btn-ghost', { type: 'button', text: 'Cancel', on: { click: () => { closePromotion(); paint(); } } }));
        promoBox.addEventListener('keydown', onPromoKey);
        requestAnimationFrame(() => promoBox.querySelector('button')?.focus());
      }
      function onPromoKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePromotion(); paint(); board.querySelector(`[data-sq="${cursor}"]`)?.focus(); } }
      function closePromotion() { promo = null; promoBox.hidden = true; promoBox.replaceChildren(); promoBox.removeEventListener('keydown', onPromoKey); }
      function play(from, to, promotion) {
        let move;
        try { move = game.move({ from, to, ...(promotion ? { promotion } : {}) }); } catch (_) { move = null; }
        if (!move) { note = 'That move isn’t legal. No move used.'; selected = null; paint(); return; }
        lastMove = move; selected = null; note = ''; cursor = to;
        persist();
        if (statusOf(game).win) P.win('chess', data.game);
        P.spend('chess');   // saves the position, the move count and any win together
        paint();
        maybeBot();
      }
      async function maybeBot() {
        if (!game || preview || destroyed || thinking || game.turn() !== 'b' || statusOf(game).over) return;
        const eng = engine.state;
        if (eng === 'loading' && !usingFallback) { paintStatus(); return; }      // resumes when Stockfish is ready
        const fen = game.fen(); const gameId = data.game.id; const level = LEVELS[data.prefs.difficulty];
        thinking = true; paintStatus();
        let uci = null;
        if (eng === 'ready') uci = await engine.search(fen, level);
        if (destroyed) return;
        if (!uci && engine.state !== 'ready') { usingFallback = true; await new Promise(r => setTimeout(r, 250)); if (destroyed) return; uci = game.fen() === fen ? fallbackMove(fen, data.prefs.difficulty) : null; }
        thinking = false;
        // Only apply a reply to the exact position and game it was computed for
        if (!uci || data.game.id !== gameId || game.fen() !== fen || game.turn() !== 'b') { paint(); maybeBot(); return; }
        let move = null;
        try { move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) }); } catch (_) { move = null; }
        if (!move) { const alt = fallbackMove(fen, data.prefs.difficulty); try { move = alt && game.move({ from: alt.slice(0, 2), to: alt.slice(2, 4), ...(alt.length > 4 ? { promotion: alt[4] } : {}) }); } catch (_) { move = null; } }
        if (move) { lastMove = move; persist(); P.changed({ type: 'board', game: 'chess' }); }
        paint();
      }
      function onKeys(e) {
        if (!game || promo) return;
        const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
        if (d && e.target.closest && e.target.closest('.ss-chess-board')) {
          e.preventDefault();
          const f = U.clamp(FILES.indexOf(cursor[0]) + d[0], 0, 7), r = U.clamp(Number(cursor[1]) + d[1], 1, 8);
          cursor = FILES[f] + r;
          board.querySelectorAll('.ss-chess-square').forEach(b => { b.tabIndex = b.dataset.sq === cursor ? 0 : -1; });
          board.querySelector(`[data-sq="${cursor}"]`)?.focus();
        } else if (e.key === 'Escape' && selected) { e.preventDefault(); selected = null; note = ''; paint(); }
      }
      const offs = [SS.bus.on('play', e => {
        if (e.type === 'prefs' && e.game === 'chess') { paint(); if (e.key === 'difficulty') maybeBot(); }
        else if (['answer', 'spend', 'game', 'settings'].includes(e.type)) paintStatus();
      })];
      if (!preview) offs.push(K.keys(opts.keyTarget || root, onKeys));
      const boot = () => loadRules().then(() => {
        if (destroyed) return;
        game = new window.Chess();
        const saved = data.game.history;
        let replayed = 0;
        for (const m of saved) { try { const mv = game.move(m); if (!mv) break; lastMove = mv; replayed++; } catch (_) { break; } }
        if (replayed < saved.length) { data.game.history = game.history(); P.save(); note = 'Part of the saved game couldn’t be restored; the board shows the last valid position.'; }
        selected = null;
        paint();
        if (engine) engine.start();
      }).catch(() => {
        if (destroyed) return;
        board.replaceChildren(el('div.ss-chess-error', el('p', { text: 'The chess rules couldn’t load. Check that the vendor folder is next to index.html, then try again.' }), el('button.btn.btn-sm', { type: 'button', text: 'Try again', on: { click: () => { board.replaceChildren(el('p.ss-chess-loading', { text: 'Loading chess rules…' })); boot(); } } })));
        status.textContent = 'Chess rules are unavailable.';
      });
      boot();
      return {
        destroy() { destroyed = true; offs.forEach(off => off()); engine && engine.destroy(); },
        refresh: paintStatus,
        focus: () => (board.querySelector('.ss-chess-square[tabindex="0"]') || board).focus({ preventScroll: true })
      };
    }
  });
  SS.chessTest = { fallbackMove, statusOf, sanitize, createEngine };
})(window.SS);
