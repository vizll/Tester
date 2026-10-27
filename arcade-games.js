/* Tester — 2048, Klondike Solitaire and turn-based Tetris. Each game keeps its board and preferences in
   SS.play (saved with everything else) and spends one earned move per changed slide, legal card action
   or locked piece. Boards size themselves to the panel they sit in (CSS container units), keyboard input
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
    const next = board.slice(); let score = 0;
    const index = (line, i) => direction === 'left' ? line * n + i : direction === 'right' ? line * n + (n - 1 - i) : direction === 'up' ? i * n + line : (n - 1 - i) * n + line;
    for (let line = 0; line < n; line++) {
      const values = Array.from({ length: n }, (_, i) => board[index(line, i)]).filter(Boolean);
      const merged = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === values[i + 1]) { const v = values[i] * 2; merged.push(v); score += v; i++; }
        else merged.push(values[i]);
      }
      for (let i = 0; i < n; i++) next[index(line, i)] = merged[i] || 0;
    }
    return { board: next, score, changed: next.some((v, i) => v !== board[i]) };
  }
  function spawn2048(board, random = Math.random) {
    const empty = board.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    if (!empty.length) return;
    board[empty[Math.floor(random() * empty.length)]] = random() < .9 ? 2 : 4;
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
      let message = '';
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
        board.replaceChildren(...g().board.map((v, i) => {
          const level = v ? Math.log2(v) - 1 : -1;
          return el('div.ag-2048-cell', { role: 'img', text: v || '', style: { background: v ? colors[Math.min(level, colors.length - 1)] : 'rgba(255,255,255,.2)', color: v && level >= 3 ? '#fff' : '#28333d', '--digits': String(String(v || '').length || 1) }, aria: { label: `Row ${Math.floor(i / g().n) + 1}, column ${i % g().n + 1}: ${v || 'empty'}` } });
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
        spawn2048(game.board);
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
      let selected = null, message = '';
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
        const node = el('button.ag-card', { type: 'button', class: `${faceUp ? 'ag-face' : 'ag-back'}${on ? ' ag-selected' : ''}`, tabIndex: faceUp && !opts.preview ? 0 : -1, aria: { label: faceUp ? cardLabel(card) + (on ? ', selected' : '') : 'Face-down card', pressed: faceUp ? String(!!on) : null, disabled: faceUp ? null : 'true' }, style: faceUp ? { color: red(card) ? data.prefs.redColor : data.prefs.blackColor } : {}, dataset: { k: selection.kind + (selection.pile ?? '') + '-' + (selection.index ?? '') }, ...extra });
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

  /* ------------------------- Turn-based Tetris ------------------------- */
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]], S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };
  const TYPES = Object.keys(SHAPES);
  const tetrisPalettes = {
    classic: { I: '#32cee0', J: '#537ff2', L: '#f5a349', O: '#f2d955', S: '#61c877', T: '#ba78e6', Z: '#ef7076' },
    pastel: { I: '#b2e9ec', J: '#b7cdf5', L: '#ffd0a3', O: '#f8eaaa', S: '#bee7bd', T: '#d9bfed', Z: '#f3b6c1' },
    neon: { I: '#00f5ff', J: '#5371ff', L: '#ff9515', O: '#fff500', S: '#58ff47', T: '#db45ff', Z: '#ff457d' },
    mono: { I: '#d8e7ef', J: '#bfd4df', L: '#a5c1d0', O: '#8bafc1', S: '#719eb2', T: '#58899e', Z: '#40758b' }
  };
  function rotateMatrix(matrix) { return matrix[0].map((_, x) => matrix.map(row => row[x]).reverse()); }
  function tetrisMatrix(piece) { let m = SHAPES[piece.type]; for (let i = 0; i < (piece.rot || 0) % 4; i++) m = rotateMatrix(m); return m; }
  function tetrisFits(board, piece) {
    const m = tetrisMatrix(piece);
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x]) {
      const bx = piece.x + x, by = piece.y + y;
      if (bx < 0 || bx >= 10 || by >= 20 || (by >= 0 && board[by][bx])) return false;
    }
    return true;
  }
  function tetrisRotate(board, piece) {
    if (piece.type === 'O') return { ...piece };
    for (const dy of [0, -1, -2]) for (const dx of [0, -1, 1, -2, 2]) {
      const next = { ...piece, rot: ((piece.rot || 0) + 1) % 4, x: piece.x + dx, y: piece.y + dy };
      if (tetrisFits(board, next)) return next;
    }
    return null;
  }
  function tetrisGhost(board, piece) { const p = { ...piece }; while (tetrisFits(board, { ...p, y: p.y + 1 })) p.y++; return p; }
  function tetrisLock(board, piece) {
    const next = board.map(row => row.slice()); const landed = tetrisGhost(next, piece); const m = tetrisMatrix(landed);
    let overflow = false;
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x]) {
      const by = landed.y + y, bx = landed.x + x;
      if (by < 0) overflow = true; else next[by][bx] = piece.type;
    }
    const kept = next.filter(row => row.some(v => !v)); const lines = 20 - kept.length;
    while (kept.length < 20) kept.unshift(Array(10).fill(''));
    return { board: kept, lines, distance: landed.y - piece.y, overflow };
  }
  function takeBag(g) { if (!g.bag?.length) g.bag = shuffle(TYPES); return g.bag.pop(); }
  const spawnPiece = type => ({ type, x: type === 'O' ? 4 : 3, y: 0, rot: 0 });
  function freshTetris(prefs) {
    const goal = [5, 10, 20, 40].includes(+prefs.target) ? +prefs.target : 10;
    const g = { id: U.uid('g'), board: Array.from({ length: 20 }, () => Array(10).fill('')), bag: [], next: '', piece: null, lines: 0, score: 0, moves: 0, won: false, winCounted: false, over: false, goal };
    g.piece = spawnPiece(takeBag(g)); g.next = takeBag(g); return g;
  }
  const prefsTetris = { target: 10, palette: 'classic', background: '#142337', grid: true, ghost: true, squareBlocks: false };
  function sanitizeTetris(data) {
    const p = { ...prefsTetris, ...(U.isObj(data.prefs) ? data.prefs : {}) };
    const out = { prefs: { target: [5, 10, 20, 40].includes(+p.target) ? +p.target : 10, palette: tetrisPalettes[p.palette] ? p.palette : 'classic', background: U.hex(p.background, prefsTetris.background), grid: p.grid !== false, ghost: p.ghost !== false, squareBlocks: !!p.squareBlocks } };
    const g = data.game;
    const cellOk = v => v === '' || TYPES.includes(v);
    if (U.isObj(g) && Array.isArray(g.board) && g.board.length === 20 && g.board.every(r => Array.isArray(r) && r.length === 10 && r.every(cellOk)) && U.isObj(g.piece) && SHAPES[g.piece.type] && TYPES.includes(g.next)) {
      const piece = { type: g.piece.type, x: num(Math.round(g.piece.x), -3, 12, 3), y: num(Math.round(g.piece.y), -3, 20, 0), rot: num(Math.round(g.piece.rot), 0, 3, 0) };
      out.game = { id: typeof g.id === 'string' ? g.id.slice(0, 40) : U.uid('g'), board: g.board.map(r => r.slice()), bag: (Array.isArray(g.bag) ? g.bag : []).filter(t => TYPES.includes(t)).slice(0, 7), next: g.next, piece, lines: num(g.lines, 0, 1e6, 0), score: num(g.score, 0, 1e12, 0), moves: num(g.moves, 0, 1e9, 0), won: !!g.won, winCounted: g.winCounted === undefined ? !!g.won : !!g.winCounted, over: !!g.over, goal: [5, 10, 20, 40].includes(g.goal) ? g.goal : 10 };
      if (!out.game.over && !tetrisFits(out.game.board, piece)) out.game.piece = spawnPiece(piece.type);
    }
    return out;
  }
  P.register('tetris', {
    title: 'Tetris', icon: '🧩', description: 'Turn-based falling blocks: line pieces up, then drop them.',
    rules: 'Moving and rotating are free and there is no falling clock. Locking a piece with Drop uses one move.',
    sanitize: sanitizeTetris,
    settings(id = 'tetris') {
      const p = P.data(id).prefs || prefsTetris; const set = (k, v) => K.setPref(id, k, v);
      return [
        K.field('Block palette', K.select('Tetris block palette', Object.keys(tetrisPalettes).map(x => [x, x[0].toUpperCase() + x.slice(1)]), p.palette, v => set('palette', v))),
        K.field('Board background', K.color('Tetris board background', p.background, v => set('background', v))),
        K.field('Board grid', K.toggle('Show Tetris board grid', p.grid, v => set('grid', v))),
        K.field('Landing preview', K.toggle('Show where the piece will land', p.ghost, v => set('ghost', v))),
        K.field('Square block corners', K.toggle('Square Tetris block corners', p.squareBlocks, v => set('squareBlocks', v))),
        K.field('Line target', K.select('Tetris line target', [[5, '5 lines — quick'], [10, '10 lines — classic'], [20, '20 lines'], [40, '40 lines — marathon']], p.target, v => set('target', +v)), 'Applies to your next new game.')
      ];
    },
    summary: data => (data.game ? `${data.game.lines}/${data.game.goal} lines · ${U.plural(data.game.moves, 'piece')}${data.game.won ? ' · won' : data.game.over ? ' · game over' : ''}` : 'Not started'),
    mount(host, opts = {}) {
      const data = P.data('tetris');
      Object.assign(data, sanitizeTetris(data));
      if (!data.game) data.game = freshTetris(data.prefs);
      const g = () => data.game;
      let message = '';
      const score = el('div.ag-score'), status = el('p.ag-status', { attrs: { 'aria-live': 'polite' } });
      const board = el('div.ag-tetris-board', { tabIndex: opts.preview ? -1 : 0, role: 'img', aria: { label: 'Tetris board' } });
      const preview = el('div.ag-tetris-next', { aria: { hidden: 'true' } });
      const moveLeft = btn('←', () => adjust(-1, 0), { aria: { label: 'Move piece left' } });
      const rotate = btn('↻', () => turn(), { aria: { label: 'Rotate piece clockwise' }, title: 'Rotate (↑ or X)' });
      const moveRight = btn('→', () => adjust(1, 0), { aria: { label: 'Move piece right' } });
      const lower = btn('↓', () => adjust(0, 1), { aria: { label: 'Move piece down one row' }, title: 'Down one row (free)' });
      const drop = btn('Drop', lock, { class: 'btn-primary', aria: { label: 'Drop and lock the piece. Uses one move.' }, title: 'Drop and lock (Space) — uses one move' });
      const fresh = btn('New game', async () => { if (!(await K.confirmNew(g().moves))) return; data.game = freshTetris(data.prefs); message = ''; P.changed({ type: 'board', game: 'tetris' }); draw(); });
      const root = el('div.ag-game.ag-tetris', { class: opts.preview ? 'ag-preview' : '' }, el('div.ag-top', score, status),
        el('div.ag-stage.ag-tetris-stage', el('div.ag-tetris-layout', board, el('aside.ag-tetris-aside', el('p.ag-next-label', { text: 'NEXT' }), preview))),
        opts.preview ? null : el('div.ag-controls.ag-tetris-controls', moveLeft, rotate, lower, moveRight, drop, fresh));
      host.replaceChildren(root);
      function draw() {
        const p = data.prefs; const game = g();
        const colors = tetrisPalettes[p.palette] || tetrisPalettes.classic;
        const active = new Map(), ghost = new Set();
        const pieceCells = (piece, fn) => tetrisMatrix(piece).forEach((row, y) => row.forEach((v, x) => { if (v && piece.y + y >= 0) fn((piece.y + y) * 10 + piece.x + x); }));
        if (!game.over) { pieceCells(game.piece, i => active.set(i, game.piece.type)); if (p.ghost) pieceCells(tetrisGhost(game.board, game.piece), i => ghost.add(i)); }
        board.style.background = p.background; board.style.setProperty('--ag-block-radius', p.squareBlocks ? '0px' : '3px');
        board.classList.toggle('ag-no-grid', !p.grid);
        board.replaceChildren(...game.board.flat().map((v, i) => {
          const fill = v || active.get(i); const isGhost = !fill && ghost.has(i);
          return el('div.ag-tetris-cell', { class: `${fill ? 'ag-filled' : ''}${isGhost ? ' ag-ghost' : ''}`, style: { background: fill ? colors[fill] : '', borderColor: isGhost ? colors[game.piece.type] : '' } });
        }));
        board.setAttribute('aria-label', `Tetris board. ${game.lines} of ${game.goal} lines cleared. Current piece ${game.piece.type} in column ${game.piece.x + 1}. ${game.over ? 'Game over.' : ''}`);
        const nextM = SHAPES[game.next];
        preview.style.gridTemplateColumns = `repeat(${nextM.length}, 1fr)`;
        preview.replaceChildren(...nextM.flat().map(v => el('i', { style: { background: v ? colors[game.next] : 'transparent' } })));
        score.replaceChildren(el('span', { text: `Lines ${game.lines}/${game.goal}` }), el('span', { text: `Score ${game.score.toLocaleString()}` }), el('span', { text: U.plural(game.moves, 'piece') }));
        paintStatus();
      }
      function paintStatus() {
        const has = P.actions('tetris') > 0;
        [moveLeft, moveRight, rotate, lower, drop].forEach(node => { node.disabled = g().over || !has; });
        status.textContent = message || (g().over ? 'The stack reached the top. Start a new game to try again.' : !has ? K.noMoves('tetris') : g().won ? `Line target cleared — Tetris won! Keep stacking if you like.` : 'Line the piece up (free), then Drop to use one move.');
        status.classList.toggle('ag-blocked', !has && !g().over);
      }
      function ready() {
        if (g().over) return false;
        if (!P.actions('tetris')) { message = K.noMoves('tetris'); paintStatus(); return false; }
        return true;
      }
      function adjust(dx, dy) {
        if (!ready()) return;
        const piece = { ...g().piece, x: g().piece.x + dx, y: g().piece.y + dy };
        if (tetrisFits(g().board, piece)) { g().piece = piece; message = ''; P.save(); draw(); }
        else { message = dy ? 'The piece can’t go lower — Drop to lock it.' : 'The piece can’t move that way.'; paintStatus(); }
      }
      function turn() {
        if (!ready()) return;
        const piece = tetrisRotate(g().board, g().piece);
        if (piece) { g().piece = piece; message = ''; P.save(); draw(); } else { message = 'No room to rotate here.'; paintStatus(); }
      }
      function lock() {
        if (!ready()) return;
        const game = g();
        const result = tetrisLock(game.board, game.piece);
        game.board = result.board; game.lines += result.lines; game.moves++;
        game.score += [0, 100, 300, 500, 800][result.lines] + result.distance * 2;
        game.piece = spawnPiece(game.next); game.next = takeBag(game);
        game.over = result.overflow || !tetrisFits(game.board, game.piece);
        message = result.lines ? `${U.plural(result.lines, 'line')} cleared!` : '';
        if (!game.won && game.lines >= game.goal) { game.won = true; message = `You cleared ${game.goal} lines — that’s a Tetris win!`; P.win('tetris', game); }
        P.spend('tetris'); draw();
      }
      const offs = [lifecycle('tetris', { draw, paintStatus })];
      if (!opts.preview) offs.push(K.keys(opts.keyTarget || root, e => {
        const key = e.key.toLowerCase();
        if (e.key === 'ArrowLeft') { e.preventDefault(); adjust(-1, 0); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); adjust(1, 0); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); adjust(0, 1); }
        else if (e.key === 'ArrowUp' || key === 'x') { e.preventDefault(); turn(); }
        else if ((e.code === 'Space' || e.key === ' ') && !e.repeat) { e.preventDefault(); lock(); }
      }));
      draw();
      return { destroy: () => offs.forEach(off => off()), refresh: paintStatus, focus: () => board.focus({ preventScroll: true }) };
    }
  });

  // Pure game mechanics, exposed for the automated checks in tests/.
  window.SSArcadeMechanics = { slide2048, spawn2048, moves2048, fresh2048, sanitize2048, freshSolitaire, sanitizeSolitaire, solSource, solCanTableau, solCanFoundation, solMove, solDraw, solHint, rotateMatrix, tetrisMatrix, tetrisFits, tetrisRotate, tetrisGhost, tetrisLock, freshTetris, sanitizeTetris };
})(window.SS);
