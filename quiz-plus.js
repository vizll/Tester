/* Tester — the Quiz tab: study sets (search, subjects, create, edit, duplicate, import/export, delete),
   flashcards, and practice sessions where questions sit on the left and the student's game is docked on
   the right. Correctly checked answers unlock moves through SS.play's learning gate (3 → 3 by default). */
(function (SS) {
  'use strict';
  const U = SS.util;
  const { el } = U;
  const P = SS.play;
  const C = SS.cards;
  const MAX_QUESTIONS = 500;
  const NARROW = 860;
  const shuffle = items => { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  const norm = value => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const valid = cards => (cards || []).map(c => ({ term: String(c?.term || '').trim(), def: String(c?.def || '').trim() })).filter(c => c.term && c.def);
  const MODES = [{ value: 'mixed', label: 'Mixed' }, { value: 'choice', label: 'Multiple choice' }, { value: 'written', label: 'Written answer' }, { value: 'tf', label: 'True / false' }];
  const DIRECTIONS = [{ value: 'def', label: 'Show the term → answer with the definition' }, { value: 'term', label: 'Show the definition → answer with the term' }];
  const sets = () => SS.data.all('quizzes');
  const btn = (text, fn, cls = '', extra = {}) => el('button.btn', { type: 'button', class: cls, on: { click: fn }, ...extra }, text);
  /* restart a CSS animation class on a node (animations are off when the app's reduce-motion setting is on) */
  const replay = (node, cls) => { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };

  /* ---------------- Grading ---------------- */
  /* Small typos may count; a changed number, sign or negation never does. Strict mode ignores only case and spacing. */
  function gradeAnswer(user, expected, strict = false) {
    const actual = norm(user), wanted = norm(expected);
    if (!actual) return { ok: false, close: false };
    if (actual === wanted) return { ok: true, close: false };
    if (strict) return { ok: false, close: false };
    const quantities = text => JSON.stringify(text.replace(/(?<=\d),(?=\d{3}\b)/g, '').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) || []);
    if (quantities(actual) !== quantities(wanted)) return { ok: false, close: false };
    const negated = text => /\b(?:no|not|never|without|cannot)\b|n['’]t\b/.test(text);
    if (negated(actual) !== negated(wanted)) return { ok: false, close: false };
    const symbols = text => (text.match(/[=+<>×÷^%−]|(?<=[a-z0-9])-(?=$|\s|[0-9])/g) || []).join('');
    if (symbols(actual) !== symbols(wanted)) return { ok: false, close: false };
    return C.grade(actual, wanted);
  }

  /* ---------------- Import & export (Quizlet export text, TSV, CSV, custom separators) ---------------- */
  function detect(text) {
    // Ignore delimiters inside quoted CSV fields; prefer the separator found on the most lines, earliest in the line.
    const visible = String(text).replace(/"(?:[^"]|"")*"/g, token => ' '.repeat(token.length));
    const lines = visible.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim()).slice(0, 100);
    return ['\t', ',', ';', ' - ', ' – ', ' — ', ': '].map(sep => {
      const hits = lines.filter(line => line.includes(sep));
      return { sep, count: hits.length, first: hits.reduce((sum, line) => sum + line.indexOf(sep) / Math.max(1, line.length), 0) / Math.max(1, hits.length) };
    }).sort((a, b) => b.count - a.count || a.first - b.first)[0]?.sep || '\t';
  }
  function parseImport(text, separator = 'auto', cardSeparator = '\n', skipHeader = false) {
    const source = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    if (source.length > 4 * 1024 * 1024) return { cards: [], errors: ['Import text must be smaller than 4 million characters.'], separator: '' };
    const sep = separator === 'auto' ? detect(source) : String(separator).replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    const rowSep = String(cardSeparator || '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (!sep || !rowSep || sep === rowSep) return { cards: [], errors: ['The term separator and the card separator must be different and not empty.'], separator: sep };
    const rows = []; let cells = [], cell = '', quoted = false, closedQuote = false, malformedQuote = false;
    for (let i = 0; i < source.length;) {
      const ch = source[i];
      if (ch === '"' && (quoted || !cell.trim())) {
        if (quoted && source[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (quoted) { quoted = false; closedQuote = true; } else { quoted = true; closedQuote = false; cell = ''; }
        i++; continue;
      }
      if (!quoted && source.startsWith(rowSep, i)) { cells.push(cell); rows.push(cells); if (rows.length > 10000) return { cards: [], errors: ['Import up to 5,000 cards (10,000 lines) at a time.'], separator: sep }; cells = []; cell = ''; closedQuote = false; i += rowSep.length; continue; }
      if (!quoted && source.startsWith(sep, i)) { cells.push(cell); cell = ''; closedQuote = false; i += sep.length; continue; }
      if (closedQuote && !/\s/.test(ch)) malformedQuote = true;
      cell += ch; i++;
    }
    cells.push(cell); rows.push(cells);
    const errors = [], cards = [];
    if (quoted) errors.push('A quoted field is missing its closing quote (").');
    if (malformedQuote) errors.push('Text after a closing quote must start a new field.');
    rows.forEach((row, i) => {
      if (row.every(v => !v.trim())) return;
      if (skipHeader && !cards.length && /^(term|question|front|word)$/i.test(row[0].trim()) && /^(definition|answer|back|meaning)$/i.test((row[1] || '').trim())) return;
      const term = (row[0] || '').trim(), def = row.slice(1).join(sep).trim();
      if (row.length < 2 || !term || !def) { errors.push(`Line ${i + 1}: needs a term and a definition separated by ${sep === '\t' ? 'a Tab' : `“${sep}”`}.`); return; }
      if (term.length > 4000 || def.length > 4000) { errors.push(`Line ${i + 1}: each side can be at most 4,000 characters.`); return; }
      if (cards.length >= 5000) { if (!errors.includes('Import up to 5,000 cards at a time.')) errors.push('Import up to 5,000 cards at a time.'); return; }
      cards.push({ term, def });
    });
    return { cards, errors, separator: sep };
  }
  const quoteField = (v, sep) => (/["\n\r]/.test(v) || v.includes(sep) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  function exportSet(set, format) {
    const sep = format === 'csv' ? ',' : '\t';
    const lines = (format === 'csv' ? ['term,definition'] : []).concat(set.cards.map(c => `${quoteField(c.term, sep)}${sep}${quoteField(c.def, sep)}`));
    const name = (set.title || 'study-set').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'study-set';
    U.download(`${name}.${format === 'csv' ? 'csv' : 'tsv'}`, lines.join('\n') + '\n', format === 'csv' ? 'text/csv' : 'text/tab-separated-values');
    SS.ui.toast(format === 'csv' ? 'Exported as CSV (term, definition)' : 'Exported as tab-separated text — the format Quizlet’s “Import” accepts', { kind: 'success' });
  }

  /* "0%" counting up to the score */
  function countUp(node, to) {
    if (!node) return;
    if (U.reducedMotion() || to <= 0) { node.textContent = `${to}%`; return; }
    const t0 = performance.now(), dur = 900;
    const step = now => { if (!node.isConnected) return; const k = Math.min(1, (now - t0) / dur); node.textContent = `${Math.round(to * (1 - Math.pow(1 - k, 3)))}%`; if (k < 1) requestAnimationFrame(step); };
    node.textContent = '0%'; requestAnimationFrame(step);
  }

  /* ---------------- Sessions ---------------- */
  function buildQuestions(cards, all, options) {
    const dir = options.direction;
    const chosen = options.shuffle ? shuffle(valid(cards)) : valid(cards);
    const answers = [...new Set(valid(all).map(c => (dir === 'term' ? c.term : c.def)))];
    return chosen.slice(0, Math.min(options.limit, MAX_QUESTIONS)).map((card, i) => {
      let mode = options.mode === 'mixed' ? ['choice', 'written', 'tf'][i % 3] : options.mode;
      const prompt = dir === 'term' ? card.def : card.term, expected = dir === 'term' ? card.term : card.def;
      const distractors = shuffle(answers.filter(text => norm(text) !== norm(expected)));
      if ((mode === 'choice' || mode === 'tf') && !distractors.length) mode = 'written';
      const isTrue = mode === 'tf' ? Math.random() < 0.5 : true;
      return { id: `q${i + 1}`, term: card.term, def: card.def, prompt, expected, mode, choices: mode === 'choice' ? shuffle([expected, ...distractors.slice(0, 3)]) : [], shown: mode === 'tf' ? (isTrue ? expected : distractors[0]) : '', isTrue, user: null, checked: false, ok: false, close: false, override: false };
    });
  }
  function newSession(set, options, cards) {
    const questions = buildQuestions(cards || set.cards, set.cards, options);
    return { id: U.uid('qs'), setId: set.id, setTitle: set.title, options: { ...options }, questions, index: 0, finished: false, startedAt: Date.now(), retry: !!cards };
  }
  function sanitizeSession(raw) {
    if (!U.isObj(raw) || !Array.isArray(raw.questions) || !raw.questions.length) return null;
    const qs = raw.questions.slice(0, MAX_QUESTIONS).filter(U.isObj).map((q, i) => {
      const mode = ['choice', 'written', 'tf'].includes(q.mode) ? q.mode : 'written';
      const s = v => U.str(v, 4000);
      return { id: U.str(q.id, 20) || `q${i + 1}`, term: s(q.term), def: s(q.def), prompt: s(q.prompt), expected: s(q.expected), mode, choices: Array.isArray(q.choices) ? q.choices.slice(0, 6).map(s) : [], shown: s(q.shown), isTrue: q.isTrue !== false,
        user: mode === 'tf' ? (typeof q.user === 'boolean' ? q.user : null) : (typeof q.user === 'string' ? s(q.user) : null), checked: !!q.checked, ok: !!q.ok, close: !!q.close, override: !!q.override };
    }).filter(q => q.prompt && q.expected);
    if (!qs.length) return null;
    return { id: /^qs_[\w]{1,40}$/.test(raw.id) ? raw.id : U.uid('qs'), setId: U.str(raw.setId, 80), setTitle: U.str(raw.setTitle, 200) || 'Study set', options: P.quizOptions(raw.options || {}), questions: qs, index: U.clampNum(Math.floor(raw.index), 0, qs.length, 0), finished: !!raw.finished || raw.index >= qs.length, startedAt: Number(raw.startedAt) || Date.now(), retry: !!raw.retry };
  }

  /* ---------------- The page ---------------- */
  let page = null;            // the mounted view, or null
  let section = 'sets';       // which part of the Quiz tab is open
  let pending = null;         // { section, setId } requested before mounting
  const SECTIONS = [{ id: 'sets', label: 'Study sets', icon: 'cards' }, { id: 'practice', label: 'Quiz & play', icon: 'checklist' }, { id: 'games', label: 'Games & wins', icon: 'trophy' }, { id: 'settings', label: 'Settings', icon: 'sliders' }];

  const Q = SS.quiz = {
    parseImport, gradeAnswer, exportSet, sanitizeSession, buildQuestions, detect,
    mounted: () => !!page,
    mount(host) {
      if (page) Q.unmount();
      if (pending) { section = pending.section || section; }
      else if (P.state.session && !P.state.session.finished) section = 'practice';
      page = createPage(host);
      const req = pending || {}; pending = null;
      page.show(section, req);
    },
    unmount() { if (page) { page.destroy(); page = null; } },
    /* Open the Quiz tab at a section, e.g. open('practice', { setId }) */
    open(sec = 'sets', opts = {}) {
      if (page && SS.ws.view() === 'quiz') { page.show(sec, opts); return; }
      pending = { section: sec, ...opts };
      SS.nav.go('quiz');
    },
    practice: setId => Q.open('practice', { setId, setup: true }),
    edit: (setId, opts) => editSet(setId, opts),
    remove: setId => removeSet(setId)
  };

  function createPage(host) {
    const offs = [];
    const tabs = el('div.qz-tabs', { role: 'tablist', aria: { label: 'Quiz sections' } });
    const gate = el('p.qz-gate', { attrs: { 'aria-live': 'polite' } });
    const body = el('div.qz-body');
    const root = el('div.qz', el('header.qz-head', el('div.qz-titles', el('h1', { tabIndex: -1, text: 'Quiz' }), el('p.qz-sub', { text: 'Study sets, flashcards and quizzes — with a game beside your questions.' })), gate), tabs, body);
    host.replaceChildren(root);
    let current = null, view = null;
    const tabBtns = SECTIONS.map(s => el('button.qz-tab', { type: 'button', role: 'tab', id: `qz-tab-${s.id}`, aria: { controls: 'qz-panel' }, dataset: { id: s.id }, on: { click: () => show(s.id) } }, SS.icon(s.icon, 16), el('span', { text: s.label })));
    // the highlight behind the selected tab glides between tabs
    const ink = el('span.qz-tab-ink', { aria: { hidden: 'true' } });
    tabs.append(ink, ...tabBtns);
    const moveInk = () => { const b = tabBtns.find(x => x.classList.contains('on')); if (!b || !b.offsetWidth) return; ink.style.width = `${b.offsetWidth}px`; ink.style.transform = `translateX(${b.offsetLeft}px)`; tabs.classList.add('has-ink'); };
    const inkRo = new ResizeObserver(U.raf(moveInk)); inkRo.observe(tabs);
    offs.push(() => inkRo.disconnect());
    requestAnimationFrame(() => requestAnimationFrame(() => tabs.classList.add('ink-ready')));
    tabs.addEventListener('keydown', e => {
      const i = tabBtns.indexOf(document.activeElement); if (i < 0) return;
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabBtns.length - 1 }[e.key]; if (j == null) return;
      e.preventDefault(); const b = tabBtns[(j + tabBtns.length) % tabBtns.length]; b.focus(); show(b.dataset.id);
    });
    body.id = 'qz-panel'; body.setAttribute('role', 'tabpanel');
    const paintGate = () => {
      const g = P.progress(); const id = P.game();
      gate.replaceChildren(el('span.qz-gate-game', { text: `${P.icon(id)} ${P.title(id)}` }), el('span', { text: `${g.have} of ${g.need} correct` }), el('span.qz-gate-moves', { text: K().movesLabel(id) }));
      gate.title = `Every ${g.need} correct answers unlock ${U.plural(g.grant, 'move')} in your selected game.`;
    };
    offs.push(SS.bus.on('play', e => { if (['answer', 'spend', 'game', 'settings', 'load'].includes(e.type)) paintGate(); }));
    paintGate();
    function show(id, opts) {
      opts = opts || {};
      if (!SECTIONS.some(s => s.id === id)) id = 'sets';
      section = id;
      tabBtns.forEach(b => { const on = b.dataset.id === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); });
      moveInk();
      body.setAttribute('aria-labelledby', `qz-tab-${id}`);
      if (current === id && view && view.update) { view.update(opts); return; }
      if (view) view.destroy();
      // the new section slides in from the side of the tab it came from
      const from = SECTIONS.findIndex(x => x.id === current), to = SECTIONS.findIndex(x => x.id === id);
      body.style.setProperty('--qz-dx', from < 0 ? '0px' : `${Math.sign(to - from) * 26}px`);
      body.style.setProperty('--qz-dy', from < 0 ? '12px' : '0px');
      current = id;
      root.dataset.section = id;
      view = ({ sets: setsView, practice: practiceView, games: gamesView, settings: settingsView })[id](body, opts);
      replay(body, 'qz-enter');
    }
    return {
      show,
      destroy() { offs.forEach(off => off()); if (view) view.destroy(); view = null; host.replaceChildren(); }
    };
  }
  const K = () => P.kit;

  /* ======================= Study sets ======================= */
  let filters = { q: '', subject: 'all', sort: 'recent' };
  function setsView(host) {
    const offs = [];
    const search = el('input.input.qz-search', { type: 'search', placeholder: 'Search sets and cards…', value: filters.q, aria: { label: 'Search study sets' } });
    const subject = el('select.input.qz-filter', { aria: { label: 'Filter by subject' } });
    const sort = SS.ui.select({ label: 'Sort sets', value: filters.sort, options: [{ value: 'recent', label: 'Newest first' }, { value: 'name', label: 'A–Z' }, { value: 'size', label: 'Most cards' }], onChange: v => { filters.sort = v; draw(); } });
    sort.classList.add('qz-filter');
    const grid = el('div.qz-sets', { role: 'list', aria: { label: 'Study sets' } });
    const resume = el('div');
    const fillSubjects = () => {
      subject.replaceChildren(el('option', { value: 'all', text: 'All subjects' }), ...SS.data.all('subjects').map(s => el('option', { value: s.id, text: s.name })), el('option', { value: 'none', text: 'No subject' }));
      subject.value = [...subject.options].some(o => o.value === filters.subject) ? filters.subject : 'all';
    };
    search.addEventListener('input', U.debounce(() => { filters.q = search.value; draw(); }, 120));
    subject.addEventListener('change', () => { filters.subject = subject.value; draw(); });
    host.replaceChildren(el('section.qz-section',
      resume,
      el('div.qz-toolbar', search, subject, sort, el('span.grow'), btn([SS.icon('upload', 15), 'Import'], () => editSet(null, { mode: 'import' })), btn([SS.icon('plus', 15), 'New set'], () => editSet(null), 'btn-primary')),
      grid));
    function draw() {
      const s = P.state.session;
      resume.replaceChildren(s && !s.finished ? el('div.qz-resume', SS.icon('play', 16), el('span', { text: `Quiz in progress: “${s.setTitle}” — question ${s.index + 1} of ${s.questions.length}.` }), btn('Continue', () => Q.open('practice'), 'btn-primary btn-sm')) : '');
      const q = norm(filters.q);
      let list = sets().filter(set => (filters.subject === 'all' || (filters.subject === 'none' ? !set.subjectId || !SS.data.subject(set.subjectId) : set.subjectId === filters.subject))
        && (!q || norm(set.title).includes(q) || set.cards.some(c => norm(c.term).includes(q) || norm(c.def).includes(q))));
      list = filters.sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : filters.sort === 'size' ? [...list].sort((a, b) => b.cards.length - a.cards.length) : [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      grid.replaceChildren();
      if (!sets().length) { grid.append(SS.ui.empty('cards', 'No study sets yet', 'Type your own cards, paste text exported from Quizlet, or import a CSV/TSV file.', el('div.row-gap', btn('Create a set', () => editSet(null), 'btn-primary btn-sm'), btn('Import', () => editSet(null, { mode: 'import' }), 'btn-sm')))); return; }
      if (!list.length) { grid.append(SS.ui.empty('search', 'No sets match', 'Try another word or subject.', btn('Clear filters', () => { filters = { ...filters, q: '', subject: 'all' }; search.value = ''; subject.value = 'all'; draw(); }, 'btn-sm'))); return; }
      list.forEach((set, i) => {
        const subj = SS.data.subject(set.subjectId);
        const usable = valid(set.cards).length;
        grid.append(el('article.qz-set', { role: 'listitem', style: { '--k': subj ? subj.color : U.SUBJECT_COLORS[i % U.SUBJECT_COLORS.length], '--i': String(Math.min(i, 12)) } },
          el('div.qz-set-main', el('div.qz-set-top', el('h3', { text: set.title }), el('div.qz-set-tools',
            SS.ui.iconBtn('edit', `Edit ${set.title}`, () => editSet(set.id), 'sm'),
            el('button.icon-btn.sm', { type: 'button', title: 'More', aria: { label: `More options for ${set.title}`, haspopup: 'menu' }, on: { click: e => SS.ui.menu([
              { heading: set.title },
              { label: 'Duplicate', icon: 'copy', onClick: () => duplicateSet(set.id) },
              { label: 'Export for Quizlet (tab-separated)', icon: 'download', disabled: !set.cards.length, onClick: () => exportSet(set, 'tsv') },
              { label: 'Export as CSV', icon: 'download', disabled: !set.cards.length, onClick: () => exportSet(set, 'csv') },
              '-',
              { label: 'Delete set…', icon: 'trash', danger: true, onClick: () => removeSet(set.id) }
            ], { anchor: e.currentTarget, label: `${set.title} options` }) } }, SS.icon('more', 16)))),
            el('p.qz-set-meta', subj ? SS.ui.subjectChip(set.subjectId) : null, el('span', { text: U.plural(set.cards.length, 'card') }))),
          el('div.qz-set-actions',
            btn('Flashcards', () => C.study(set.id), 'btn-sm', { disabled: !usable }),
            btn('Quiz & play', () => Q.practice(set.id), 'btn-sm btn-primary', { disabled: !usable, title: usable ? '' : 'Add cards with both a term and a definition first' }))));
      });
    }
    fillSubjects(); draw();
    offs.push(SS.bus.on('data:quizzes', draw), SS.bus.on('data:subjects', () => { fillSubjects(); draw(); }));
    return { destroy: () => offs.forEach(o => o()) };
  }
  function duplicateSet(id) {
    const set = SS.data.get('quizzes', id); if (!set) return;
    const copy = SS.data.add('quizzes', { title: `${set.title} (copy)`.slice(0, 200), subjectId: set.subjectId, cards: U.clone(set.cards) });
    if (copy) SS.ui.toast(`Duplicated as “${copy.title}”`, { kind: 'success', action: { label: 'Edit', fn: () => editSet(copy.id) } });
  }
  async function removeSet(id) {
    const set = SS.data.get('quizzes', id); if (!set) return false;
    if (!(await SS.ui.confirm({ title: 'Delete this study set?', message: `“${set.title}” and its ${U.plural(set.cards.length, 'card')} will be removed. You can undo right after.`, ok: 'Delete set' }))) return false;
    SS.data.remove('quizzes', id, { label: `Study set “${set.title}” deleted` });
    return true;
  }

  /* ---------------- Set editor ---------------- */
  function editSet(setId, opts = {}) {
    const set = setId ? SS.data.get('quizzes', setId) : null;
    let dirty = false, discard = false;
    const dlg = SS.ui.dialog({ eyebrow: set ? 'Edit study set' : 'New study set', title: set ? set.title : 'Create a study set', size: 'lg', class: 'qz-editor',
      onBeforeClose: result => {
        if (result === 'saved' || discard || !dirty) return true;
        SS.ui.confirm({ title: 'Discard your changes?', message: 'You have unsaved cards or edits in this set.', ok: 'Discard changes', cancel: 'Keep editing' }).then(ok => { if (ok) { discard = true; dlg.close(); } });
        return false;
      } });
    const touch = () => { dirty = true; };
    const title = SS.ui.input({ value: set ? set.title : (opts.title || ''), label: 'Study set title', placeholder: 'e.g. Biology · Chapter 3', maxLength: 200 });
    title.addEventListener('input', touch);
    let subjectId = set ? set.subjectId : (opts.subjectId || '');
    const subject = SS.ui.subjectSelect(subjectId, v => { subjectId = v; touch(); });
    const rows = el('ol.qz-rows', { aria: { label: 'Cards' } });
    const count = el('span.hint');
    const renumber = () => { [...rows.children].forEach((row, i) => { row.querySelector('.qz-row-n').textContent = i + 1; row.querySelector('.qz-up').disabled = i === 0; row.querySelector('.qz-down').disabled = i === rows.children.length - 1; }); count.textContent = U.plural(rows.children.length, 'card'); };
    const moveRow = (row, dir) => {
      const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sib) return;
      if (dir < 0) sib.before(row); else sib.after(row);
      touch(); renumber(); row.querySelector(dir < 0 ? '.qz-up' : '.qz-down').focus();
      SS.ui.announce(`Card moved to position ${[...rows.children].indexOf(row) + 1}.`);
    };
    function addRow(term = '', def = '', at = null) {
      const front = el('textarea.input', { rows: 2, maxLength: 4000, placeholder: 'Term / question', aria: { label: 'Term or question' } }); front.value = term;
      const back = el('textarea.input', { rows: 2, maxLength: 4000, placeholder: 'Definition / answer', aria: { label: 'Definition or answer' } }); back.value = def;
      const grip = el('span.qz-grip', { title: 'Drag to reorder', aria: { hidden: 'true' } }, SS.icon('grip', 14));
      const row = el('li.qz-row', el('div.qz-row-side', grip, el('span.qz-row-n')), front, back,
        el('div.qz-row-tools',
          el('button.icon-btn.xs.qz-up', { type: 'button', title: 'Move up', aria: { label: 'Move card up' }, on: { click: () => moveRow(row, -1) } }, SS.icon('arrowUp', 14)),
          el('button.icon-btn.xs.qz-down', { type: 'button', title: 'Move down', aria: { label: 'Move card down' }, on: { click: () => moveRow(row, 1) } }, SS.icon('arrowDown', 14)),
          el('button.icon-btn.xs', { type: 'button', title: 'Remove card', aria: { label: 'Remove card' }, on: { click: () => { const next = row.nextElementSibling || row.previousElementSibling; row.remove(); touch(); renumber(); next?.querySelector('textarea')?.focus(); } } }, SS.icon('trash', 14))));
      [front, back].forEach(x => x.addEventListener('input', () => { touch(); row.classList.remove('qz-invalid'); }));
      back.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey && row === rows.lastElementChild && (front.value.trim() || back.value.trim())) { e.preventDefault(); addRow().querySelector('textarea').focus(); } });
      row.addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveRow(row, e.key === 'ArrowUp' ? -1 : 1); } });
      grip.addEventListener('pointerdown', e => dragRow(e, row));
      if (at) at.after(row); else rows.append(row);
      renumber();
      return row;
    }
    function dragRow(e, row) {
      e.preventDefault();
      row.classList.add('dragging');
      const move = ev => { const others = [...rows.children].filter(r => r !== row); const before = others.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }); if (before) rows.insertBefore(row, before); else rows.append(row); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); row.classList.remove('dragging'); touch(); renumber(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    }
    (set && set.cards.length ? set.cards : [{}, {}, {}]).forEach(c => addRow(c.term || '', c.def || ''));
    dirty = false;
    const manual = el('section.qz-manual', el('div.qz-rows-head', el('b', { text: 'Cards' }), count, el('span.hint', { text: 'Alt + ↑/↓ moves the card you’re in.' })), rows, btn([SS.icon('plus', 14), 'Add card'], () => { addRow().querySelector('textarea').focus(); touch(); }, 'btn-sm'));
    // Import
    const area = el('textarea.input.qz-import-area', { rows: 8, spellcheck: false, placeholder: 'Paste text exported from Quizlet (term, Tab, definition — one card per line) or CSV.\n\nCell\tBasic unit of life\nMitochondria\tProduces cellular energy', aria: { label: 'Text to import' } });
    area.value = opts.importText || '';
    const separator = SS.ui.select({ label: 'Between term and definition', value: 'auto', options: [{ value: 'auto', label: 'Detect automatically' }, { value: '\t', label: 'Tab (Quizlet default)' }, { value: ',', label: 'Comma (CSV)' }, { value: ';', label: 'Semicolon' }, { value: ' - ', label: 'Spaced dash ( - )' }, { value: 'custom', label: 'Custom…' }] });
    const custom = SS.ui.input({ value: ' | ', label: 'Custom term separator', maxLength: 16 });
    const customField = SS.ui.field('Custom separator', custom); customField.hidden = true;
    const rowSep = SS.ui.select({ label: 'Between cards', value: '\n', options: [{ value: '\n', label: 'New line (Quizlet default)' }, { value: ';', label: 'Semicolon' }, { value: '\n\n', label: 'Blank line' }] });
    const header = el('input', { type: 'checkbox', checked: true });
    const file = el('input', { type: 'file', accept: '.txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv', aria: { label: 'Import a text, CSV or TSV file' } });
    const preview = el('div.qz-preview', { attrs: { 'aria-live': 'polite' } });
    let parsed = { cards: [], errors: [] };
    function refresh() {
      customField.hidden = separator.value !== 'custom';
      parsed = parseImport(area.value, separator.value === 'custom' ? custom.value : separator.value, rowSep.value, header.checked);
      preview.replaceChildren();
      if (!area.value.trim()) { preview.append(el('p.hint', { text: 'In Quizlet, open your set → ⋯ → Export, copy the text, and paste it here. This imports exported text only — Tester doesn’t connect to Quizlet accounts or read Quizlet links.' })); return; }
      preview.append(el('p.qz-preview-sum', el('strong', { text: `${U.plural(parsed.cards.length, 'card')} ready` }), parsed.errors.length ? el('span.qz-bad', { text: ` · ${U.plural(parsed.errors.length, 'problem')}` }) : null, el('span.hint', { text: ` · separator: ${parsed.separator === '\t' ? 'Tab' : `“${parsed.separator}”`}` })));
      if (parsed.errors.length) preview.append(el('div.qz-errors', { role: 'alert' }, parsed.errors.slice(0, 6).map(m => el('p', { text: m })), parsed.errors.length > 6 ? el('p', { text: `…and ${parsed.errors.length - 6} more.` }) : null));
      if (parsed.cards.length) {
        preview.append(el('table.qz-preview-table', el('thead', el('tr', el('th', { text: 'Term' }), el('th', { text: 'Definition' }))), el('tbody', parsed.cards.slice(0, 8).map(c => el('tr', el('td', { text: c.term }), el('td', { text: c.def }))))));
        if (parsed.cards.length > 8) preview.append(el('p.hint', { text: `Showing 8 of ${parsed.cards.length}.` }));
      }
    }
    let timer;
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 150); });
    [separator, custom, rowSep, header].forEach(x => x.addEventListener(x === custom ? 'input' : 'change', refresh));
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { SS.ui.toast('Choose a text file smaller than 4 MB.', { kind: 'error' }); file.value = ''; return; }
      try { area.value = await f.text(); if (/\.csv$/i.test(f.name)) separator.value = ','; else if (/\.tsv$/i.test(f.name)) separator.value = '\t'; refresh(); } catch (_) { SS.ui.toast('That file couldn’t be read.', { kind: 'error' }); }
      file.value = '';
    });
    const addImported = () => {
      refresh();
      if (!parsed.cards.length) { SS.ui.toast(parsed.errors.length ? 'Fix the problems listed before importing. Nothing was added.' : 'Paste some cards first.', { kind: 'error' }); return; }
      if (parsed.errors.length) { SS.ui.toast('Some lines have problems. Fix them so no cards are silently skipped. Nothing was added.', { kind: 'error' }); return; }
      const empties = [...rows.children].filter(r => [...r.querySelectorAll('textarea')].every(t => !t.value.trim()));
      empties.forEach(r => r.remove());
      parsed.cards.forEach(c => addRow(c.term, c.def));
      touch(); area.value = ''; refresh(); setMode('manual');
      SS.ui.toast(`${U.plural(parsed.cards.length, 'card')} added below — review them, then save.`, { kind: 'success' });
    };
    const importBox = el('section.qz-import', area,
      el('div.qz-form-grid', SS.ui.field('Between term and definition', separator), customField, SS.ui.field('Between cards', rowSep), SS.ui.field('Or choose a file', file)),
      el('label.check-row', header, el('span', { text: 'Skip a “Term / Definition” header line' })), preview, btn([SS.icon('plus', 14), 'Add these cards'], addImported, 'btn-primary btn-sm'));
    const tabs = SS.ui.segmented({ label: 'How to add cards', value: 'manual', options: [{ value: 'manual', label: 'Write & edit cards', icon: 'edit' }, { value: 'import', label: 'Import text / CSV', icon: 'upload' }], onChange: v => setMode(v) });
    function setMode(v) { tabs.setValue(v); manual.hidden = v !== 'manual'; importBox.hidden = v !== 'import'; if (v === 'import') { refresh(); requestAnimationFrame(() => area.focus()); } }
    dlg.body.append(el('div.qz-form-grid', SS.ui.field('Title', title), SS.ui.field('Subject', subject)), tabs, manual, importBox);
    setMode(opts.mode === 'import' || opts.importText ? 'import' : 'manual');
    const save = () => {
      const cards = []; let bad = 0;
      [...rows.children].forEach(row => { const [f, b] = row.querySelectorAll('textarea'); const t = f.value.trim(), d = b.value.trim(); if (!t && !d) return; if (!t || !d) { bad++; row.classList.add('qz-invalid'); } else cards.push({ term: t, def: d }); });
      if (!title.value.trim()) { title.focus(); title.classList.add('shake'); setTimeout(() => title.classList.remove('shake'), 400); SS.ui.toast('Give your study set a title.', { kind: 'error' }); return; }
      if (bad) { setMode('manual'); rows.querySelector('.qz-invalid textarea')?.focus(); SS.ui.toast(`Complete both sides of ${U.plural(bad, 'highlighted card')}.`, { kind: 'error' }); return; }
      if (!cards.length) { setMode('manual'); SS.ui.toast('Add at least one card with a term and a definition.', { kind: 'error' }); return; }
      if (cards.length > 5000) { SS.ui.toast('Use up to 5,000 cards in one study set.', { kind: 'error' }); return; }
      const t = title.value.trim();
      if (set && SS.data.get('quizzes', set.id)) SS.data.update('quizzes', set.id, { title: t, cards, subjectId });
      else { const created = SS.data.add('quizzes', { title: t, cards, subjectId }); if (created) SS.prefs.patch('ui', { quizId: created.id }); }
      dlg.close('saved');
      SS.ui.toast(`“${t}” saved · ${U.plural(cards.length, 'card')}`, { kind: 'success' });
    };
    U.put(dlg.foot,
      set ? el('button.btn.btn-danger.mr-auto', { type: 'button', on: { click: async () => { if (await removeSet(set.id)) { discard = true; dlg.close(); } } } }, SS.icon('trash', 15), 'Delete set') : null,
      btn('Cancel', () => dlg.close()), btn(set ? 'Save changes' : 'Create study set', save, 'btn-primary'));
    requestAnimationFrame(() => (opts.mode === 'import' ? area : title).focus());
    return dlg;
  }

  /* ======================= Quiz & play (split view) ======================= */
  function practiceView(host, firstOpts = {}) {
    const offs = [];
    const s = P.state;
    const split = el('div.qz-split');
    const left = el('section.qz-quiz', { aria: { label: 'Questions' }, tabIndex: -1 });
    const divider = el('div.qz-divider', { role: 'separator', tabIndex: 0, aria: { orientation: 'vertical', label: 'Resize the game panel', valuemin: 28, valuemax: 72 }, title: 'Drag to resize · arrow keys · double-click to reset' }, el('span'));
    const panel = gamePanel();
    const switcher = SS.ui.segmented({ label: 'Show', value: s.panel.pane, options: [{ value: 'quiz', label: 'Questions', icon: 'checklist' }, { value: 'game', label: 'Game', icon: 'sparkles' }], onChange: v => { s.panel.pane = v; P.save(); layout(); if (v === 'game') panel.focusGame(); } });
    const switchWrap = el('div.qz-switch', switcher);
    split.append(left, divider, panel.el);
    host.replaceChildren(switchWrap, split);

    let narrow = false;
    function layout() {
      split.style.setProperty('--ratio', String(s.panel.ratio));
      divider.setAttribute('aria-valuenow', String(Math.round(s.panel.ratio * 100)));
      divider.setAttribute('aria-valuetext', `Game panel ${Math.round(s.panel.ratio * 100)}% wide`);
      const visible = s.panel.visible;
      split.classList.toggle('narrow', narrow);
      split.classList.toggle('no-game', !visible);
      switchWrap.hidden = !narrow || !visible;
      switcher.setValue(s.panel.pane);
      left.hidden = narrow && visible && s.panel.pane === 'game';
      panel.el.hidden = !visible || (narrow && s.panel.pane !== 'game');
      divider.hidden = narrow || !visible;
      panel.paintExpand(narrow);
      paintGateBits();
    }
    const ro = new ResizeObserver(U.raf(() => { const w = split.clientWidth; if (!w) return; const was = narrow; narrow = w < NARROW; if (was !== narrow) layout(); }));
    ro.observe(split);
    narrow = (host.clientWidth || innerWidth) < NARROW;

    // divider: pointer and keyboard
    divider.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; e.preventDefault(); divider.setPointerCapture(e.pointerId); split.classList.add('resizing');
      const r = split.getBoundingClientRect();
      const moveFn = ev => { s.panel.ratio = U.clamp((r.right - ev.clientX) / r.width, 0.28, 0.72); split.style.setProperty('--ratio', String(s.panel.ratio)); divider.setAttribute('aria-valuenow', String(Math.round(s.panel.ratio * 100))); };
      const up = () => { divider.removeEventListener('pointermove', moveFn); divider.removeEventListener('pointerup', up); divider.removeEventListener('pointercancel', up); split.classList.remove('resizing'); P.save(); layout(); };
      divider.addEventListener('pointermove', moveFn); divider.addEventListener('pointerup', up); divider.addEventListener('pointercancel', up);
    });
    divider.addEventListener('keydown', e => {
      const v = { ArrowLeft: s.panel.ratio + 0.04, ArrowRight: s.panel.ratio - 0.04, Home: 0.72, End: 0.28 }[e.key];
      if (v == null) return;
      e.preventDefault(); s.panel.ratio = U.clamp(v, 0.28, 0.72); P.save(); layout();
    });
    divider.addEventListener('dblclick', () => { s.panel.ratio = 0.46; P.save(); layout(); });

    /* ---- left side: setup, question or results ---- */
    let gateEls = [];
    function paintGateBits(evt) {
      const g = P.progress(); const id = P.game(); const moves = P.actions(id);
      gateEls = gateEls.filter(n => n.isConnected);
      gateEls.forEach(n => n.update && n.update(g, id, moves, evt));
      switcher.querySelector('[data-value="game"] span') && (switcher.querySelector('[data-value="game"] span').textContent = moves ? `Game · ${moves}` : 'Game');
    }
    const g0 = () => P.progress();
    function gateMeter() {
      const node = el('div.qz-meter', { role: 'status', aria: { live: 'polite' } });
      const showBtn = el('button.btn.btn-sm.qz-show-game', { type: 'button', on: { click: () => { s.panel.visible = true; P.save(); layout(); panel.focusGame(); } } });
      let shown = g0().have;
      node.update = (g, id, moves, evt) => {
        const answered = evt && evt.type === 'answer' && evt.counted;
        // a newly earned dot pops in; when moves unlock, every dot flashes and "+3 moves" floats up
        const fresh = answered && !evt.granted && g.have > shown ? g.have - 1 : -1;
        const burst = answered && evt.granted;
        node.replaceChildren(
          el('span.qz-meter-dots', { aria: { hidden: 'true' } }, Array.from({ length: Math.min(g.need, 10) }, (_, i) => el('i', { class: burst ? 'on burst' : i < g.have ? (i === fresh ? 'on pop' : 'on') : '', style: { '--i': String(i) } }))),
          el('span.qz-meter-text', el('b', { text: `${g.have} of ${g.need} correct` }), el('span', { text: ` · ${moves ? U.plural(moves, 'move') : 'no moves'} available in ${P.title(id)}` })),
          burst ? el('span.qz-meter-gain', { text: `+${U.plural(evt.granted, 'move')}`, aria: { hidden: 'true' } }) : '',
          s.panel.visible ? '' : showBtn);
        if (burst) { replay(node, 'qz-unlocked'); setTimeout(() => { if (node.isConnected) node.querySelectorAll('.qz-meter-dots i.burst').forEach(d => { d.className = ''; }); }, 1400); }
        shown = g.have;
        showBtn.textContent = moves ? `Show game · ${U.plural(moves, 'move')}` : 'Show game';
      };
      node.update(P.progress(), P.game(), P.actions());
      gateEls.push(node);
      return node;
    }

    function setup(opts = {}) {
      const all = sets().filter(x => valid(x.cards).length);
      const o = { ...s.quiz };
      left.replaceChildren();
      const head = el('div.qz-qhead', el('div', el('p.eyebrow', { text: 'New quiz' }), el('h2', { text: 'Quiz yourself, then play' })), gateMeter());
      if (!all.length) {
        left.append(head, SS.ui.empty('cards', 'You need a study set first', 'Create or import a set with at least one complete card.', el('div.row-gap', btn('Create a set', () => editSet(null), 'btn-primary btn-sm'), btn('Import', () => editSet(null, { mode: 'import' }), 'btn-sm'))));
        return;
      }
      const preferred = opts.setId && all.some(x => x.id === opts.setId) ? opts.setId : all.some(x => x.id === SS.prefs.get('ui').quizId) ? SS.prefs.get('ui').quizId : all[0].id;
      const setSel = SS.ui.select({ label: 'Study set', value: preferred, options: all.map(x => ({ value: x.id, label: `${x.title} (${U.plural(valid(x.cards).length, 'card')})` })) });
      const mode = SS.ui.select({ label: 'Question style', value: o.mode, options: MODES });
      const dir = SS.ui.select({ label: 'Direction', value: o.direction, options: DIRECTIONS });
      const countIn = el('input.input', { type: 'number', min: 1, step: 1, inputMode: 'numeric', aria: { label: 'Number of questions' } });
      const sizeOf = () => Math.min(MAX_QUESTIONS, valid(SS.data.get('quizzes', setSel.value)?.cards).length);
      const countHint = el('p.hint');
      const syncCount = () => { const n = sizeOf(); countIn.max = n; countIn.value = Math.min(o.limit, n); countHint.textContent = `Up to ${n}. Each card is asked at most once.`; };
      setSel.addEventListener('change', () => { SS.prefs.patch('ui', { quizId: setSel.value }); syncCount(); });
      syncCount();
      const shuf = el('input', { type: 'checkbox', checked: o.shuffle }), strict = el('input', { type: 'checkbox', checked: o.strict });
      const gameSel = SS.ui.select({ label: 'New moves go to', value: P.game(), options: P.GAMES.map(id => ({ value: id, label: `${P.icon(id)} ${P.title(id)}` })), onChange: v => P.setGame(v) });
      const start = () => {
        const set = SS.data.get('quizzes', setSel.value); if (!set) return;
        const options = P.quizOptions({ mode: mode.value, direction: dir.value, limit: U.clampNum(Math.floor(countIn.value), 1, sizeOf(), Math.min(10, sizeOf())), shuffle: shuf.checked, strict: strict.checked });
        s.quiz = options;
        s.session = newSession(set, options);
        s.stats.sessions++;
        P.changed({ type: 'session' });
        question(true);
      };
      left.append(head,
        el('div.qz-form-grid', SS.ui.field('Study set', setSel), SS.ui.field('Question style', mode), SS.ui.field('Number of questions', countIn, null), SS.ui.field('New moves go to', gameSel)),
        countHint, SS.ui.field('Direction', dir),
        el('label.check-row', shuf, el('span', { text: 'Shuffle questions' })),
        el('label.check-row', strict, el('span', { text: 'Strict written grading (only case and spacing are ignored)' })),
        el('p.hint', { text: `Every ${P.progress().need} correct answers unlock ${U.plural(P.progress().grant, 'move')} in your selected game. Wrong answers and flipping flashcards don’t count. You can change this in Settings.` }),
        el('div.row-gap.qz-actions', btn([SS.icon('play', 14), 'Start quiz'], start, 'btn-primary'), btn('Flashcards instead', () => C.study(setSel.value))));
      if (opts.focus !== false) requestAnimationFrame(() => setSel.focus());
    }

    function question(focus) {
      const sess = s.session;
      if (!sess) { setup(); return; }
      if (sess.finished || sess.index >= sess.questions.length) { results(); return; }
      const q = sess.questions[sess.index];
      left.replaceChildren();
      const n = sess.questions.length;
      const right = sess.questions.filter(x => x.ok).length;
      const head = el('div.qz-qhead',
        el('div', el('p.eyebrow', { text: sess.retry ? `Retry · ${sess.setTitle}` : sess.setTitle }), el('h2', { text: `Question ${sess.index + 1} of ${n}` })),
        gateMeter());
      // the bar grows from the previous question's position
      const bar = el('div.progress-bar', { style: { width: `${(Math.max(0, sess.index - 1) / n) * 100}%` } });
      const progress = el('div.progress-track.qz-progress', { role: 'progressbar', aria: { valuemin: 0, valuemax: n, valuenow: sess.index, label: 'Quiz progress' } }, bar);
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${(sess.index / n) * 100}%`; }));
      const score = el('p.qz-score', { text: `${right} correct so far` });
      const card = el('div.qz-question', el('p.qz-kicker', { text: q.mode === 'tf' ? 'Do these match?' : sess.options.direction === 'term' ? 'Recall the term' : 'Recall the definition' }), el('h3.qz-prompt', { text: q.prompt }));
      if (q.mode === 'tf') card.append(el('div.qz-statement', el('span.qz-kicker', { text: sess.options.direction === 'term' ? 'Term shown' : 'Definition shown' }), el('p', { text: q.shown })));
      const answers = el('div.qz-answers', { role: q.mode === 'written' ? null : 'radiogroup', aria: { label: 'Answer choices' } });
      const feedback = el('div.qz-feedback', { attrs: { 'aria-live': 'polite' } });
      const checkBtn = btn('Check answer', check, 'btn-primary');
      const nextBtn = btn(sess.index === n - 1 ? 'See results' : 'Next question', next, 'btn-primary', { hidden: true });
      let input = null; const options = [];
      if (q.mode === 'written') {
        input = el('textarea.input.qz-written', { rows: 3, placeholder: 'Type your answer…', spellcheck: false, autocapitalize: 'off', aria: { label: 'Your answer' } });
        input.value = q.user || '';
        input.addEventListener('input', () => { q.user = input.value; saveSoon(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!q.checked) check(); else next(); } });
        answers.append(input);
      } else {
        const choices = q.mode === 'tf' ? [{ value: true, label: 'True' }, { value: false, label: 'False' }] : q.choices.map(t => ({ value: t, label: t }));
        choices.forEach((c, i) => {
          const b = el('button.qz-option', { type: 'button', role: 'radio', aria: { checked: String(q.user === c.value) }, dataset: { i: String(i) }, on: { click: () => { if (q.checked) return; q.user = c.value; options.forEach(o => o.setAttribute('aria-checked', String(o === b))); replay(b, 'pick'); saveSoon(); feedback.replaceChildren(); } } },
            el('span.qz-key', { text: q.mode === 'tf' ? (c.value ? 'T' : 'F') : String(i + 1), aria: { hidden: 'true' } }), el('span', { text: c.label }));
          options.push(b); answers.append(b);
        });
        answers.addEventListener('keydown', e => {
          const i = options.indexOf(document.activeElement); if (i < 0) return;
          const j = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1 }[e.key];
          if (j != null) { e.preventDefault(); options[(j + options.length) % options.length].focus(); }
        });
      }
      const foot = el('div.qz-qfoot', btn('End quiz', endQuiz, 'btn-ghost btn-sm'), el('span.grow'), checkBtn, nextBtn);
      left.append(head, progress, score, card, answers, feedback, foot,
        el('p.hint.qz-tip', { text: q.mode === 'written' ? 'Enter checks your answer, then Enter again goes on. Shift + Enter adds a line.' : q.mode === 'tf' ? 'Press T or F to choose, then check.' : 'Press 1–4 to choose, then check.' }));
      [...left.children].forEach((child, i) => child.style.setProperty('--i', String(i)));
      replay(left, 'qz-q-enter');
      // quick keys for choices — handled here so they never reach the game panel
      left.onkeydown = e => {
        if (q.checked || q.mode === 'written' || e.ctrlKey || e.metaKey || e.altKey || U.isTyping(e.target)) return;
        const k = e.key.toLowerCase();
        const idx = q.mode === 'tf' ? (k === 't' ? 0 : k === 'f' ? 1 : -1) : /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
        if (idx >= 0 && options[idx]) { e.preventDefault(); options[idx].click(); options[idx].focus(); }
      };
      function render(justChecked = false) {
        if (!q.checked) return;
        if (justChecked) { replay(card, q.ok ? 'qz-right' : 'qz-wrong'); replay(feedback, 'qz-pop'); if (input) replay(input, q.ok ? 'qz-right' : 'qz-wrong'); }
        [input, ...options].filter(Boolean).forEach(x => { x.disabled = true; });
        options.forEach(o => { const v = q.mode === 'tf' ? o.dataset.i === '0' : q.choices[Number(o.dataset.i)]; o.classList.toggle('is-right', q.mode === 'tf' ? v === q.isTrue : v === q.expected); o.classList.toggle('is-wrong', q.user === v && !q.ok); });
        feedback.className = `qz-feedback ${q.ok ? 'qz-correct' : 'qz-incorrect'}`;
        const expect = q.mode === 'tf' ? `${q.isTrue ? 'True' : 'False'} — “${q.prompt}” goes with “${q.expected}”.` : q.expected;
        feedback.replaceChildren(el('span.qz-feedback-icon', { text: q.ok ? '✓' : '✗', aria: { hidden: 'true' } }), el('div', el('strong', { text: q.ok ? (q.close ? 'Correct — close enough (check the spelling)' : 'Correct') : 'Not quite' }), el('p', el('span.hint', { text: q.mode === 'tf' ? 'Answer: ' : 'Expected answer: ' }), el('span', { text: expect }))));
        checkBtn.hidden = true; nextBtn.hidden = false;
        score.textContent = `${sess.questions.filter(x => x.ok).length} correct so far`;
      }
      function check() {
        if (q.checked) return;
        const answered = q.mode === 'written' ? !!String(q.user || '').trim() : q.user !== null;
        if (!answered) { feedback.className = 'qz-feedback'; feedback.textContent = q.mode === 'written' ? 'Type an answer before checking.' : 'Choose an answer before checking.'; (input || options[0])?.focus(); return; }
        if (q.mode === 'tf') q.ok = q.user === q.isTrue;
        else if (q.mode === 'choice') q.ok = q.user === q.expected;
        else { const g = gradeAnswer(q.user, q.expected, sess.options.strict); q.ok = g.ok; q.close = !!g.close; }
        q.checked = true;
        P.submit(`${sess.id}:${q.id}`, q.ok);   // counts once per question; saves the session with it
        render(true);
        nextBtn.focus();
      }
      function next() {
        if (!q.checked) return;
        sess.index++;
        if (sess.index >= sess.questions.length) sess.finished = true;
        P.save();
        question(true);
      }
      render();
      if (focus) requestAnimationFrame(() => { if (q.checked) nextBtn.focus(); else if (input && !U.isCoarse()) input.focus(); else (options.find(o => o.getAttribute('aria-checked') === 'true') || options[0] || card).focus?.(); });
    }
    const saveSoon = U.debounce(() => P.save(), 400);
    async function endQuiz() {
      const sess = s.session; if (!sess) return;
      const answered = sess.questions.filter(q => q.checked).length;
      if (answered < sess.questions.length && !(await SS.ui.confirm({ title: 'End this quiz?', message: `You’ve answered ${answered} of ${sess.questions.length}. Your moves stay saved; unanswered questions are left out of the results.`, ok: 'End quiz', danger: false }))) return;
      sess.questions = sess.questions.filter(q => q.checked);
      sess.finished = true; sess.index = sess.questions.length;
      if (!sess.questions.length) s.session = null;
      P.save();
      question(true);
    }
    function results() {
      const sess = s.session;
      const total = sess.questions.length, right = sess.questions.filter(q => q.ok).length, missed = sess.questions.filter(q => !q.ok);
      const pct = total ? Math.round((right / total) * 100) : 0;
      left.replaceChildren(
        el('div.qz-qhead', el('div', el('p.eyebrow', { text: sess.setTitle }), el('h2', { tabIndex: -1, text: 'Results' })), gateMeter()),
        el('div.qz-result', { class: pct === 100 ? 'perfect' : '' },
          el('div.qz-ring', { style: { '--pct': String(pct) }, aria: { hidden: 'true' } }, el('strong.qz-ring-num', { text: `${pct}%` })),
          el('div.qz-result-copy', el('b', { text: pct === 100 ? 'Perfect score!' : pct >= 80 ? 'Strong work' : pct >= 50 ? 'Getting there' : 'Keep going' }), el('span', { text: `${right} of ${total} correct · ${pct}%` }), el('p.hint', { text: pct === 100 ? 'Every answer right.' : pct >= 80 ? 'Review the few you missed.' : pct >= 50 ? 'Retry the missed ones to lock them in.' : 'Flip through the flashcards, then try again.' }))),
        el('div.row-gap.qz-actions',
          missed.length ? btn(`Retry ${missed.length} missed`, () => { const set = SS.data.get('quizzes', sess.setId) || { id: sess.setId, title: sess.setTitle, cards: sess.questions.map(q => ({ term: q.term, def: q.def })) }; s.session = newSession(set, { ...sess.options, limit: missed.length }, missed.map(q => ({ term: q.term, def: q.def }))); s.session.setTitle = sess.setTitle; P.changed({ type: 'session' }); question(true); }, 'btn-primary') : null,
          btn('New quiz', () => { s.session = null; P.save(); setup({ setId: sess.setId }); }, missed.length ? '' : 'btn-primary'),
          SS.data.get('quizzes', sess.setId) ? btn('Flashcards', () => C.study(sess.setId)) : null),
        el('h3.qz-review-title', { text: 'Answer review' }));
      const review = el('ol.qz-review');
      sess.questions.forEach(q => {
        const userText = q.mode === 'tf' ? (q.user === null ? 'No answer' : q.user ? 'True' : 'False') : (String(q.user || '').trim() || 'No answer');
        const item = el('li.qz-review-item', { class: q.ok ? 'ok' : 'miss' },
          el('p.qz-review-q', el('span.qz-mark', { text: q.ok ? '✓' : '✗', aria: { label: q.ok ? 'Correct' : 'Missed' } }), el('span', { text: q.prompt })),
          q.mode === 'tf' ? el('p', el('span.hint', { text: 'Shown: ' }), el('span', { text: q.shown })) : null,
          el('p', el('span.hint', { text: 'Your answer: ' }), el('span', { text: userText })),
          el('p', el('span.hint', { text: 'Correct answer: ' }), el('span', { text: q.mode === 'tf' ? `${q.isTrue ? 'True' : 'False'} · ${q.expected}` : q.expected })),
          q.override ? el('p.hint', { text: 'You marked this correct — it counts for your score, not for moves.' }) : null,
          !q.ok && q.mode === 'written' && String(q.user || '').trim() ? btn('I was right — count it for my score', () => { q.ok = true; q.override = true; P.save(); results(); }, 'btn-xs') : null);
        review.append(item);
      });
      left.append(review);
      [...left.children].forEach((child, i) => child.style.setProperty('--i', String(Math.min(i, 8))));
      replay(left, 'qz-q-enter');
      countUp(left.querySelector('.qz-ring-num'), pct);
      requestAnimationFrame(() => left.querySelector('h2')?.focus({ preventScroll: true }));
    }

    /* Entry: resume a quiz in progress, show its results, or set up a new one (optionally for a chosen set) */
    function start(opts = {}) {
      const active = s.session && !s.session.finished;
      if (opts.setId && active && s.session.setId !== opts.setId) {
        question(false);
        SS.ui.confirm({ title: 'Start a new quiz?', message: `You’re partway through “${s.session.setTitle}”. Starting a new quiz ends it; moves you’ve earned stay saved.`, ok: 'Start new quiz', cancel: 'Keep going', danger: false }).then(ok => { if (ok) { s.session = null; P.save(); setup(opts); } });
        return;
      }
      if ((opts.setId || opts.setup) && !active) { if (s.session) { s.session = null; P.save(); } setup(opts); return; }
      question(opts.focus !== false);
    }
    offs.push(SS.bus.on('play', e => { if (['answer', 'spend', 'game', 'settings', 'load'].includes(e.type)) paintGateBits(e); if (e.type === 'settings' && left.querySelector('.qz-form-grid') && !s.session) setup({ focus: false }); }));
    offs.push(SS.bus.on('data:quizzes', () => { if (!s.session || s.session.finished) { if (left.querySelector('.qz-form-grid, .empty')) setup({ focus: false }); } }));
    layout();
    start(firstOpts);
    return {
      update: opts => start(opts),
      destroy() { offs.forEach(o => o()); ro.disconnect(); panel.destroy(); saveSoon.flush?.(); }
    };

    /* ---- right side: the docked game ---- */
    function gamePanel() {
      const root = el('section.gp', { aria: { label: 'Game' } });
      const select = SS.ui.select({ label: 'Game', value: P.game(), options: P.GAMES.map(id => ({ value: id, label: `${P.icon(id)} ${P.title(id)}` })), onChange: v => P.setGame(v) });
      select.classList.add('gp-select');
      const moves = el('span.gp-moves', { role: 'status', aria: { live: 'polite' } });
      const gear = el('button.icon-btn.sm', { type: 'button', title: 'Customize this game', aria: { label: 'Customize this game' }, on: { click: () => customizeDialog(P.game()) } }, SS.icon('palette', 16));
      const help = el('button.icon-btn.sm', { type: 'button', title: 'How moves work', aria: { label: 'How moves work in this game' }, on: { click: () => { const g = P.progress(); SS.ui.toast(`${P.games.get(P.game())?.rules || ''} Every ${g.need} correct answers unlock ${U.plural(g.grant, 'move')}.`, { icon: 'info', timeout: 7000 }); } } }, SS.icon('help', 16));
      const hide = el('button.icon-btn.sm', { type: 'button', title: 'Hide the game', aria: { label: 'Hide the game panel' }, on: { click: () => { s.panel.visible = false; P.save(); layout(); left.focus({ preventScroll: true }); } } }, SS.icon('eyeOff', 16));
      // a bigger game in one click (and back to the size it was)
      let restore = 0.46;
      const isBig = () => s.panel.ratio >= 0.62;
      const expand = el('button.icon-btn.sm', { type: 'button', on: { click: () => { if (isBig()) s.panel.ratio = restore < 0.62 ? restore : 0.46; else { restore = s.panel.ratio; s.panel.ratio = 0.68; } P.save(); layout(); } } });
      const bodyEl = el('div.gp-body', { tabIndex: -1 });
      const headEl = el('header.gp-head', select, moves, el('div.gp-tools', help, gear, expand, hide));
      root.append(headEl, bodyEl);
      let mounted = null, mountedId = null;
      function mountGame() {
        const id = P.game();
        if (mountedId === id && mounted) return;
        if (mounted) { try { mounted.destroy(); } catch (err) { console.error(err); } }
        mounted = null; mountedId = id;
        const def = P.games.get(id);
        const host2 = el('div.gp-game.gp-in'); bodyEl.replaceChildren(host2);
        if (!def) { host2.append(SS.ui.empty('alert', 'This game isn’t available', 'Reload the page and try again.')); return; }
        try { mounted = def.mount(host2, { keyTarget: root }); } catch (err) { console.error('[Tester] game failed', err); host2.replaceChildren(SS.ui.empty('alert', `${def.title} hit a problem`, 'Your board is saved. Try another game, then come back.')); }
      }
      function paint() {
        const id = P.game(); select.value = id;
        const n = P.actions(id);
        moves.textContent = n ? `${U.plural(n, 'move')} available` : 'No moves available';
        moves.classList.toggle('has', n > 0);
      }
      const off = SS.bus.on('play', e => {
        if (e.type === 'game') { mountGame(); paint(); } else if (['answer', 'spend', 'settings', 'load'].includes(e.type)) paint();
        if (e.type === 'answer' && e.granted) {
          replay(moves, 'pulse');
          const gain = el('span.gp-gain', { text: `+${e.granted}`, aria: { hidden: 'true' }, style: { left: `${moves.offsetLeft + moves.offsetWidth + 6}px`, top: `${moves.offsetTop + moves.offsetHeight / 2}px` } });
          headEl.append(gain); setTimeout(() => gain.remove(), 1600);
        }
      });
      mountGame(); paint();
      return {
        el: root,
        paintExpand(narrowNow) {
          expand.hidden = narrowNow;
          const big = isBig();
          expand.replaceChildren(SS.icon(big ? 'minimize' : 'maximize', 16));
          expand.title = big ? 'Make the game smaller' : 'Make the game bigger';
          expand.setAttribute('aria-label', expand.title);
          expand.setAttribute('aria-pressed', String(big));
        },
        focusGame: () => requestAnimationFrame(() => mounted?.focus ? mounted.focus() : bodyEl.focus()),
        destroy() { off(); if (mounted) { try { mounted.destroy(); } catch (_) { /* gone */ } } mounted = null; }
      };
    }
  }

  /* Game settings in a dialog, opened from the game panel (the same controls as Games & wins) */
  function customizeDialog(id) {
    const def = P.games.get(id); if (!def) return;
    const d = SS.ui.dialog({ eyebrow: 'Customize', title: `${def.icon} ${def.title}`, subtitle: 'Changes apply right away and are saved.', size: 'md' });
    const grid = el('div.ag-settings-grid');
    const draw = () => grid.replaceChildren(...def.settings(id));
    draw();
    const off = SS.bus.on('play', e => { if (e.type === 'prefs' && e.game === id && (e.key === 'image' || e.key === 'preset')) draw(); });
    const orig = d.close; d.close = r => { off(); orig(r); };
    d.body.append(grid, el('p.hint', { text: def.rules }));
    d.foot.append(btn('All game settings', () => { d.close(); Q.open('games', { game: id }); }, 'mr-auto'), btn('Done', () => d.close(), 'btn-primary'));
  }

  /* ======================= Games & wins ======================= */
  function gamesView(host, opts = {}) {
    const offs = []; const previews = [];
    let open = opts.game || null;
    const wrap = el('section.qz-section');
    host.replaceChildren(wrap);
    function draw() {
      previews.forEach(p => p.destroy()); previews.length = 0; cardIndex = 0;
      const st = P.state;
      const totalWins = P.totalWins();
      const tetris = st.legacy && st.legacy.tetris;
      wrap.replaceChildren(
        el('div.qz-stats',
          stat('Wins', totalWins), stat('Correct answers', st.stats.correct), stat('Questions answered', st.stats.answered), stat('Quizzes started', st.stats.sessions)),
        el('p.hint', { text: `A win counts once, when you finish a game: checkmate the chess bot, complete all four Solitaire foundations, reach the 2048 target tile, or reach the Block Puzzle score target.${tetris && tetris.wins ? ` Your total includes ${U.plural(tetris.wins, 'Tetris win')} from before Block Puzzle replaced Tetris.` : ''}` }),
        el('div.qz-games', P.GAMES.map(id => card(id))));
    }
    const stat = (label, value) => el('div.qz-stat', el('b', { text: Number(value).toLocaleString() }), el('span', { text: label }));
    let cardIndex = 0;
    function card(id) {
      const def = P.games.get(id); const st = P.state;
      const isOpen = open === id;
      const box = el('article.qz-game', { class: isOpen ? 'open' : '', style: { '--i': String(cardIndex++) } },
        el('div.qz-game-head',
          el('span.qz-game-icon', { text: def.icon, aria: { hidden: 'true' } }),
          el('div.qz-game-copy', el('h3', { text: def.title }), el('p.hint', { text: def.description }), el('p.qz-game-sum', { text: def.summary ? def.summary(P.data(id)) : '' })),
          el('div.qz-game-wins', el('b', { text: String(st.wins[id]) }), el('span', { text: st.wins[id] === 1 ? 'win' : 'wins' }))),
        el('p.hint.qz-game-moves', { text: `${P.actions(id) ? U.plural(P.actions(id), 'move') : 'No moves'} available · ${U.plural(st.stats.moves[id] || 0, 'move')} played${P.game() === id ? ' · new moves go here' : ''}` }),
        el('div.row-gap',
          btn('Play', () => { P.setGame(id); Q.open('practice'); }, 'btn-sm btn-primary'),
          btn(isOpen ? 'Close customization' : 'Customize', () => { open = isOpen ? null : id; draw(); }, 'btn-sm', { aria: { expanded: String(isOpen) } })));
      if (isOpen) {
        const pv = el('div.qz-preview-box', { aria: { label: `${def.title} preview` } });
        const grid = el('div.ag-settings-grid');
        grid.replaceChildren(...def.settings(id));
        box.append(el('div.qz-custom', el('div.qz-custom-form', grid, el('p.hint', { text: def.rules })), el('div.qz-custom-preview', el('p.qz-kicker', { text: 'Live preview' }), pv)));
        try { previews.push(def.mount(pv, { preview: true })); } catch (err) { console.error(err); }
      }
      return box;
    }
    draw();
    if (open) requestAnimationFrame(() => wrap.querySelector('.qz-game.open')?.scrollIntoView({ block: 'nearest' }));
    offs.push(SS.bus.on('play', e => { if (['win', 'board', 'load'].includes(e.type) || (e.type === 'prefs' && (e.key === 'image' || e.key === 'preset'))) draw(); }));
    return { update: o => { if (o.game) { open = o.game; draw(); } }, destroy() { offs.forEach(o => o()); previews.forEach(p => p.destroy()); } };
  }

  /* ======================= Settings ======================= */
  function settingsView(host) {
    const s = P.state;
    const need = el('input.input', { type: 'number', min: 1, max: 100, step: 1, value: s.settings.need, inputMode: 'numeric', aria: { label: 'Correct answers needed' } });
    const grant = el('input.input', { type: 'number', min: 1, max: 100, step: 1, value: s.settings.grant, inputMode: 'numeric', aria: { label: 'Moves unlocked' } });
    const applyRhythm = () => { const n = Math.floor(Number(need.value)), g = Math.floor(Number(grant.value)); if (!(n >= 1 && n <= 100 && g >= 1 && g <= 100)) { SS.ui.toast('Use whole numbers from 1 to 100.', { kind: 'error' }); need.value = s.settings.need; grant.value = s.settings.grant; return; } P.setRhythm({ need: n, grant: g }); SS.ui.toast(`Every ${n} correct ${n === 1 ? 'answer unlocks' : 'answers unlock'} ${U.plural(g, 'move')}.`, { kind: 'success', timeout: 2400 }); };
    need.addEventListener('change', applyRhythm); grant.addEventListener('change', applyRhythm);
    const o = s.quiz;
    const setOpt = patch => { s.quiz = P.quizOptions({ ...s.quiz, ...patch }); P.changed({ type: 'settings' }); };
    host.replaceChildren(el('section.qz-section.qz-settings',
      el('h2.panel-h', { text: 'Study & play rhythm' }),
      el('p.hint', { text: 'Only answers you check and get right count. Wrong answers, flipping flashcards and marking your own answers don’t unlock moves, and each question counts once.' }),
      el('div.qz-form-grid', SS.ui.field('Correct answers needed', need, 'Default: 3'), SS.ui.field('Moves unlocked each time', grant, 'Default: 3')),
      SS.ui.field('New moves go to', SS.ui.select({ label: 'Game for new moves', value: P.game(), options: P.GAMES.map(id => ({ value: id, label: `${P.icon(id)} ${P.title(id)}` })), onChange: v => P.setGame(v) })),
      SS.ui.toggle({ label: 'Show the game beside questions', hint: 'You can also hide or show it from the game panel at any time.', value: s.panel.visible, onChange: v => { s.panel.visible = v; P.save(); } }),
      el('h2.panel-h', { text: 'Quiz defaults' }),
      el('div.qz-form-grid',
        SS.ui.field('Question style', SS.ui.select({ label: 'Default question style', value: o.mode, options: MODES, onChange: v => setOpt({ mode: v }) })),
        SS.ui.field('Number of questions', (() => { const i = el('input.input', { type: 'number', min: 1, max: MAX_QUESTIONS, value: o.limit, aria: { label: 'Default number of questions' } }); i.addEventListener('change', () => setOpt({ limit: U.clampNum(Math.floor(i.value), 1, MAX_QUESTIONS, 10) })); return i; })())),
      SS.ui.field('Direction', SS.ui.select({ label: 'Default direction', value: o.direction, options: DIRECTIONS, onChange: v => setOpt({ direction: v }) })),
      SS.ui.toggle({ label: 'Shuffle questions', value: o.shuffle, onChange: v => setOpt({ shuffle: v }) }),
      SS.ui.toggle({ label: 'Strict written grading', hint: 'Off: small typos and close wording can count. Numbers, signs and “not” must always match.', value: o.strict, onChange: v => setOpt({ strict: v }) }),
      el('h2.panel-h', { text: 'Games' }),
      el('p.hint', { text: 'Board colours, pieces, cards, tiles and difficulty are in Games & wins, or from the palette button on the game panel.' }),
      btn('Open Games & wins', () => Q.open('games'), 'btn-sm')));
    return { destroy() {} };
  }

  /* ---------------- Dashboard widget: study sets with shortcuts into the Quiz tab ---------------- */
  // (the Flashcards widget in index.html calls SS.quiz.practice / SS.quiz.open)
})(window.SS);
