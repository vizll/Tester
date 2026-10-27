/* Tester — 2048, Klondike Solitaire and Block Puzzle. Each game keeps its board and preferences in
   SS.play (saved with everything else) and spends one earned move per changed slide, legal card action
   or placed piece. Boards size themselves to the panel they sit in (CSS container units), keyboard input
   only reaches a game while focus is inside its panel, and a finished game is counted as a win once. */
(function (SS) {
  'use strict';
  const P = SS.play;
  if (!P) throw new Error('Tester play state must load before the games.');
  const U = SS.util;
  const { el } = U;
  const K = P.kit;
  const btn = (text, fn, extra = {}) => el('button.btn.btn-sm', { type: 'button', on: { click: fn }, ...extra }, text);
  const shuffle = input => { const a = input.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const num = (v, lo, hi, d) => U.clampNum(v, lo, hi, d);

  /* A mounted game listens for its own preference changes and for the move count changing */
  function lifecycle(id, { draw, paintStatus }) {
    return SS.bus.on('play', e => {
      if (e.type === 'prefs' && e.game === id) draw();
      else if (e.type === 'load') draw();
      else if (['answer', 'spend', 'game', 'settings'].includes(e.type)) paintStatus();
    });
  }

  /* ------------------------------- 2048 ------------------------------- */
  function slide2048(board, n, direction) {
    const next = board.slice(); let score = 0; const mergedAt = [];
    const index = (line, i) => direction === 'left' ? line * n + i : direction === 'right' ? line * n + (n - 1 - i) : direction === 'up' ? i * n + line : (n - 1 - i) * n + line;
    for (let line = 0; line < n; line++) {
      const values = Array.from({ length: n }, (_, i) => board[index(line, i)]).filter(Boolean);
      const merged = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === values[i + 1]) { const v = values[i] * 2; mergedAt.push(index(line, merged.length)); merged.push(v); score += v; i++; }
        else merged.push(values[i]);
      }
      for (let i = 0; i < n; i++) next[index(line, i)] = merged[i] || 0;
    }
    return { board: next, score, changed: next.some((v, i) => v !== board[i]), merged: mergedAt };
  }
  /* Adds a 2 (or sometimes a 4) on a random empty square and returns where, or -1 if the board is full */
  function spawn2048(board, random = Math.random) {
    const empty = board.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    if (!empty.length) return -1;
    const at = empty[Math.floor(random() * empty.length)];
    board[at] = random() < .9 ? 2 : 4;
    return at;
  }
  const moves2048 = (board, n) => ['left', 'right', 'up', 'down'].some(dir => slide2048(board, n, dir).changed);
  function fresh2048(prefs) {
    const n = [4, 5].includes(Number(prefs.size)) ? Number(prefs.size) : 4;
    const goal = [512, 1024, 2048, 4096].includes(Number(prefs.target)) ? Number(prefs.target) : 2048;
    const board = Array(n * n).fill(0); spawn2048(board); spawn2048(board);
    return { id: U.uid('g'), n, goal, board, score: 0, moves: 0, won: false, winCounted: false, over: false };
  }
  const palettes2048 = {
    sunset: ['#f9f0e6', '#f1dfc7', '#efbc8e', '#ed986b', '#eb785b', '#df5a55', '#d7ba5b', '#d0ac45', '#c7972e', '#b98219', '#a96a16', '#8f4e1c'],
    ocean: ['#e7f3f6', '#d1e9ef', '#a8d8e5', '#7bc3db', '#55a9d0', '#398fc0', '#3475af', '#415eaa', '#5e4f9e', '#79458f', '#8d3d78', '#a13b62'],
    garden: ['#eaf1e7', '#dce8d2', '#c4dcb0', '#a5ce92', '#83bd7b', '#62a86b', '#488e61', '#327959', '#22644f', '#185546', '#10463d', '#093b35'],
    candy: ['#fce8f5', '#f7d2ed', '#edb7e6', '#d99bdd', '#be84d4', '#9f71ca', '#805ebd', '#6852ad', '#5351a5', '#3d5b9e', '#2d6899', '#25788e']
  };
  const prefs2048 = { size: 4, target: 2048, palette: 'sunset', boardColor: '#b8a99a', gap: 8, rounded: true };
  function sanitize2048(data) {
    const p = { ...prefs2048, ...(U.isObj(data.prefs) ? data.prefs : {}) };
    const out = { prefs: { size: [4, 5].includes(+p.size) ? +p.size : 4, target: [512, 1024, 2048, 4096].includes(+p.target) ? +p.target : 2048, palette: palettes2048[p.palette] ? p.palette : 'sunset', boardColor: U.hex(p.boardColor, prefs2048.boardColor), gap: num(p.gap, 3, 16, 8), rounded: p.rounded !== false } };
    const g = data.game;
    if (U.isObj(g) && [4, 5].includes(g.n) && Array.isArray(g.board) && g.board.length === g.n * g.n && g.board.every(v => v === 0 || (isInt(v, 2, 1 << 20) && (v & (v - 1)) === 0))) {
      out.game = { id: typeof g.id === 'string' ? g.id.slice(0, 40) : U.uid('g'), n: g.n, goal: [512, 1024, 2048, 4096].includes(g.goal) ? g.goal : 2048, board: g.board.slice(), score: num(g.score, 0, 1e12, 0), moves: num(g.moves, 0, 1e9, 0), won: !!g.won, winCounted: g.winCounted === undefined ? !!g.won : !!g.winCounted, over: !!g.over };
    }
    return out;
  }
  P.register('2048', {
    title: '2048', icon: '🔢', description: 'Merge matching tiles to reach the target tile.',
    rules: 'Each slide that changes the board uses one move. Slides that change nothing are free.',
    sanitize: sanitize2048,
    settings(id = '2048') {
      const p = P.data(id).prefs || prefs2048; const set = (k, v) => K.setPref(id, k, v);
      return [
        K.field('Tile palette', K.select('2048 tile palette', Object.keys(palettes2048).map(x => [x, x[0].toUpperCase() + x.slice(1)]), p.palette, v => set('palette', v))),
        K.field('Board colour', K.color('2048 board colour', p.boardColor, v => set('boardColor', v))),
        K.field('Tile spacing', K.range('2048 tile spacing', 3, 16, p.gap, v => set('gap', v))),
        K.field('Rounded tiles', K.toggle('Rounded 2048 tiles', p.rounded, v => set('rounded', v))),
        K.field('Board size', K.select('2048 board size', [[4, '4 × 4 — Classic'], [5, '5 × 5 — Roomy']], p.size, v => set('size', +v)), 'Applies to your next new game.'),
        K.field('Winning tile', K.select('2048 winning tile', [[512, '512 — Quick'], [1024, '1024'], [2048, '2048 — Classic'], [4096, '4096 — Challenge']], p.target, v => set('target', +v)), 'Applies to your next new game.')
      ];
    },
    summary: data => (data.game ? `${data.game.score.toLocaleString()} points · best tile ${Math.max(...data.game.board)}${data.game.won ? ' · won' : data.game.over ? ' · no moves left' : ''}` : 'Not started'),
    mount(host, opts = {}) {
      const data = P.data('2048');
      Object.assign(data, sanitize2048(data));
      if (!data.game) data.game = fresh2048(data.prefs);
      let message = '', anim = null;   // anim: { spawned, merged, dir } for the slide that was just made
      const g = () => data.game;
      const score = el('div.ag-score'); const status = el('p.ag-status', { attrs: { 'aria-live': 'polite' } });
      const board = el('div.ag-2048-board', { tabIndex: opts.preview ? -1 : 0, role: 'group', aria: { label: '2048 board. Use the arrow keys, swipe, or the direction buttons.' } });
      const pad = el('div.ag-direction-pad', { role: 'group', aria: { label: 'Slide tiles' } },
        btn('↑', () => move('up'), { aria: { label: 'Slide tiles up' } }),
        el('div', btn('←', () => move('left'), { aria: { label: 'Slide tiles left' } }), btn('↓', () => move('down'), { aria: { label: 'Slide tiles down' } }), btn('→', () => move('right'), { aria: { label: 'Slide tiles right' } })));
      const fresh = btn('New game', async () => { if (!(await K.confirmNew(g().moves))) return; data.game = fresh2048(data.prefs); message = ''; P.changed({ type: 'board', game: '2048' }); draw(); });
      const root = el('div.ag-game.ag-2048', { class: opts.preview ? 'ag-preview' : '' }, el('div.ag-top', score, status), el('div.ag-stage', board), opts.preview ? null : el('div.ag-controls', pad, fresh));
      host.replaceChildren(root);
      function draw() {
        const p = data.prefs; const colors = palettes2048[p.palette] || palettes2048.sunset;
        board.style.setProperty('--n', g().n); board.style.setProperty('--gap', `${p.gap}px`);
        board.style.background = p.boardColor;
        board.style.setProperty('--ag-tile-radius', p.rounded ? '9px' : '0px');
        const a = anim; anim = null;
        if (a) { board.dataset.nudge = a.dir; board.classList.remove('ag-nudge'); void board.offsetWidth; board.classList.add('ag-nudge'); }
        board.replaceChildren(...g().board.map((v, i) => {
          const level = v ? Math.log2(v) - 1 : -1;
          return el('div.ag-2048-cell', { role: 'img', text: v || '', class: a && v ? (i === a.spawned ? 'ag-spawn' : a.merged.includes(i) ? 'ag-merge' : '') : '', style: { background: v ? colors[Math.min(level, colors.length - 1)] : 'rgba(255,255,255,.2)', color: v && level >= 3 ? '#fff' : '#28333d', '--digits': String(String(v || '').length || 1) }, aria: { label: `Row ${Math.floor(i / g().n) + 1}, column ${i % g().n + 1}: ${v || 'empty'}` } });
        }));
        score.replaceChildren(el('span', { text: `Score ${g().score.toLocaleString()}` }), el('span', { text: `Target ${g().goal}` }), el('span', { text: U.plural(g().moves, 'slide') }));
        paintStatus();
      }
      function paintStatus() {
        const has = P.actions('2048') > 0;
        status.textContent = message || (g().over ? 'No moves left on the board. Start a new game to try again.' : g().won ? `You reached ${g().goal}! Keep merging if you like.` : has ? `Slide the tiles — ${K.movesLabel('2048').toLowerCase()}.` : K.noMoves('2048'));
        status.classList.toggle('ag-blocked', !has && !g().over);
        pad.querySelectorAll('button').forEach(b => { b.disabled = !has || g().over; });
      }
      function move(direction) {
        message = '';
        if (g().over) { paintStatus(); return; }
        const result = slide2048(g().board, g().n, direction);
        if (!result.changed) { message = 'Nothing can slide that way. No move used.'; paintStatus(); return; }
        if (!P.actions('2048')) { message = K.noMoves('2048'); paintStatus(); return; }
        const game = g();
        game.board = result.board; game.score += result.score; game.moves++;
        anim = { spawned: spawn2048(game.board), merged: result.merged, dir: direction };
        game.over = !moves2048(game.board, game.n);
        if (!game.won && Math.max(...game.board) >= game.goal) { game.won = true; message = `You reached ${game.goal}! That’s a 2048 win.`; P.win('2048', game); }
        P.spend('2048');   // saves the board, the move count and any win together
        draw();
      }
      const offs = [lifecycle('2048', { draw, paintStatus })];
      if (!opts.preview) {
        let touch = null;
        board.addEventListener('pointerdown', e => { touch = [e.clientX, e.clientY]; board.setPointerCapture?.(e.pointerId); });
        board.addEventListener('pointerup', e => { if (!touch) return; const dx = e.clientX - touch[0], dy = e.clientY - touch[1]; touch = null; if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); });
        board.addEventListener('pointercancel', () => { touch = null; });
        offs.push(K.keys(opts.keyTarget || root, e => { const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (dir) { e.preventDefault(); move(dir); } }));
      }
      draw();
      return { destroy: () => offs.forEach(off => off()), refresh: paintStatus, focus: () => board.focus({ preventScroll: true }) };
    }
  });

  /* ------------------------- Klondike solitaire ------------------------- */
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
  const rank = card => card % 13 + 1;
  const suit = card => Math.floor(card / 13);
  const red = card => [1, 2].includes(suit(card));
  const rankLabel = card => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank(card)] || String(rank(card)));
  const cardLabel = card => `${({ 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' }[rank(card)] || rank(card))} of ${SUIT_NAMES[suit(card)]}`;
  function freshSolitaire() {
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => i));
    const tableau = Array.from({ length: 7 }, (_, col) => Array.from({ length: col + 1 }, (_, i) => ({ card: deck.pop(), up: i === col })));
    return { id: U.uid('g'), stock: deck, waste: [], foundations: [[], [], [], []], tableau, moves: 0, won: false, winCounted: false, recycled: 0 };
  }
  function solSource(g, selection) {
    if (!selection) return [];
    if (selection.kind === 'waste') return g.waste.length ? [g.waste[g.waste.length - 1]] : [];
    if (selection.kind === 'foundation') { const f = g.foundations[selection.pile]; return f?.length ? [f[f.length - 1]] : []; }
    if (selection.kind === 'tableau') {
      const tail = g.tableau[selection.pile]?.slice(selection.index) || [];
      if (!tail.length || tail.some(x => !x.up)) return [];
      for (let i = 1; i < tail.length; i++) if (rank(tail[i - 1].card) !== rank(tail[i].card) + 1 || red(tail[i - 1].card) === red(tail[i].card)) return [];
      return tail.map(x => x.card);
    }
    return [];
  }
  function solCanTableau(g, selection, target) {
    if (selection?.kind === 'tableau' && selection.pile === target) return false;
    const cards = solSource(g, selection); if (!cards.length) return false;
    const pile = g.tableau[target]; if (!pile) return false;
    if (!pile.length) return rank(cards[0]) === 13;
    const top = pile[pile.length - 1];
    return top.up && red(top.card) !== red(cards[0]) && rank(top.card) === rank(cards[0]) + 1;
  }
  function solCanFoundation(g, selection, target) {
    if (selection?.kind === 'foundation' && selection.pile === target) return false;
    const cards = solSource(g, selection); if (cards.length !== 1) return false;
    return suit(cards[0]) === target && rank(cards[0]) === g.foundations[target].length + 1;
  }
  function solRemove(g, selection) {
    if (selection.kind === 'waste') return [g.waste.pop()];
    if (selection.kind === 'foundation') return [g.foundations[selection.pile].pop()];
    const pile = g.tableau[selection.pile]; const cards = pile.splice(selection.index).map(x => x.card);
    if (pile.length) pile[pile.length - 1].up = true;
    return cards;
  }
  function solMove(g, selection, kind, target) {
    const valid = kind === 'tableau' ? solCanTableau(g, selection, target) : solCanFoundation(g, selection, target);
    if (!valid) return false;
    const cards = solRemove(g, selection);
    if (kind === 'tableau') g.tableau[target].push(...cards.map(card => ({ card, up: true })));
    else g.foundations[target].push(...cards);
    g.moves++; return true;
  }
  function solDraw(g, drawCount) {
    if (g.stock.length) { for (let i = 0; i < drawCount && g.stock.length; i++) g.waste.push(g.stock.pop()); }
    else if (g.waste.length) { g.stock = g.waste.slice().reverse(); g.waste = []; g.recycled++; }
    else return false;
    g.moves++; return true;
  }
  function solHint(g) {
    const sources = [];
    if (g.waste.length) sources.push({ kind: 'waste' });
    g.tableau.forEach((pile, col) => pile.forEach((entry, index) => { if (entry.up) sources.push({ kind: 'tableau', pile: col, index }); }));
    for (const source of sources) {
      const cards = solSource(g, source); if (!cards.length) continue;
      for (let f = 0; f < 4; f++) if (solCanFoundation(g, source, f)) return { source, kind: 'foundation', target: f };
    }
    for (const source of sources) for (let col = 0; col < 7; col++) {
      if (source.kind === 'tableau' && source.index === 0 && !g.tableau[col].length) continue;
      if (solCanTableau(g, source, col)) return { source, kind: 'tableau', target: col };
    }
    return null;
  }
  const prefsSol = { drawCount: 1, tableColor: '#1c6558', cardBack: '#3454a1', cardFace: '#fffdf5', redColor: '#c23952', blackColor: '#202b35', pattern: 'diamonds', cardFont: 'classic' };
  function sanitizeSolitaire(data) {
    const p = { ...prefsSol, ...(U.isObj(data.prefs) ? data.prefs : {}) };
    const out = { prefs: { drawCount: +p.drawCount === 3 ? 3 : 1, tableColor: U.hex(p.tableColor, prefsSol.tableColor), cardBack: U.hex(p.cardBack, prefsSol.cardBack), cardFace: U.hex(p.cardFace, prefsSol.cardFace), redColor: U.hex(p.redColor, prefsSol.redColor), blackColor: U.hex(p.blackColor, prefsSol.blackColor), pattern: ['diamonds', 'stripes', 'solid'].includes(p.pattern) ? p.pattern : 'diamonds', cardFont: p.cardFont === 'modern' ? 'modern' : 'classic' } };
    const g = data.game;
    // a saved deal must contain each of the 52 cards exactly once, in valid piles
    const ok = U.isObj(g) && Array.isArray(g.stock) && Array.isArray(g.waste) && Array.isArray(g.foundations) && g.foundations.length === 4 && Array.isArray(g.tableau) && g.tableau.length === 7
      && g.tableau.every(pile => Array.isArray(pile) && pile.every(x => U.isObj(x) && isInt(x.card, 0, 51))) && g.foundations.every(Array.isArray);
    if (ok) {
      const all = [...g.stock, ...g.waste, ...g.foundations.flat(), ...g.tableau.flat().map(x => x.card)];
      if (all.length === 52 && new Set(all).size === 52 && all.every(c => isInt(c, 0, 51)) && g.foundations.every((f, s) => f.every((c, i) => suit(c) === s && rank(c) === i + 1))) {
        out.game = { id: typeof g.id === 'string' ? g.id.slice(0, 40) : U.uid('g'), stock: g.stock.slice(), waste: g.waste.slice(), foundations: g.foundations.map(f => f.slice()), tableau: g.tableau.map(pile => pile.map(x => ({ card: x.card, up: !!x.up }))), moves: num(g.moves, 0, 1e9, 0), recycled: num(g.recycled, 0, 1e9, 0), won: !!g.won, winCounted: g.winCounted === undefined ? !!g.won : !!g.winCounted };
      }
    }
    return out;
  }
  P.register('solitaire', {
    title: 'Solitaire', icon: '🃏', description: 'Classic Klondike: build the four foundations from Ace to King.',
    rules: 'Each legal card move, stock draw or recycle uses one move. Selecting cards and illegal moves are free.',
    sanitize: sanitizeSolitaire,
    settings(id = 'solitaire') {
      const p = P.data(id).prefs || prefsSol; const set = (k, v) => K.setPref(id, k, v);
      return [
        K.field('Draw rule', K.select('Solitaire draw rule', [[1, 'Draw one — classic easy'], [3, 'Draw three — challenge']], p.drawCount, v => set('drawCount', +v))),
        K.field('Table colour', K.color('Solitaire table colour', p.tableColor, v => set('tableColor', v))),
        K.field('Card backs', K.color('Solitaire card back colour', p.cardBack, v => set('cardBack', v))),
        K.field('Card face', K.color('Solitaire card face colour', p.cardFace, v => set('cardFace', v))),
        K.field('Red suits', K.color('Solitaire red suit colour', p.redColor, v => set('redColor', v))),
        K.field('Black suits', K.color('Solitaire black suit colour', p.blackColor, v => set('blackColor', v))),
        K.field('Back pattern', K.select('Solitaire card back pattern', [['diamonds', 'Diamond lattice'], ['stripes', 'Fine stripes'], ['solid', 'Solid colour']], p.pattern, v => set('pattern', v))),
        K.field('Card lettering', K.select('Solitaire card lettering', [['classic', 'Classic serif'], ['modern', 'Modern sans-serif']], p.cardFont, v => set('cardFont', v)))
      ];
    },
    summary: data => (data.game ? `${data.game.foundations.reduce((n, f) => n + f.length, 0)}/52 cards home · ${U.plural(data.game.moves, 'move')}${data.game.won ? ' · won' : ''}` : 'Not started'),
    mount(host, opts = {}) {
      const data = P.data('solitaire');
      Object.assign(data, sanitizeSolitaire(data));
      if (!data.game) data.game = freshSolitaire();
      const g = () => data.game;
      let selected = null, message = '', arrived = new Set(), flipped = -1;   // cards that just moved, for the arrival animation
      const board = el('div.ag-sol-board', { role: 'group', aria: { label: 'Klondike solitaire table' } });
      const status = el('p.ag-status', { attrs: { 'aria-live': 'polite' } }), score = el('div.ag-score');
      const clear = btn('Clear selection', () => { selected = null; message = ''; draw(); });
      const hint = btn('Hint', () => {
        const result = solHint(g());
        if (result) { selected = result.source; message = `${cardLabel(solSource(g(), selected)[0])}: move ${result.kind === 'foundation' ? 'to the ' + SUIT_NAMES[result.target] + ' foundation' : 'to column ' + (result.target + 1)}.`; }
        else message = g().stock.length ? 'Draw from the stock to reveal another card.' : g().waste.length ? 'Try recycling the waste pile, or moving a foundation card back to the table.' : 'No obvious move remains. You can start a new deal.';
        draw();
      });
      const foundation = btn('To foundation', () => {
        if (!selected) { message = 'Select an exposed card first.'; draw(); return; }
        const cards = solSource(g(), selected);
        if (cards.length === 1 && solCanFoundation(g(), selected, suit(cards[0]))) act('foundation', suit(cards[0]));
        else { message = 'That selection can’t move to a foundation yet. No move used.'; draw(); }
      });
      const fresh = btn('New deal', async () => { if (!(await K.confirmNew(g().moves))) return; data.game = freshSolitaire(); selected = null; message = ''; P.changed({ type: 'board', game: 'solitaire' }); draw(); });
      const root = el('div.ag-game.ag-solitaire', { class: opts.preview ? 'ag-preview' : '' }, el('div.ag-top', score, status), el('div.ag-stage.ag-sol-stage', board), opts.preview ? null : el('div.ag-controls', clear, foundation, hint, fresh));
      host.replaceChildren(root);
      const isSel = selection => selected && selected.kind === selection.kind && selected.pile === selection.pile && (selection.kind !== 'tableau' || selection.index >= selected.index);
      function cardNode(card, faceUp, selection, extra = {}) {
        const on = faceUp && isSel(selection);
        const motion = faceUp ? (card === flipped ? ' ag-flip' : arrived.has(card) ? ' ag-arrive' : '') : '';
        const node = el('button.ag-card', { type: 'button', class: `${faceUp ? 'ag-face' : 'ag-back'}${on ? ' ag-selected' : ''}${motion}`, tabIndex: faceUp && !opts.preview ? 0 : -1, aria: { label: faceUp ? cardLabel(card) + (on ? ', selected' : '') : 'Face-down card', pressed: faceUp ? String(!!on) : null, disabled: faceUp ? null : 'true' }, style: faceUp ? { color: red(card) ? data.prefs.redColor : data.prefs.blackColor } : {}, dataset: { k: selection.kind + (selection.pile ?? '') + '-' + (selection.index ?? '') }, ...extra });
        if (faceUp) node.append(el('span.ag-card-corner', { text: rankLabel(card) + SUITS[suit(card)] }), el('span.ag-card-suit', { text: SUITS[suit(card)], aria: { hidden: 'true' } }));
        else node.append(el('span', { text: '✦', aria: { hidden: 'true' } }));
        return node;
      }
      function draw() {
        const focusKey = document.activeElement && board.contains(document.activeElement) ? document.activeElement.dataset.k : null;
        const p = data.prefs;
        board.style.setProperty('--ag-table', p.tableColor); board.style.setProperty('--ag-card-back', p.cardBack);
        board.style.setProperty('--ag-card-face', p.cardFace);
        board.style.setProperty('--ag-card-font', p.cardFont === 'modern' ? 'var(--font-body, sans-serif)' : 'Georgia, serif');
        board.dataset.pattern = p.pattern;
        board.style.setProperty('--rows', String(Math.max(1, ...g().tableau.map(pile => pile.length))));
        const upper = el('div.ag-sol-upper');
        const stock = el('button.ag-card.ag-stock', { type: 'button', class: g().stock.length ? 'ag-back' : 'ag-sol-empty', tabIndex: opts.preview ? -1 : 0, dataset: { k: 'stock' }, aria: { label: g().stock.length ? `Draw ${p.drawCount} from the stock, ${g().stock.length} cards left` : g().waste.length ? 'Recycle the waste into the stock' : 'Stock empty' }, on: { click: () => {
          if (!g().stock.length && !g().waste.length) { message = 'The stock and waste are empty. No move used.'; draw(); return; }
          if (!P.actions('solitaire')) { message = K.noMoves('solitaire'); draw(); return; }
          solDraw(g(), p.drawCount === 3 ? 3 : 1); selected = null; message = '';
          flipped = g().waste.length ? g().waste[g().waste.length - 1] : -1;
          P.spend('solitaire'); draw();
        } } }, el('span', { text: g().stock.length ? '✦' : '↻', aria: { hidden: 'true' } }), el('small', { text: g().stock.length ? String(g().stock.length) : 'Recycle' }));
        upper.append(stock);
        if (g().waste.length) {
          const c = g().waste[g().waste.length - 1];
          const node = cardNode(c, true, { kind: 'waste' }, { on: { click: () => { selected = selected?.kind === 'waste' ? null : { kind: 'waste' }; message = ''; draw(); }, dblclick: () => { selected = { kind: 'waste' }; act('foundation', suit(c)); } } });
          node.append(el('small.ag-card-count', { text: String(g().waste.length) })); upper.append(node);
        } else upper.append(el('div.ag-card.ag-sol-empty', { text: 'Waste', aria: { label: 'Waste empty' } }));
        upper.append(el('div.ag-sol-spacer'));
        g().foundations.forEach((pile, f) => {
          const onClick = () => {
            if (selected) { if (selected.kind === 'foundation' && selected.pile === f) { selected = null; message = ''; draw(); } else act('foundation', f); }
            else if (pile.length) { selected = { kind: 'foundation', pile: f }; message = ''; draw(); }
            else { message = `Place the Ace of ${SUIT_NAMES[f]} here.`; draw(); }
          };
          let node;
          if (pile.length) { node = cardNode(pile[pile.length - 1], true, { kind: 'foundation', pile: f }, { on: { click: onClick } }); node.append(el('small.ag-card-count', { text: `${pile.length}/13` })); }
          else node = el('button.ag-card.ag-sol-empty.ag-foundation-empty', { type: 'button', text: SUITS[f], tabIndex: opts.preview ? -1 : 0, dataset: { k: 'f' + f }, aria: { label: `${SUIT_NAMES[f]} foundation, empty` }, on: { click: onClick } });
          upper.append(node);
        });
        const columns = el('div.ag-sol-columns');
        g().tableau.forEach((pile, col) => {
          const column = el('div.ag-sol-column', { role: 'group', aria: { label: `Column ${col + 1}` }, on: { click: e => { if (e.target === column && selected) act('tableau', col); } } });
          if (!pile.length) column.append(el('button.ag-card.ag-sol-empty', { type: 'button', text: 'K', tabIndex: opts.preview ? -1 : 0, dataset: { k: 'e' + col }, aria: { label: `Empty column ${col + 1}, Kings only` }, on: { click: () => act('tableau', col) } }));
          let offset = 0;
          pile.forEach((entry, index) => {
            const source = { kind: 'tableau', pile: col, index };
            const node = cardNode(entry.card, entry.up, source, { style: { '--y': String(offset), color: red(entry.card) ? p.redColor : p.blackColor }, on: { click: e => {
              e.stopPropagation();
              if (selected && !(selected.kind === 'tableau' && selected.pile === col)) { act('tableau', col); return; }
              if (!entry.up) return;
              selected = selected?.kind === 'tableau' && selected.pile === col && selected.index === index ? null : source; message = ''; draw();
            }, dblclick: e => { e.stopPropagation(); if (entry.up && index === pile.length - 1) { selected = source; act('foundation', suit(entry.card)); } } } });
            offset += entry.up ? 1 : 0.45;
            column.append(node);
          });
          column.style.setProperty('--fan', String(Math.max(0, offset - (pile.length && pile[pile.length - 1].up ? 1 : 0.45))));
          columns.append(column);
        });
        board.replaceChildren(upper, columns);
        const total = g().foundations.reduce((n, pile) => n + pile.length, 0);
        score.replaceChildren(el('span', { text: `${total}/52 home` }), el('span', { text: U.plural(g().moves, 'move') }), el('span', { text: `Draw ${p.drawCount}` }));
        if (focusKey) board.querySelector(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
        arrived = new Set(); flipped = -1;
        paintStatus();
      }
      function paintStatus() {
        const has = P.actions('solitaire') > 0;
        clear.disabled = !selected; foundation.disabled = !selected || !has;
        status.textContent = message || (g().won ? 'All four foundations are complete — Solitaire won!' : !has ? K.noMoves('solitaire') : selected ? `Selected ${cardLabel(solSource(g(), selected)[0])}. Choose where it goes.` : 'Choose a card, or draw from the stock.');
        status.classList.toggle('ag-blocked', !has && !g().won);
      }
      function act(kind, target) {
        if (!selected) { message = 'Select a face-up card or stack first.'; draw(); return; }
        const valid = kind === 'tableau' ? solCanTableau(g(), selected, target) : solCanFoundation(g(), selected, target);
        if (!valid) { message = 'That move isn’t legal. Try another place. No move used.'; draw(); return; }
        if (!P.actions('solitaire')) { message = K.noMoves('solitaire'); draw(); return; }
        const game = g();
        arrived = new Set(solSource(game, selected));
        solMove(game, selected, kind, target); selected = null; message = '';
        if (!game.won && game.foundations.every(pile => pile.length === 13)) { game.won = true; message = 'You completed Solitaire — that’s a win!'; P.win('solitaire', game); }
        P.spend('solitaire'); draw();
      }
      const offs = [lifecycle('solitaire', { draw, paintStatus })];
      if (!opts.preview) offs.push(K.keys(opts.keyTarget || root, e => { if (e.key === 'Escape' && selected) { e.preventDefault(); selected = null; message = ''; draw(); } }));
      draw();
      return { destroy: () => offs.forEach(off => off()), refresh: paintStatus, focus: () => (board.querySelector('.ag-sol-columns .ag-face') || board.querySelector('.ag-stock'))?.focus({ preventScroll: true }) };
    }
  });

  /* ---------------------------- Block Puzzle ---------------------------- */
  /* An 8 × 8 board and a tray of three pieces. Drag a piece onto the board — an outline shows exactly where
     it will land (red when it doesn't fit) and the rows and columns it would clear light up — or pick a
     piece with 1–3 or a tap and place it with the arrow keys and Enter, a click, or a second tap. Full rows
     and columns clear together. Each placed piece uses one move; a drop that doesn't fit is free. */
  const BB = 8;
  const BB_BASE = {
    dot: { rows: ['#'], weight: 1.5 },
    i2: { rows: ['##'], weight: 3.5 }, i3: { rows: ['###'], weight: 4 }, i4: { rows: ['####'], weight: 3 }, i5: { rows: ['#####'], weight: 2 },
    o2: { rows: ['##', '##'], weight: 4 }, o3: { rows: ['###', '###', '###'], weight: 1.5 }, r6: { rows: ['###', '###'], weight: 2 },
    v3: { rows: ['#.', '##'], weight: 4 }, v5: { rows: ['#..', '#..', '###'], weight: 2 },
    l4: { rows: ['#.', '#.', '##'], weight: 2.5 }, j4: { rows: ['.#', '.#', '##'], weight: 2.5 },
    t4: { rows: ['###', '.#.'], weight: 3 }, s4: { rows: ['.##', '##.'], weight: 2 }, z4: { rows: ['##.', '.##'], weight: 2 }
  };
  // every distinct quarter-turn of each base shape: id → { base, cells: [[row, col]…], h, w }
  const BB_SHAPES = {}, BB_TURNS = {};
  Object.entries(BB_BASE).forEach(([base, def]) => {
    let cells = [];
    def.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
    const seen = new Set(); BB_TURNS[base] = [];
    for (let turn = 0; turn < 4; turn++) {
      const h = Math.max(...cells.map(x => x[0])) + 1, w = Math.max(...cells.map(x => x[1])) + 1;
      const key = cells.map(x => x.join(',')).sort().join(' ');
      if (!seen.has(key)) { seen.add(key); BB_SHAPES[`${base}-${turn}`] = { base, cells: cells.map(x => x.slice()), h, w }; BB_TURNS[base].push(`${base}-${turn}`); }
      cells = cells.map(([r, c]) => [c, h - 1 - r]);   // a quarter turn clockwise
    }
  });
  const BB_WEIGHT = Object.values(BB_BASE).reduce((n, d) => n + d.weight, 0);
  function bbRandomPiece(random = Math.random) {
    let x = random() * BB_WEIGHT, base = 'dot';
    for (const [id, d] of Object.entries(BB_BASE)) { x -= d.weight; if (x < 0) { base = id; break; } }
    const turns = BB_TURNS[base];
    return { shape: turns[Math.floor(random() * turns.length)], color: 1 + Math.floor(random() * 7) };
  }
  function bbFits(board, shapeId, r, c) {
    const s = BB_SHAPES[shapeId]; if (!s) return false;
    return s.cells.every(([dr, dc]) => { const y = r + dr, x = c + dc; return y >= 0 && y < BB && x >= 0 && x < BB && !board[y * BB + x]; });
  }
  function bbSpots(board, shapeId, first = false) {
    const s = BB_SHAPES[shapeId], out = []; if (!s) return out;
    for (let r = 0; r <= BB - s.h; r++) for (let c = 0; c <= BB - s.w; c++) if (bbFits(board, shapeId, r, c)) { out.push([r, c]); if (first) return out; }
    return out;
  }
  const bbCanPlace = (board, shapeId) => bbSpots(board, shapeId, true).length > 0;
  const bbAnyFit = (board, tray) => tray.some(p => p && bbCanPlace(board, p.shape));
  /* Place a piece; full rows and columns (counted after placing) clear together */
  function bbPlace(board, shapeId, r, c, color) {
    const s = BB_SHAPES[shapeId]; const next = board.slice();
    const placed = s.cells.map(([dr, dc]) => (r + dr) * BB + c + dc);
    placed.forEach(i => { next[i] = color; });
    const rows = [], cols = [];
    for (let i = 0; i < BB; i++) {
      let row = true, col = true;
      for (let j = 0; j < BB; j++) { if (!next[i * BB + j]) row = false; if (!next[j * BB + i]) col = false; }
      if (row) rows.push(i); if (col) cols.push(i);
    }
    const before = next.slice(), cleared = new Set();
    rows.forEach(y => { for (let x = 0; x < BB; x++) cleared.add(y * BB + x); });
    cols.forEach(x => { for (let y = 0; y < BB; y++) cleared.add(y * BB + x); });
    cleared.forEach(i => { next[i] = 0; });
    return { board: next, before, placed, cleared: [...cleared], rows, cols, lines: rows.length + cols.length };
  }
  /* 10 points a block; clearing n lines at once is worth 100 × (1 + 2 + … + n), boosted by back-to-back clears */
  const bbScore = (blocks, lines, streak) => blocks * 10 + (lines ? Math.round(50 * lines * (lines + 1) * (1 + 0.5 * Math.max(0, streak - 1))) : 0);
  /* Three new pieces, at least one of which fits whenever anything can */
  function bbDeal(board, random = Math.random) {
    let tray = null;
    for (let attempt = 0; attempt < 40; attempt++) { tray = [0, 1, 2].map(() => bbRandomPiece(random)); if (bbAnyFit(board, tray)) return tray; }
    if (board.some(v => !v)) tray[0] = { shape: 'dot-0', color: tray[0].color };
    return tray;
  }
  const BB_TARGETS = [1500, 3000, 6000, 12000];
  function freshBlocks(prefs, random = Math.random) {
    const board = Array(BB * BB).fill(0);
    return { id: U.uid('g'), board, tray: bbDeal(board, random), score: 0, lines: 0, streak: 0, moves: 0, won: false, winCounted: false, over: false, goal: BB_TARGETS.includes(+prefs.target) ? +prefs.target : 3000 };
  }
  const blockPalettes = {
    classic: ['#ff5b6e', '#ff9b3d', '#ffd23f', '#3fd27f', '#2ec4f1', '#5b7cff', '#b46cff'],
    jewel: ['#d7263d', '#f46036', '#f2c14e', '#1b998b', '#2e86ab', '#3d5a80', '#8e44ad'],
    pastel: ['#f3b6c1', '#ffd0a3', '#f8eaaa', '#bee7bd', '#b2e9ec', '#b7cdf5', '#d9bfed'],
    neon: ['#ff457d', '#ff9515', '#fff500', '#58ff47', '#00f5ff', '#5371ff', '#db45ff'],
    mono: ['#d8e7ef', '#bfd4df', '#a5c1d0', '#8bafc1', '#719eb2', '#58899e', '#40758b']
  };
  const prefsBlocks = { target: 3000, palette: 'classic', boardColor: '#1b2747', grid: true, ghost: true, clearHint: true, squareBlocks: false };
  function sanitizeBlocks(data) {
    const p = { ...prefsBlocks, ...(U.isObj(data.prefs) ? data.prefs : {}) };
    const out = { prefs: { target: BB_TARGETS.includes(+p.target) ? +p.target : 3000, palette: blockPalettes[p.palette] ? p.palette : 'classic', boardColor: U.hex(p.boardColor, prefsBlocks.boardColor), grid: p.grid !== false, ghost: p.ghost !== false, clearHint: p.clearHint !== false, squareBlocks: !!p.squareBlocks }, best: num(data.best, 0, 1e12, 0) };
    const g = data.game;
    const pieceOk = x => x === null || (U.isObj(x) && Object.prototype.hasOwnProperty.call(BB_SHAPES, x.shape) && isInt(x.color, 1, 7));
    if (U.isObj(g) && Array.isArray(g.board) && g.board.length === BB * BB && g.board.every(v => isInt(v, 0, 7)) && Array.isArray(g.tray) && g.tray.length === 3 && g.tray.every(pieceOk)) {
      const game = { id: typeof g.id === 'string' ? g.id.slice(0, 40) : U.uid('g'), board: g.board.slice(), tray: g.tray.map(x => x && { shape: x.shape, color: x.color }), score: num(g.score, 0, 1e12, 0), lines: num(g.lines, 0, 1e9, 0), streak: num(g.streak, 0, 1e6, 0), moves: num(g.moves, 0, 1e9, 0), won: !!g.won, winCounted: g.winCounted === undefined ? !!g.won : !!g.winCounted, over: false, goal: BB_TARGETS.includes(g.goal) ? g.goal : 3000 };
      if (game.tray.every(x => !x)) game.tray = bbDeal(game.board);
      game.over = !bbAnyFit(game.board, game.tray);
      out.game = game;
      out.best = Math.max(out.best, game.score);
    }
    return out;
  }
  const shapeWords = s => `${U.plural(s.cells.length, 'block')}, ${s.w} wide and ${s.h} tall`;
  P.register('blocks', {
    title: 'Block Puzzle', icon: '🟦', description: 'Drag pieces onto an 8 × 8 board and clear full rows and columns.',
    rules: 'Placing a piece uses one move. Picking pieces up, previewing and drops that don’t fit are free. Full rows and columns clear together, and the game ends when no piece in the tray fits.',
    sanitize: sanitizeBlocks,
    settings(id = 'blocks') {
      const p = P.data(id).prefs || prefsBlocks; const set = (k, v) => K.setPref(id, k, v);
      return [
        K.field('Block colours', K.select('Block Puzzle colours', Object.keys(blockPalettes).map(x => [x, x[0].toUpperCase() + x.slice(1)]), p.palette, v => set('palette', v))),
        K.field('Board colour', K.color('Block Puzzle board colour', p.boardColor, v => set('boardColor', v))),
        K.field('Drop outline', K.toggle('Outline where a dragged piece will land', p.ghost, v => set('ghost', v)), 'Red when the piece won’t fit.'),
        K.field('Clear preview', K.toggle('Light up the rows and columns a drop will clear', p.clearHint, v => set('clearHint', v))),
        K.field('Empty squares', K.toggle('Show the empty squares on the Block Puzzle board', p.grid, v => set('grid', v))),
        K.field('Square block corners', K.toggle('Square Block Puzzle block corners', p.squareBlocks, v => set('squareBlocks', v))),
        K.field('Score target', K.select('Block Puzzle score target', [[1500, '1,500 — quick'], [3000, '3,000 — classic'], [6000, '6,000'], [12000, '12,000 — marathon']], p.target, v => set('target', +v)), 'Applies to your next new game.')
      ];
    },
    summary: data => (data.game ? `${data.game.score.toLocaleString()} points · ${U.plural(data.game.lines, 'line')} cleared${data.game.won ? ' · won' : data.game.over ? ' · no room left' : ''}` : 'Not started'),
    mount(host, opts = {}) {
      const data = P.data('blocks');
      Object.assign(data, sanitizeBlocks(data));
      if (!data.game) data.game = freshBlocks(data.prefs);
      const g = () => data.game;
      const preview = !!opts.preview;
      let message = '', selected = null, cursor = { r: 0, c: 0 }, drag = null, hover = null, ghostKey = '', fresh = new Set(), lastPointer = 'mouse';
      const timers = new Set();
      const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
      const palette = () => blockPalettes[data.prefs.palette] || blockPalettes.classic;
      const score = el('div.ag-score'), status = el('p.ag-status', { attrs: { 'aria-live': 'polite' } });
      const board = el('div.ag-bb-board', { tabIndex: preview ? -1 : 0, role: 'group', aria: { label: 'Block Puzzle board' } });
      const cells = Array.from({ length: BB * BB }, () => el('div.ag-bb-cell', { aria: { hidden: 'true' } }));
      const fx = el('div.ag-bb-fx', { aria: { hidden: 'true' } });
      const overlay = el('div.ag-bb-overlay', { hidden: true });
      board.append(...cells, fx, overlay);
      const tray = el('div.ag-bb-tray', { role: 'group', aria: { label: 'Pieces to place' } });
      const startNew = async () => {
        if (!(await K.confirmNew(g().moves && !g().over))) return;
        cancelDrag(); data.game = freshBlocks(data.prefs); selected = null; hover = null; message = ''; fresh = new Set([0, 1, 2]);
        P.changed({ type: 'board', game: 'blocks' }); draw();
      };
      // New game sits beside the score so the board gets the height
      const root = el('div.ag-game.ag-blocks', { class: preview ? 'ag-preview' : '' }, el('div.ag-top', el('div.ag-toprow', score, preview ? null : btn('New game', startNew)), status),
        el('div.ag-stage.ag-bb-stage', el('div.ag-bb-wrap', board, tray)));
      host.replaceChildren(root);

      /* ---- drawing ---- */
      function draw() {
        const p = data.prefs, game = g(), colors = palette();
        root.style.setProperty('--bb-board', p.boardColor);
        root.classList.toggle('ag-bb-square', p.squareBlocks);
        root.classList.toggle('ag-bb-nogrid', !p.grid);
        game.board.forEach((v, i) => { const c = cells[i]; c.classList.toggle('on', !!v); if (v) c.style.setProperty('--k', colors[v - 1]); else c.style.removeProperty('--k'); });
        board.setAttribute('aria-label', `Block Puzzle board, ${game.board.filter(Boolean).length} of ${BB * BB} squares filled.${game.over ? ' No piece fits.' : ''}`);
        overlay.hidden = !game.over;
        if (game.over) overlay.replaceChildren(el('b', { text: 'No room left' }), el('span', { text: `Final score ${game.score.toLocaleString()}` }), preview ? null : btn('New game', startNew, { class: 'btn-primary' }));
        board.classList.toggle('ag-bb-over', game.over);
        drawTray(); ghostKey = null; paintGhost(); paintScore(); paintStatus();
      }
      function drawTray() {
        const game = g(), colors = palette();
        const hadFocus = tray.contains(document.activeElement) ? document.activeElement.dataset.slot : null;
        tray.replaceChildren(...game.tray.map((piece, slot) => {
          if (!piece) return el('div.ag-bb-slot.empty', { aria: { hidden: 'true' } });
          const s = BB_SHAPES[piece.shape];
          const fits = bbCanPlace(game.board, piece.shape);
          const mini = Array.from({ length: s.h * s.w }, (_, i) => el('i', { class: s.cells.some(([r, c]) => r * s.w + c === i) ? 'on' : '' }));
          const b = el('button.ag-bb-piece', { type: 'button', tabIndex: preview ? -1 : 0, class: [fits ? '' : 'nofit', selected === slot ? 'sel' : '', fresh.has(slot) ? 'in' : '', drag && drag.moved && drag.slot === slot ? 'lifted' : ''].filter(Boolean).join(' '),
            style: { '--k': colors[piece.color - 1], '--w': String(s.w), '--h': String(s.h), '--slot': String(slot) }, dataset: { slot: String(slot) },
            aria: { label: `Piece ${slot + 1}: ${shapeWords(s)}${fits ? '' : ' — doesn’t fit anywhere'}`, pressed: String(selected === slot) } }, mini);
          return el('div.ag-bb-slot', b);
        }));
        fresh.clear();
        // keep keyboard focus in the game when the focused piece is redrawn or placed
        if (hadFocus != null) (tray.querySelector(`[data-slot="${hadFocus}"]`) || tray.querySelector('.ag-bb-piece') || board).focus({ preventScroll: true });
      }
      function paintScore() {
        const game = g();
        score.replaceChildren(el('span.ag-bb-points', { text: `Score ${game.score.toLocaleString()}` }), el('span', { text: `Target ${game.goal.toLocaleString()}` }), el('span', { text: `Best ${Math.max(data.best || 0, game.score).toLocaleString()}` }));
      }
      function paintStatus() {
        const has = P.actions('blocks') > 0, game = g();
        status.textContent = message || (game.over ? 'No piece fits anymore. Start a new game to play again.' : !has ? K.noMoves('blocks')
          : selected !== null ? `Piece ${selected + 1} picked up — move it with the arrow keys or the mouse, then Enter or click to place it (on touch, tap twice). Esc puts it back.`
          : game.won ? 'Target reached — Block Puzzle won! Keep going for a high score.' : 'Drag a piece onto the board, or press 1–3 to pick one. Placing a piece uses one move.');
        status.classList.toggle('ag-blocked', !has && !game.over);
        tray.classList.toggle('ag-bb-locked', !has || game.over);
      }
      /* The outline where the piece would land (red if it doesn't fit) and the lines that would clear */
      function target() {
        if (hover) return hover;
        if (selected === null || !g().tray[selected]) return null;
        return { slot: selected, r: cursor.r, c: cursor.c, ok: bbFits(g().board, g().tray[selected].shape, cursor.r, cursor.c), keyboard: true };
      }
      function paintGhost() {
        const t = target();
        const key = t ? `${t.slot}:${t.r}:${t.c}:${t.ok}` : '';
        if (key === ghostKey) return;
        ghostKey = key;
        cells.forEach(c => { c.classList.remove('ghost', 'bad', 'hint'); c.style.removeProperty('--g'); });
        if (!t) return;
        const piece = g().tray[t.slot]; if (!piece) return;
        const colour = palette()[piece.color - 1];
        const showOutline = t.keyboard || data.prefs.ghost;
        BB_SHAPES[piece.shape].cells.forEach(([dr, dc]) => {
          const y = t.r + dr, x = t.c + dc; if (y < 0 || y >= BB || x < 0 || x >= BB || !showOutline) return;
          const c = cells[y * BB + x]; c.classList.add('ghost'); c.classList.toggle('bad', !t.ok); c.style.setProperty('--g', colour);
        });
        if (t.ok && data.prefs.clearHint) bbPlace(g().board, piece.shape, t.r, t.c, piece.color).cleared.forEach(i => { if (g().board[i]) { cells[i].classList.add('hint'); cells[i].style.setProperty('--g', colour); } });
      }

      /* ---- picking and placing ---- */
      const shapeOf = slot => BB_SHAPES[g().tray[slot]?.shape];
      function clampCursor(slot = selected) {
        const s = shapeOf(slot); if (!s) return;
        cursor = { r: U.clamp(cursor.r, 0, BB - s.h), c: U.clamp(cursor.c, 0, BB - s.w) };
      }
      function nudge(node) { if (!node) return; node.classList.remove('ag-bb-shake'); void node.offsetWidth; node.classList.add('ag-bb-shake'); }
      function select(slot, viaKeys = false) {
        if (preview || g().over || !g().tray[slot]) return;
        if (selected === slot) { selected = null; message = ''; drawTray(); paintGhost(); paintStatus(); return; }
        if (!P.actions('blocks')) { message = K.noMoves('blocks'); paintStatus(); nudge(tray.querySelector(`[data-slot="${slot}"]`)); return; }
        selected = slot;
        const spot = bbSpots(g().board, g().tray[slot].shape, true)[0];
        if (spot) cursor = { r: spot[0], c: spot[1] };
        clampCursor(); message = ''; drawTray(); paintGhost(); paintStatus();
        if (viaKeys) board.focus({ preventScroll: true });
      }
      function place(slot, r, c) {
        const game = g(), piece = game.tray[slot];
        if (!piece || game.over) return false;
        if (!bbFits(game.board, piece.shape, r, c)) { message = 'That piece doesn’t fit there. No move used.'; paintStatus(); return false; }
        if (!P.actions('blocks')) { message = K.noMoves('blocks'); paintStatus(); return false; }
        const res = bbPlace(game.board, piece.shape, r, c, piece.color);
        game.streak = res.lines ? game.streak + 1 : 0;
        const gain = bbScore(res.placed.length, res.lines, game.streak);
        game.board = res.board; game.tray[slot] = null; game.moves++; game.score += gain; game.lines += res.lines;
        let dealt = false;
        if (game.tray.every(x => !x)) { game.tray = bbDeal(game.board); dealt = true; }
        game.over = !bbAnyFit(game.board, game.tray);
        selected = null; hover = null;
        message = res.lines ? `${res.lines > 1 ? `${res.lines} lines` : 'Line'} cleared${game.streak > 1 ? ` — combo ×${game.streak}` : ''}! +${gain.toLocaleString()}` : '';
        if (game.over) message = `No piece fits anymore — final score ${game.score.toLocaleString()}.`;
        if (!game.won && game.score >= game.goal) { game.won = true; message = `You reached ${game.goal.toLocaleString()} points — that’s a Block Puzzle win!`; P.win('blocks', game); }
        data.best = Math.max(data.best || 0, game.score);
        if (dealt) fresh = new Set([0, 1, 2]);
        P.spend('blocks');   // saves the board, tray, score and any win together
        draw();
        celebrate(res, gain, game.streak);
        return true;
      }
      function celebrate(res, gain, streak) {
        const reduced = U.reducedMotion();
        res.placed.forEach(i => { if (!res.cleared.includes(i)) { cells[i].classList.remove('pop'); void cells[i].offsetWidth; cells[i].classList.add('pop'); } });
        const pts = score.querySelector('.ag-bb-points'); if (pts) pts.classList.add('bump');
        if (reduced) return;
        const colors = palette();
        const centre = res.placed.reduce((a, i) => [a[0] + Math.floor(i / BB), a[1] + i % BB], [0, 0]).map(v => v / res.placed.length);
        res.cleared.forEach(i => {
          const c = cells[i];
          const d = Math.hypot(Math.floor(i / BB) - centre[0], i % BB - centre[1]);
          const bit = el('i.ag-bb-burst', { style: { left: `${c.offsetLeft}px`, top: `${c.offsetTop}px`, width: `${c.offsetWidth}px`, height: `${c.offsetHeight}px`, '--k': colors[res.before[i] - 1], '--d': `${Math.round(d * 28)}ms` } });
          fx.append(bit); later(() => bit.remove(), 900);
        });
        if (res.lines) { board.classList.remove('ag-bb-flash'); void board.offsetWidth; board.classList.add('ag-bb-flash'); }
        const anchor = cells[Math.round(centre[0]) * BB + Math.round(centre[1])];
        const plus = el('b.ag-bb-plus', { class: res.lines ? 'big' : '', style: { left: `${anchor.offsetLeft + anchor.offsetWidth / 2}px`, top: `${anchor.offsetTop + anchor.offsetHeight / 2}px` } }, `+${gain.toLocaleString()}`, streak > 1 ? el('small', { text: `Combo ×${streak}` }) : null);
        fx.append(plus); later(() => plus.remove(), 1100);
      }

      /* ---- dragging ---- */
      function geometry() {
        const br = board.getBoundingClientRect(); const scale = br.width / (board.offsetWidth || 1) || 1;
        const a = cells[0], b = cells[1];
        const pitch = ((b.offsetLeft - a.offsetLeft) || a.offsetWidth) * scale;
        return { x: br.left + (board.clientLeft + a.offsetLeft) * scale, y: br.top + (board.clientTop + a.offsetTop) * scale, size: a.offsetWidth * scale, pitch };
      }
      function startDrag() {
        const piece = g().tray[drag.slot];
        if (!piece || g().over) return false;
        if (!P.actions('blocks')) { message = K.noMoves('blocks'); paintStatus(); nudge(drag.btn); return false; }
        const s = BB_SHAPES[piece.shape], geo = geometry();
        const gap = Math.max(0, geo.pitch - geo.size);
        drag.moved = true; drag.w = s.w * geo.pitch - gap; drag.h = s.h * geo.pitch - gap;
        // a mouse holds the piece by its middle; a finger holds it from below so the piece stays visible
        drag.dx = drag.w / 2; drag.dy = drag.touch ? drag.h + geo.size * 0.9 : drag.h / 2;
        drag.float = el('div.ag-bb-float', { class: data.prefs.squareBlocks ? 'ag-bb-square' : '', aria: { hidden: 'true' }, style: { '--k': palette()[piece.color - 1], '--cell': `${geo.size}px`, '--gap': `${gap}px`, '--w': String(s.w), '--cr': `${Math.max(2, geo.size * 0.16)}px`, '--bev': `${Math.max(1.5, geo.size * 0.09)}px` } },
          Array.from({ length: s.h * s.w }, (_, i) => el('i', { class: s.cells.some(([r, c]) => r * s.w + c === i) ? 'on' : '' })));
        document.body.append(drag.float);
        if (selected !== null) { selected = null; drawTray(); }
        drag.btn = tray.querySelector(`[data-slot="${drag.slot}"]`) || drag.btn;
        drag.btn.classList.add('lifted');
        root.classList.add('ag-bb-dragging');
        return true;
      }
      function moveDrag(x, y) {
        const left = x - drag.dx, top = y - drag.dy;
        drag.float.style.transform = `translate(${left}px, ${top}px)`;
        const geo = geometry(), s = shapeOf(drag.slot);
        const cx = left + drag.w / 2, cy = top + drag.h / 2, span = BB * geo.pitch;
        const near = cx > geo.x - geo.pitch / 2 && cx < geo.x + span + geo.pitch / 2 && cy > geo.y - geo.pitch / 2 && cy < geo.y + span + geo.pitch / 2;
        if (!near) hover = null;
        else {
          const r = U.clamp(Math.round((top - geo.y) / geo.pitch), 0, BB - s.h), c = U.clamp(Math.round((left - geo.x) / geo.pitch), 0, BB - s.w);
          hover = { slot: drag.slot, r, c, ok: bbFits(g().board, g().tray[drag.slot].shape, r, c) };
        }
        // over the board the carried piece turns see-through, so the outline underneath stays visible
        drag.float.classList.toggle('over', !!hover && data.prefs.ghost);
        paintGhost();
      }
      function onMove(e) { if (!drag || e.pointerId !== drag.id) return; if (!drag.moved) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; if (!startDrag()) { endListen(); drag = null; return; } } e.preventDefault(); moveDrag(e.clientX, e.clientY); }
      function onUp(e) { if (!drag || e.pointerId !== drag.id) return; const d = drag; if (!d.moved) { endListen(); drag = null; select(d.slot); return; } finishDrag(true); }
      function onCancel(e) { if (drag && e.pointerId === drag.id) finishDrag(false); }
      function endListen() { removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onCancel); }
      function finishDrag(commit) {
        const d = drag; drag = null; endListen();
        root.classList.remove('ag-bb-dragging');
        const t = hover; hover = null;
        if (commit && t && t.ok) { d.float.remove(); if (!place(d.slot, t.r, t.c)) draw(); return; }
        if (commit && t) message = 'That piece doesn’t fit there. No move used.';
        paintGhost(); paintStatus();
        // glide back to the tray
        const home = (tray.querySelector(`[data-slot="${d.slot}"]`) || d.btn).getBoundingClientRect();
        const back = () => { d.float.remove(); tray.querySelector(`[data-slot="${d.slot}"]`)?.classList.remove('lifted'); };
        if (U.reducedMotion() || !home.width) { back(); return; }
        d.float.classList.add('returning');
        d.float.style.transform = `translate(${home.left + home.width / 2 - d.w / 2}px, ${home.top + home.height / 2 - d.h / 2}px) scale(.5)`;
        later(back, 220);
      }
      function cancelDrag() { if (drag) { if (drag.float) drag.float.remove(); drag = null; endListen(); hover = null; root.classList.remove('ag-bb-dragging'); } }

      /* ---- board clicks and taps for a picked-up piece ---- */
      function cellAt(x, y) {
        const geo = geometry(); const span = BB * geo.pitch;
        if (x < geo.x || y < geo.y || x > geo.x + span || y > geo.y + span) return null;
        return { r: U.clamp(Math.floor((y - geo.y) / geo.pitch), 0, BB - 1), c: U.clamp(Math.floor((x - geo.x) / geo.pitch), 0, BB - 1) };
      }
      const aimAt = at => { const s = shapeOf(selected); return { r: U.clamp(at.r - Math.floor((s.h - 1) / 2), 0, BB - s.h), c: U.clamp(at.c - Math.floor((s.w - 1) / 2), 0, BB - s.w) }; };

      const offs = [lifecycle('blocks', { draw, paintStatus })];
      if (!preview) {
        tray.addEventListener('pointerdown', e => {
          const b = e.target.closest('.ag-bb-piece'); if (!b || e.button > 0 || drag) return;
          e.preventDefault(); b.focus({ preventScroll: true });
          drag = { slot: Number(b.dataset.slot), id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, touch: e.pointerType !== 'mouse', btn: b, float: null };
          addEventListener('pointermove', onMove, { passive: false }); addEventListener('pointerup', onUp); addEventListener('pointercancel', onCancel);
        });
        // Enter / Space on a focused piece (pointer clicks are handled on pointerup)
        tray.addEventListener('click', e => { const b = e.target.closest('.ag-bb-piece'); if (b && e.detail === 0) select(Number(b.dataset.slot), true); });
        board.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; });
        board.addEventListener('pointermove', e => {
          if (drag || selected === null || e.pointerType !== 'mouse') return;
          const at = cellAt(e.clientX, e.clientY); if (!at) return;
          cursor = aimAt(at); paintGhost();
        });
        board.addEventListener('click', e => {
          if (selected === null || g().over) return;
          const at = cellAt(e.clientX, e.clientY); if (!at) return;
          const spot = aimAt(at);
          if (lastPointer === 'mouse' || (spot.r === cursor.r && spot.c === cursor.c)) { cursor = spot; place(selected, spot.r, spot.c); }
          else { cursor = spot; message = 'Tap the same spot again to place the piece there.'; paintGhost(); paintStatus(); }
        });
        offs.push(K.keys(opts.keyTarget || root, e => {
          if (/^[1-3]$/.test(e.key)) { e.preventDefault(); select(Number(e.key) - 1, true); return; }
          if (selected === null) return;
          const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
          if (d) { e.preventDefault(); cursor = { r: cursor.r + d[0], c: cursor.c + d[1] }; clampCursor(); paintGhost(); return; }
          if ((e.key === 'Enter' || e.code === 'Space' || e.key === ' ') && !e.repeat) { e.preventDefault(); place(selected, cursor.r, cursor.c); return; }
          if (e.key === 'Escape') { e.preventDefault(); selected = null; message = ''; drawTray(); paintGhost(); paintStatus(); }
        }));
      }
      if (g().tray.every(Boolean) && !g().moves) fresh = new Set([0, 1, 2]);
      draw();
      return {
        destroy() { offs.forEach(off => off()); cancelDrag(); timers.forEach(clearTimeout); timers.clear(); },
        refresh: paintStatus,
        focus: () => (tray.querySelector('.ag-bb-piece:not(.nofit)') || board).focus({ preventScroll: true })
      };
    }
  });

  // Pure game mechanics, exposed for the automated checks in tests/.
  window.SSArcadeMechanics = { slide2048, spawn2048, moves2048, fresh2048, sanitize2048, freshSolitaire, sanitizeSolitaire, solSource, solCanTableau, solCanFoundation, solMove, solDraw, solHint, BB_SHAPES, bbFits, bbSpots, bbAnyFit, bbPlace, bbScore, bbDeal, freshBlocks, sanitizeBlocks };
})(window.SS);
