/* Tester Arcade — local, persistent study-reward games. */
(function (SS) {
  'use strict';
  const A = SS.arcade;
  if (!A) throw new Error('Tester arcade core must load before games.');
  const h = (selector, props = {}, ...children) => {
    const [tag, ...classes] = selector.split('.');
    const node = document.createElement(tag || 'div');
    if (classes.length) node.className = classes.join(' ');
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'on') Object.entries(value).forEach(([name, fn]) => node.addEventListener(name, fn));
      else if (key === 'style') Object.assign(node.style, value);
      else if (key === 'attrs') Object.entries(value).forEach(([name, val]) => node.setAttribute(name, val));
      else if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className += ' ' + value;
      else if (value != null) node[key] = value;
    });
    children.flat(Infinity).forEach(child => { if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child))); });
    return node;
  };
  const button = (text, fn, extra = {}) => h('button.btn.btn-sm', {type: 'button', text, on: {click: fn}, ...extra});
  const field = (title, node, hint) => h('label.ag-field', {}, h('span', {text: title}), node, hint ? h('small.hint', {text: hint}) : null);
  const select = (label, choices, value, change) => h('select.input', {value, attrs: {'aria-label': label}, on: {change: e => change(e.target.value)}}, choices.map(([v, text]) => h('option', {value: String(v), text, selected: String(v) === String(value)})));
  const color = (label, value, change) => h('input.ag-color', {type: 'color', value, attrs: {'aria-label': label}, on: {input: e => change(e.target.value)}});
  const toggle = (label, value, change) => h('input', {type: 'checkbox', checked: !!value, attrs: {'aria-label': label}, on: {change: e => change(e.target.checked)}});
  const settings = (...fields) => h('details.ag-settings', {}, h('summary', {text: 'Customize this game'}), h('div.ag-settings-grid', {}, fields));
  const credits = id => Number(A.state.credits[id]) || 0;
  const save = () => A.save();
  const clone = value => JSON.parse(JSON.stringify(value));
  const getData = (id, defaults) => {
    const all = A.state.gameData || (A.state.gameData = {});
    const data = all[id] && typeof all[id] === 'object' ? all[id] : (all[id] = {});
    data.prefs = {...defaults, ...(data.prefs || {})};
    return data;
  };
  const shuffle = input => { const a = input.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  async function confirmReset(moves) {
    if (!moves || !SS.ui?.confirm) return true;
    return SS.ui.confirm({title: 'Start a new game?', message: 'This replaces the current board. Your earned turns, trophies, and customization stay saved.', ok: 'New game'});
  }
  function keyboard(host, fn) {
    const handle = e => {
      if (!host.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const dialog = host.closest('dialog');
      if (dialog && !dialog.open) return;
      const openDialogs = [...document.querySelectorAll('dialog[open]')];
      if (dialog && openDialogs.length && openDialogs[openDialogs.length - 1] !== dialog) return;
      fn(e);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }

  /* ------------------------------- 2048 ------------------------------- */
  function slide2048(board, n, direction) {
    const next = board.slice(); let score = 0;
    const index = (line, i) => direction === 'left' ? line * n + i : direction === 'right' ? line * n + (n - 1 - i) : direction === 'up' ? i * n + line : (n - 1 - i) * n + line;
    for (let line = 0; line < n; line++) {
      const values = Array.from({length: n}, (_, i) => board[index(line, i)]).filter(Boolean);
      const merged = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === values[i + 1]) { const v = values[i] * 2; merged.push(v); score += v; i++; }
        else merged.push(values[i]);
      }
      for (let i = 0; i < n; i++) next[index(line, i)] = merged[i] || 0;
    }
    return {board: next, score, changed: next.some((v, i) => v !== board[i])};
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
    return {n, goal, board, score: 0, moves: 0, won: false, over: false};
  }
  const palettes2048 = {
    sunset: ['#f9f0e6', '#f1dfc7', '#efbc8e', '#ed986b', '#eb785b', '#df5a55', '#d7ba5b', '#d0ac45', '#c7972e', '#b98219', '#a96a16', '#8f4e1c'],
    ocean: ['#e7f3f6', '#d1e9ef', '#a8d8e5', '#7bc3db', '#55a9d0', '#398fc0', '#3475af', '#415eaa', '#5e4f9e', '#79458f', '#8d3d78', '#a13b62'],
    garden: ['#eaf1e7', '#dce8d2', '#c4dcb0', '#a5ce92', '#83bd7b', '#62a86b', '#488e61', '#327959', '#22644f', '#185546', '#10463d', '#093b35'],
    candy: ['#fce8f5', '#f7d2ed', '#edb7e6', '#d99bdd', '#be84d4', '#9f71ca', '#805ebd', '#6852ad', '#5351a5', '#3d5b9e', '#2d6899', '#25788e']
  };
  A.register('2048', {
    title: '2048', icon: '🔢', description: 'Merge matching tiles. Each successful slide uses one earned turn.',
    mount(host) {
      const data = getData('2048', {size: 4, target: 2048, palette: 'sunset', boardColor: '#b8a99a', gap: 8, rounded: true});
      if (!data.game || ![4, 5].includes(data.game.n) || data.game.board?.length !== data.game.n ** 2) data.game = fresh2048(data.prefs);
      let g = data.game; let message = '';
      const score = h('div.ag-score'); const status = h('p.ag-status', {attrs: {'aria-live': 'polite'}});
      const board = h('div.ag-2048-board', {tabIndex: 0, attrs: {role: 'group', 'aria-label': '2048 board. Use arrow keys or the direction buttons.'}});
      const instructions = h('p.hint', {text: 'Use arrow keys, swipe the board, or tap a direction. Matching tiles merge once per slide. An unchanged board costs no turn. Reach the target to earn a trophy.'});
      function setPref(key, value) { data.prefs[key] = value; save(); draw(); }
      const opts = settings(
        field('Tile palette', select('2048 tile palette', Object.keys(palettes2048).map(x => [x, x[0].toUpperCase() + x.slice(1)]), data.prefs.palette, v => setPref('palette', v))),
        field('Board color', color('2048 board color', data.prefs.boardColor, v => setPref('boardColor', v))),
        field('Board size', select('2048 board size', [[4, '4 × 4 — Classic'], [5, '5 × 5 — Roomy']], data.prefs.size, v => setPref('size', +v)), 'Applies to your next new game.'),
        field('Winning tile', select('2048 winning tile', [[512, '512 — Quick'], [1024, '1024'], [2048, '2048 — Classic'], [4096, '4096 — Challenge']], data.prefs.target, v => setPref('target', +v)), 'Applies to your next new game.'),
        field('Tile spacing', h('input', {type: 'range', min: 3, max: 16, value: data.prefs.gap, attrs: {'aria-label': '2048 tile spacing'}, on: {input: e => setPref('gap', +e.target.value)}})),
        field('Rounded tiles', toggle('Rounded 2048 tiles', data.prefs.rounded, v => setPref('rounded', v)))
      );
      const arrows = h('div.ag-direction-pad', {}, button('↑', () => move('up'), {attrs: {'aria-label': 'Slide tiles up'}}), h('div', {}, button('←', () => move('left'), {attrs: {'aria-label': 'Slide tiles left'}}), button('↓', () => move('down'), {attrs: {'aria-label': 'Slide tiles down'}}), button('→', () => move('right'), {attrs: {'aria-label': 'Slide tiles right'}})));
      const fresh = button('New game', async () => { if (await confirmReset(g.moves)) { g = data.game = fresh2048(data.prefs); message = ''; save(); draw(); } });
      host.replaceChildren(h('div.ag-game.ag-2048', {}, instructions, score, board, status, arrows, h('div.ag-controls', {}, fresh), opts));
      function draw() {
        const colors = palettes2048[data.prefs.palette] || palettes2048.sunset;
        board.style.gridTemplateColumns = `repeat(${g.n}, 1fr)`;
        board.style.background = data.prefs.boardColor;
        board.style.gap = `${data.prefs.gap}px`; board.style.padding = `${data.prefs.gap}px`;
        board.style.setProperty('--ag-tile-radius', data.prefs.rounded ? '9px' : '0px');
        board.replaceChildren(...g.board.map((v, i) => {
          const level = v ? Math.log2(v) - 1 : -1;
          return h('div.ag-2048-cell', {text: v || '', style: {background: v ? colors[Math.min(level, colors.length - 1)] : 'rgba(255,255,255,.18)', color: v && level >= 3 ? '#fff' : '#28333d', fontSize: v >= 10000 ? 'clamp(14px,4.7vw,23px)' : ''}, attrs: {'aria-label': `Row ${Math.floor(i / g.n) + 1}, column ${i % g.n + 1}: ${v || 'empty'}`}});
        }));
        score.replaceChildren(h('span', {text: `Score ${g.score.toLocaleString()}`}), h('span', {text: `Target ${g.goal}`}), h('span', {text: `${g.moves} moves`}));
        status.textContent = message || (g.over ? 'No moves left. Start a new game to try again.' : g.won ? 'Trophy earned! You can keep merging with your remaining turns.' : credits('2048') ? 'Ready for your next move.' : 'Your board is saved. Answer more quiz questions to earn turns.');
      }
      function move(direction) {
        message = '';
        if (g.over) { draw(); return; }
        const result = slide2048(g.board, g.n, direction);
        if (!result.changed) { message = 'Nothing can slide in that direction. No turn used.'; draw(); return; }
        if (!A.spend('2048')) { message = 'Answer more quiz questions to earn another turn. Your board is saved.'; draw(); return; }
        g.board = result.board; g.score += result.score; g.moves++;
        spawn2048(g.board);
        if (!g.won && Math.max(...g.board) >= g.goal) { g.won = true; A.win('2048'); message = `You reached ${g.goal}! A 2048 trophy has been added to your collection.`; }
        g.over = !moves2048(g.board, g.n);
        save(); draw();
      }
      let touch = null;
      board.addEventListener('pointerdown', e => { touch = [e.clientX, e.clientY]; board.setPointerCapture?.(e.pointerId); });
      board.addEventListener('pointerup', e => { if (!touch) return; const dx = e.clientX - touch[0], dy = e.clientY - touch[1]; touch = null; if (Math.max(Math.abs(dx), Math.abs(dy)) > 25) move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up'); });
      board.addEventListener('pointercancel', () => { touch = null; });
      const off = keyboard(host, e => { const dir = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'}[e.key]; if (dir) { e.preventDefault(); move(dir); } });
      draw(); save(); return {destroy: off};
    }
  });

  /* ------------------------- Klondike solitaire ------------------------- */
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
  const rank = card => card % 13 + 1;
  const suit = card => Math.floor(card / 13);
  const red = card => [1, 2].includes(suit(card));
  const rankLabel = card => ({1: 'A', 11: 'J', 12: 'Q', 13: 'K'}[rank(card)] || String(rank(card)));
  const cardLabel = card => `${({1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King'}[rank(card)] || rank(card))} of ${SUIT_NAMES[suit(card)]}`;
  function freshSolitaire() {
    const deck = shuffle(Array.from({length: 52}, (_, i) => i));
    const tableau = Array.from({length: 7}, (_, col) => Array.from({length: col + 1}, (_, i) => ({card: deck.pop(), up: i === col})));
    return {stock: deck, waste: [], foundations: [[], [], [], []], tableau, moves: 0, won: false, recycled: 0};
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
    if (kind === 'tableau') g.tableau[target].push(...cards.map(card => ({card, up: true})));
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
    if (g.waste.length) sources.push({kind: 'waste'});
    g.tableau.forEach((pile, col) => pile.forEach((entry, index) => { if (entry.up) sources.push({kind: 'tableau', pile: col, index}); }));
    for (const source of sources) {
      const cards = solSource(g, source); if (!cards.length) continue;
      for (let f = 0; f < 4; f++) if (solCanFoundation(g, source, f)) return {source, kind: 'foundation', target: f};
    }
    for (const source of sources) for (let col = 0; col < 7; col++) {
      if (source.kind === 'tableau' && source.index === 0 && !g.tableau[col].length) continue;
      if (solCanTableau(g, source, col)) return {source, kind: 'tableau', target: col};
    }
    return null;
  }
  A.register('solitaire', {
    title: 'Solitaire', icon: '🃏', description: 'Classic Klondike. Draws, recycles and legal card moves each use one earned turn.',
    mount(host) {
      const data = getData('solitaire', {drawCount: 1, tableColor: '#1c6558', cardBack: '#3454a1', cardFace: '#fffdf5', redColor: '#c23952', blackColor: '#202b35', pattern: 'diamonds', cardFont: 'classic'});
      if (!data.game || data.game.tableau?.length !== 7 || data.game.foundations?.length !== 4) data.game = freshSolitaire();
      let g = data.game, selected = null, message = '';
      const board = h('div.ag-sol-board', {attrs: {role: 'group', 'aria-label': 'Klondike solitaire board'}});
      const status = h('p.ag-status', {attrs: {'aria-live': 'polite'}}), score = h('div.ag-score');
      const instructions = h('p.hint', {text: 'Select a face-up card or stack, then its destination. Build tableau columns down in alternating colors; only Kings fill empty columns. Build each foundation from Ace to King. A legal move, stock draw, or recycle uses one turn. Exposed cards flip automatically.'});
      const setPref = (key, value) => { data.prefs[key] = value; save(); draw(); };
      const opts = settings(
        field('Draw rule', select('Solitaire draw rule', [[1, 'Draw one — Classic easy'], [3, 'Draw three — Challenge']], data.prefs.drawCount, v => setPref('drawCount', +v))),
        field('Table color', color('Solitaire table color', data.prefs.tableColor, v => setPref('tableColor', v))),
        field('Card backs', color('Solitaire card back color', data.prefs.cardBack, v => setPref('cardBack', v))),
        field('Card face', color('Solitaire card face color', data.prefs.cardFace, v => setPref('cardFace', v))),
        field('Red suits', color('Solitaire red suit color', data.prefs.redColor, v => setPref('redColor', v))),
        field('Black suits', color('Solitaire black suit color', data.prefs.blackColor, v => setPref('blackColor', v))),
        field('Back pattern', select('Solitaire card back pattern', [['diamonds', 'Diamond lattice'], ['stripes', 'Fine stripes'], ['solid', 'Solid color']], data.prefs.pattern, v => setPref('pattern', v))),
        field('Card lettering', select('Solitaire card lettering', [['classic', 'Classic serif'], ['modern', 'Modern sans-serif']], data.prefs.cardFont, v => setPref('cardFont', v)))
      );
      const clear = button('Clear selection', () => { selected = null; message = ''; draw(); });
      const hint = button('Hint', () => {
        const result = solHint(g);
        if (result) {
          selected = result.source;
          const name = cardLabel(solSource(g, selected)[0]);
          message = `${name}: move ${result.kind === 'foundation' ? 'to the ' + SUIT_NAMES[result.target] + ' foundation' : 'to column ' + (result.target + 1)}.`;
        } else message = g.stock.length ? 'Draw from the stock to reveal another card.' : g.waste.length ? 'Try recycling the waste pile, or moving a foundation card back to the tableau.' : 'No obvious move remains. You can start a new deal.';
        draw();
      });
      const foundation = button('To foundation', () => {
        if (!selected) { message = 'Select an exposed card first.'; draw(); return; }
        const cards = solSource(g, selected);
        if (cards.length === 1 && solCanFoundation(g, selected, suit(cards[0]))) act('foundation', suit(cards[0]));
        else { message = 'That selection cannot move to a foundation yet.'; draw(); }
      });
      const fresh = button('New deal', async () => { if (await confirmReset(g.moves)) { g = data.game = freshSolitaire(); selected = null; message = ''; save(); draw(); } });
      host.replaceChildren(h('div.ag-game.ag-solitaire', {}, instructions, score, h('div.ag-sol-scroll', {}, board), status, h('div.ag-controls', {}, clear, foundation, hint, fresh), opts));
      function selectable(card, selection) {
        return selected && selected.kind === selection.kind && selected.pile === selection.pile && (selection.kind !== 'tableau' || selection.index >= selected.index);
      }
      function cardNode(card, faceUp, selection, extra = {}) {
        const node = h('button.ag-card', {type: 'button', class: `${faceUp ? 'ag-face' : 'ag-back'}${faceUp && selectable(card, selection) ? ' ag-selected' : ''}`, disabled: !faceUp, attrs: {'aria-label': faceUp ? cardLabel(card) + (selectable(card, selection) ? ', selected' : '') : 'Face-down card', 'aria-pressed': faceUp ? String(!!selectable(card, selection)) : 'false'}, style: faceUp ? {color: red(card) ? data.prefs.redColor : data.prefs.blackColor} : {}, ...extra});
        if (faceUp) node.append(h('span.ag-card-corner', {text: rankLabel(card) + SUITS[suit(card)]}), h('span.ag-card-suit', {text: SUITS[suit(card)]}));
        else node.append(h('span', {text: '✦', attrs: {'aria-hidden': 'true'}}));
        return node;
      }
      function draw() {
        board.style.setProperty('--ag-table', data.prefs.tableColor); board.style.setProperty('--ag-card-back', data.prefs.cardBack);
        board.style.setProperty('--ag-card-face', data.prefs.cardFace);
        board.style.setProperty('--ag-card-font', data.prefs.cardFont === 'modern' ? 'var(--font-body, sans-serif)' : 'Georgia, serif');
        board.dataset.pattern = data.prefs.pattern;
        const upper = h('div.ag-sol-upper');
        const stock = h('button.ag-card.ag-stock', {type: 'button', class: g.stock.length ? 'ag-back' : 'ag-sol-empty', attrs: {'aria-label': g.stock.length ? `Draw ${data.prefs.drawCount} from stock, ${g.stock.length} cards left` : g.waste.length ? 'Recycle waste into stock' : 'Stock empty'}, on: {click: () => {
          if (!g.stock.length && !g.waste.length) { message = 'The stock and waste are empty. No turn used.'; draw(); return; }
          if (!A.spend('solitaire')) { message = 'Earn more turns in your quiz to draw cards. Your deal is saved.'; draw(); return; }
          solDraw(g, Number(data.prefs.drawCount) === 3 ? 3 : 1); selected = null; message = ''; save(); draw();
        }}}, h('span', {text: g.stock.length ? '✦' : '↻'}), h('small', {text: g.stock.length ? String(g.stock.length) : 'Recycle'}));
        upper.append(stock);
        if (g.waste.length) {
          const c = g.waste[g.waste.length - 1];
          const node = cardNode(c, true, {kind: 'waste'}, {on: {click: () => { selected = selected?.kind === 'waste' ? null : {kind: 'waste'}; message = ''; draw(); }, dblclick: () => { selected = {kind: 'waste'}; act('foundation', suit(c)); }}});
          node.append(h('small.ag-card-count', {text: String(g.waste.length)})); upper.append(node);
        } else upper.append(h('div.ag-card.ag-sol-empty', {text: 'Waste', attrs: {'aria-label': 'Waste empty'}}));
        upper.append(h('div.ag-sol-spacer'));
        g.foundations.forEach((pile, f) => {
          let node;
          const onClick = () => {
            if (selected) { if (selected.kind === 'foundation' && selected.pile === f) { selected = null; message = ''; draw(); } else act('foundation', f); }
            else if (pile.length) { selected = {kind: 'foundation', pile: f}; message = ''; draw(); }
            else { message = `Place the Ace of ${SUIT_NAMES[f]} here.`; draw(); }
          };
          if (pile.length) { node = cardNode(pile[pile.length - 1], true, {kind: 'foundation', pile: f}, {on: {click: onClick}}); node.append(h('small.ag-card-count', {text: `${pile.length}/13`})); }
          else node = h('button.ag-card.ag-sol-empty.ag-foundation-empty', {type: 'button', text: SUITS[f], attrs: {'aria-label': `${SUIT_NAMES[f]} foundation, empty`}, on: {click: onClick}});
          upper.append(node);
        });
        const columns = h('div.ag-sol-columns');
        g.tableau.forEach((pile, col) => {
          const column = h('div.ag-sol-column', {style: {height: `calc(var(--ag-card-h) + ${Math.max(0, pile.length - 1) * 24}px)`}, attrs: {'aria-label': `Column ${col + 1}`}});
          if (!pile.length) column.append(h('button.ag-card.ag-sol-empty', {type: 'button', text: 'K', attrs: {'aria-label': `Empty column ${col + 1}, Kings only`}, on: {click: () => act('tableau', col)}}));
          pile.forEach((entry, index) => {
            const source = {kind: 'tableau', pile: col, index};
            const node = cardNode(entry.card, entry.up, source, {style: {top: `${index * 24}px`, color: red(entry.card) ? data.prefs.redColor : data.prefs.blackColor}, on: {click: e => {
              e.stopPropagation();
              if (selected && !(selected.kind === 'tableau' && selected.pile === col)) { act('tableau', col); return; }
              selected = selected?.kind === 'tableau' && selected.pile === col && selected.index === index ? null : source; message = ''; draw();
            }, dblclick: e => { e.stopPropagation(); if (index === pile.length - 1) { selected = source; act('foundation', suit(entry.card)); } }}});
            column.append(node);
          });
          columns.append(column);
        });
        board.replaceChildren(upper, columns);
        const total = g.foundations.reduce((n, p) => n + p.length, 0);
        score.replaceChildren(h('span', {text: `${total}/52 in foundations`}), h('span', {text: `${g.moves} moves`}), h('span', {text: `Draw ${data.prefs.drawCount}`}));
        clear.disabled = !selected; foundation.disabled = !selected;
        status.textContent = message || (g.won ? 'All four foundations complete! Your Solitaire trophy is saved.' : selected ? `Selected ${cardLabel(solSource(g, selected)[0])}. Choose a destination.` : credits('solitaire') ? 'Choose a card or draw from the stock.' : 'Your deal is saved. Answer more quiz questions to earn turns.');
      }
      function act(kind, target) {
        if (!selected) { message = 'Select a face-up card or stack first.'; draw(); return; }
        const valid = kind === 'tableau' ? solCanTableau(g, selected, target) : solCanFoundation(g, selected, target);
        if (!valid) { message = 'That move is not legal. Try another destination. No turn used.'; draw(); return; }
        if (!A.spend('solitaire')) { message = 'Answer more quiz questions to earn another turn. Your selection and deal are saved.'; draw(); return; }
        solMove(g, selected, kind, target); selected = null; message = '';
        if (!g.won && g.foundations.every(pile => pile.length === 13)) { g.won = true; A.win('solitaire'); message = 'You completed Solitaire! A trophy has been added to your collection.'; }
        save(); draw();
      }
      draw(); save(); return {};
    }
  });

  /* ------------------------- Turn-based Tetris ------------------------- */
  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]], L: [[0,0,1],[1,1,1],[0,0,0]],
    O: [[1,1],[1,1]], S: [[0,1,1],[1,1,0],[0,0,0]],
    T: [[0,1,0],[1,1,1],[0,0,0]], Z: [[1,1,0],[0,1,1],[0,0,0]]
  };
  const TYPES = Object.keys(SHAPES);
  const tetrisPalettes = {
    classic: {I:'#32cee0', J:'#537ff2', L:'#f5a349', O:'#f2d955', S:'#61c877', T:'#ba78e6', Z:'#ef7076'},
    pastel: {I:'#b2e9ec', J:'#b7cdf5', L:'#ffd0a3', O:'#f8eaaa', S:'#bee7bd', T:'#d9bfed', Z:'#f3b6c1'},
    neon: {I:'#00f5ff', J:'#5371ff', L:'#ff9515', O:'#fff500', S:'#58ff47', T:'#db45ff', Z:'#ff457d'},
    mono: {I:'#d8e7ef', J:'#bfd4df', L:'#a5c1d0', O:'#8bafc1', S:'#719eb2', T:'#58899e', Z:'#40758b'}
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
    if (piece.type === 'O') return {...piece};
    for (const dy of [0, -1, -2]) for (const dx of [0, -1, 1, -2, 2]) {
      const next = {...piece, rot: ((piece.rot || 0) + 1) % 4, x: piece.x + dx, y: piece.y + dy};
      if (tetrisFits(board, next)) return next;
    }
    return null;
  }
  function tetrisGhost(board, piece) {
    let p = {...piece}; while (tetrisFits(board, {...p, y: p.y + 1})) p.y++; return p;
  }
  function tetrisLock(board, piece) {
    const next = board.map(row => row.slice()); const landed = tetrisGhost(next, piece); const m = tetrisMatrix(landed);
    let overflow = false;
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x]) {
      const by = landed.y + y, bx = landed.x + x;
      if (by < 0) overflow = true; else next[by][bx] = piece.type;
    }
    const kept = next.filter(row => row.some(v => !v)); const lines = 20 - kept.length;
    while (kept.length < 20) kept.unshift(Array(10).fill(''));
    return {board: kept, lines, distance: landed.y - piece.y, overflow};
  }
  function takeBag(g) { if (!g.bag?.length) g.bag = shuffle(TYPES); return g.bag.pop(); }
  const spawnPiece = type => ({type, x: type === 'O' ? 4 : 3, y: 0, rot: 0});
  function freshTetris(prefs) {
    const goal = [5, 10, 20, 40].includes(+prefs.target) ? +prefs.target : 10;
    const g = {board: Array.from({length: 20}, () => Array(10).fill('')), bag: [], next: '', piece: null, lines: 0, score: 0, moves: 0, won: false, over: false, goal};
    g.piece = spawnPiece(takeBag(g)); g.next = takeBag(g); return g;
  }
  A.register('tetris', {
    title: 'Tetris', icon: '🧩', description: 'A thoughtful, turn-based falling-block puzzle. One locked piece uses one earned turn.',
    mount(host) {
      const data = getData('tetris', {target: 10, palette: 'classic', background: '#142337', grid: true, ghost: true, squareBlocks: false});
      if (!data.game || data.game.board?.length !== 20 || !SHAPES[data.game.piece?.type]) data.game = freshTetris(data.prefs);
      let g = data.game, message = '';
      const score = h('div.ag-score'), status = h('p.ag-status', {attrs: {'aria-live': 'polite'}});
      const board = h('div.ag-tetris-board', {tabIndex: 0, attrs: {role: 'img', 'aria-label': 'Tetris board'}});
      const preview = h('div.ag-tetris-next');
      const instructions = h('p.hint', {text: 'Turn-based Tetris: take your time to position each piece. ← → move, ↑ rotates, ↓ previews one row down, and Space drops. Only Drop locks a piece and spends a turn. Clear the line target to earn a trophy.'});
      const setPref = (key, value) => { data.prefs[key] = value; save(); draw(); };
      const opts = settings(
        field('Block palette', select('Tetris block palette', Object.keys(tetrisPalettes).map(x => [x, x[0].toUpperCase() + x.slice(1)]), data.prefs.palette, v => setPref('palette', v))),
        field('Board background', color('Tetris board background', data.prefs.background, v => setPref('background', v))),
        field('Line target', select('Tetris line target', [[5, '5 lines — Quick'], [10, '10 lines — Classic'], [20, '20 lines'], [40, '40 lines — Marathon']], data.prefs.target, v => setPref('target', +v)), 'Applies to your next new game.'),
        field('Board grid', toggle('Show Tetris board grid', data.prefs.grid, v => setPref('grid', v))),
        field('Landing preview', toggle('Show Tetris landing preview', data.prefs.ghost, v => setPref('ghost', v))),
        field('Square block corners', toggle('Square Tetris block corners', data.prefs.squareBlocks, v => setPref('squareBlocks', v)))
      );
      const moveLeft = button('←', () => adjust(-1, 0), {attrs: {'aria-label': 'Move Tetris piece left'}});
      const rotate = button('↻ Rotate', () => turn(), {attrs: {'aria-label': 'Rotate Tetris piece clockwise'}});
      const moveRight = button('→', () => adjust(1, 0), {attrs: {'aria-label': 'Move Tetris piece right'}});
      const drop = button('Drop ↓', lock, {class: 'btn-primary', attrs: {'aria-label': 'Drop and lock Tetris piece, uses one turn'}});
      const fresh = button('New game', async () => { if (await confirmReset(g.moves)) { g = data.game = freshTetris(data.prefs); message = ''; save(); draw(); } });
      host.replaceChildren(h('div.ag-game.ag-tetris', {}, instructions, score, h('div.ag-tetris-layout', {}, board, h('aside.ag-tetris-aside', {}, h('p.ag-next-label', {text: 'NEXT'}), preview, h('p.hint', {text: 'No falling clock. Three turns = three placed pieces.'}))), status, h('div.ag-controls.ag-tetris-controls', {}, moveLeft, rotate, moveRight, drop, fresh), opts));
      function draw() {
        const colors = tetrisPalettes[data.prefs.palette] || tetrisPalettes.classic;
        const active = new Map(), ghost = new Set();
        const pieceCells = (piece, fn) => tetrisMatrix(piece).forEach((row, y) => row.forEach((v, x) => { if (v && piece.y + y >= 0) fn((piece.y + y) * 10 + piece.x + x); }));
        if (!g.over) { pieceCells(g.piece, index => active.set(index, g.piece.type)); if (data.prefs.ghost) pieceCells(tetrisGhost(g.board, g.piece), index => ghost.add(index)); }
        board.style.background = data.prefs.background; board.style.setProperty('--ag-block-radius', data.prefs.squareBlocks ? '0px' : '3px');
        board.classList.toggle('ag-no-grid', !data.prefs.grid);
        board.replaceChildren(...g.board.flat().map((v, i) => {
          const fill = v || active.get(i); const isGhost = !fill && ghost.has(i);
          return h('div.ag-tetris-cell', {class: `${fill ? 'ag-filled' : ''}${isGhost ? ' ag-ghost' : ''}`, style: {background: fill ? colors[fill] : '', borderColor: isGhost ? colors[g.piece.type] : ''}});
        }));
        board.setAttribute('aria-label', `Tetris board. ${g.lines} lines cleared, ${g.goal} line target. Current piece ${g.piece.type}, column ${g.piece.x + 1}. ${g.over ? 'Game over.' : ''}`);
        const nextM = SHAPES[g.next];
        preview.style.gridTemplateColumns = `repeat(${nextM.length}, 1fr)`;
        preview.replaceChildren(...nextM.flat().map(v => h('i', {style: {background: v ? colors[g.next] : 'transparent'}})));
        score.replaceChildren(h('span', {text: `Lines ${g.lines}/${g.goal}`}), h('span', {text: `Score ${g.score.toLocaleString()}`}), h('span', {text: `${g.moves} pieces`}));
        [moveLeft, moveRight, rotate, drop].forEach(node => { node.disabled = g.over; });
        status.textContent = message || (g.over ? 'The stack reached the top. Start a new game to try again.' : g.won ? 'Line target cleared! Trophy earned. Keep playing with your remaining turns.' : credits('tetris') ? 'Position your piece, then Drop to use one turn.' : 'Your board is saved. Answer more quiz questions to earn turns.');
      }
      function ready() {
        if (g.over) return false;
        if (!credits('tetris')) { message = 'Earn more quiz turns before positioning your next piece. Your board is saved.'; draw(); return false; }
        return true;
      }
      function adjust(dx, dy) {
        if (!ready()) return;
        const p = {...g.piece, x: g.piece.x + dx, y: g.piece.y + dy};
        if (tetrisFits(g.board, p)) { g.piece = p; message = ''; save(); draw(); }
      }
      function turn() {
        if (!ready()) return;
        const p = tetrisRotate(g.board, g.piece);
        if (p) { g.piece = p; message = ''; save(); draw(); }
      }
      function lock() {
        if (g.over) return;
        if (!A.spend('tetris')) { message = 'Answer more quiz questions to earn another Drop. Your piece is saved.'; draw(); return; }
        const result = tetrisLock(g.board, g.piece);
        g.board = result.board; g.lines += result.lines; g.moves++;
        g.score += [0, 100, 300, 500, 800][result.lines] + result.distance * 2;
        g.piece = spawnPiece(g.next); g.next = takeBag(g);
        g.over = result.overflow || !tetrisFits(g.board, g.piece);
        message = result.lines ? `${result.lines} ${result.lines === 1 ? 'line' : 'lines'} cleared!` : '';
        if (!g.won && g.lines >= g.goal) { g.won = true; A.win('tetris'); message = `You cleared ${g.goal} lines! A Tetris trophy has been added to your collection.`; }
        save(); draw();
      }
      const off = keyboard(host, e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); adjust(-1, 0); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); adjust(1, 0); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); adjust(0, 1); }
        else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'x') { e.preventDefault(); turn(); }
        else if (e.code === 'Space' && !e.repeat) { e.preventDefault(); lock(); }
      });
      draw(); save(); return {destroy: off};
    }
  });

  // Pure game mechanics are exposed for local verification and future extensions.
  window.SSArcadeMechanics = {slide2048, spawn2048, moves2048, fresh2048, freshSolitaire, solSource, solCanTableau, solCanFoundation, solMove, solDraw, solHint, rotateMatrix, tetrisMatrix, tetrisFits, tetrisRotate, tetrisGhost, tetrisLock, freshTetris};
})(window.SS);
