/* Tester quiz maker: local Quizlet imports, configurable recall, and earned arcade turns. */
(function (SS) {
  'use strict';
  const { el } = SS.util;
  const A = SS.arcade;
  const C = SS.cards;
  const shuffle = items => { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  const norm = value => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const valid = cards => (cards || []).map(c => ({ term: String(c?.term || '').trim(), def: String(c?.def || '').trim() })).filter(c => c.term && c.def);
  const gameOptions = [{ value: 'chess', label: '♟ Chess' }, { value: 'solitaire', label: '♠ Solitaire' }, { value: '2048', label: '▦ 2048' }, { value: 'tetris', label: '▤ Tetris' }, { value: 'none', label: 'No game rewards' }];
  const typeOptions = [{ value: 'mixed', label: 'Mixed test' }, { value: 'choice', label: 'Multiple choice' }, { value: 'written', label: 'Written answer' }, { value: 'tf', label: 'True / false' }];
  const defaults = { rewardGame: 'chess', limit: 10, mode: 'mixed', direction: 'def', shuffle: true, strict: false };
  const button = (text, fn, primary = false) => el('button.btn', { type: 'button', class: primary ? 'btn-primary' : '', text, on: { click: fn } });
  const number = (label, value, min, max) => el('input.input', { type: 'number', min, max, step: 1, value, aria: { label } });
  const clamp = (value, lo, hi, fallback) => Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Math.floor(Number(value)))) : fallback;

  function safeOptions(raw = {}) {
    return {
      mode: typeOptions.some(o => o.value === raw.mode) ? raw.mode : defaults.mode,
      direction: raw.direction === 'term' ? 'term' : 'def',
      rewardGame: gameOptions.some(o => o.value === raw.rewardGame) ? raw.rewardGame : defaults.rewardGame,
      limit: clamp(raw.limit, 1, 5000, defaults.limit), shuffle: raw.shuffle !== false, strict: raw.strict === true
    };
  }
  function gradeAnswer(user, expected, strict = false) {
    const actual = norm(user), wanted = norm(expected);
    if (!actual) return false;
    if (actual === wanted) return true;
    if (strict) return false;
    // Fuzzy spelling must never turn a changed quantity, mathematical sign or negation into a correct answer.
    const quantities = text => JSON.stringify(text.replace(/(?<=\d),(?=\d{3}\b)/g, '').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) || []);
    if (quantities(actual) !== quantities(wanted)) return false;
    const negated = text => /\b(?:no|not|never|without|cannot)\b|n['’]t\b/.test(text);
    if (negated(actual) !== negated(wanted)) return false;
    const symbols = text => (text.match(/[=+<>×÷^%−]|(?<=[a-z0-9])-(?=$|\s|[0-9])/g) || []).join('');
    if (symbols(actual) !== symbols(wanted)) return false;
    return C.grade(actual, wanted).ok;
  }

  function detect(text) {
    // Ignore delimiters inside quoted CSV fields; prefer the earliest consistent separator in each record.
    const visible = String(text).replace(/"(?:[^"]|"")*"/g, token => ' '.repeat(token.length));
    const lines = visible.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim()).slice(0, 100);
    return ['\t', ',', ';', ' - ', ' – ', ' — ', ': '].map(sep => {
      const hits = lines.filter(line => line.includes(sep));
      return { sep, count: hits.length, first: hits.reduce((sum, line) => sum + line.indexOf(sep) / Math.max(1, line.length), 0) / Math.max(1, hits.length) };
    }).sort((a, b) => b.count - a.count || a.first - b.first)[0]?.sep || '\t';
  }
  function parseImport(text, separator = 'auto', cardSeparator = '\n', skipHeader = false) {
    const source = String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    if (source.length > 4 * 1024 * 1024) return { cards: [], errors: ['Import text must be smaller than 4 million characters.'], separator: '' };
    const sep = separator === 'auto' ? detect(source) : separator.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    const rowSep = String(cardSeparator || '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (!sep || !rowSep || sep === rowSep) return { cards: [], errors: ['Term and card separators must be different and nonempty.'], separator: sep };
    const rows = []; let cells = [], cell = '', quoted = false, closedQuote = false, malformedQuote = false, index = 0;
    for (let i = 0; i < source.length;) {
      const ch = source[i];
      if (ch === '"' && (quoted || !cell.trim())) {
        if (quoted && source[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (quoted) { quoted = false; closedQuote = true; } else { quoted = true; closedQuote = false; } i++; continue;
      }
      if (!quoted && source.startsWith(rowSep, i)) { cells.push(cell); rows.push(cells); if (rows.length > 10000) return { cards: [], errors: ['Import up to 5,000 cards and 10,000 total rows at a time.'], separator: sep }; cells = []; cell = ''; closedQuote = false; i += rowSep.length; continue; }
      if (!quoted && source.startsWith(sep, i)) { cells.push(cell); cell = ''; closedQuote = false; i += sep.length; continue; }
      if (closedQuote && !/\s/.test(ch)) malformedQuote = true;
      cell += ch; i++;
    }
    cells.push(cell); rows.push(cells);
    const errors = [], cards = [];
    if (quoted) errors.push('A quoted field is missing its closing quote.');
    if (malformedQuote) errors.push('Text after a closing quote must begin in the next separated field.');
    for (const row of rows) {
      index++;
      if (row.every(v => !v.trim())) continue;
      if (skipHeader && !cards.length && /^(term|question|front)$/i.test(row[0].trim()) && /^(definition|answer|back)$/i.test((row[1] || '').trim())) continue;
      const term = row[0]?.trim() || '', def = row.slice(1).join(sep).trim();
      if (row.length < 2 || !term || !def) { errors.push(`Row ${index}: add both a term and definition separated by ${sep === '\t' ? 'a Tab' : '“' + sep + '”'}.`); continue; }
      if (term.length > 4000 || def.length > 4000) { errors.push(`Row ${index}: each side must be at most 4,000 characters.`); continue; }
      if (cards.length >= 5000) { errors.push('Import up to 5,000 cards at a time.'); break; }
      cards.push({ term, def });
    }
    return { cards, errors, separator: sep };
  }
  SS.quizPlus = { parseImport, norm, shuffle, gradeAnswer, safeOptions };

  C.edit = (quizId, opts = {}) => {
    const quiz = quizId ? SS.data.get('quizzes', quizId) : null;
    const dlg = SS.ui.dialog({ eyebrow: 'Quiz & flashcard maker', title: quiz ? 'Edit ' + quiz.title : 'Create a study set', size: 'lg', class: 'qp-editor' });
    const title = SS.ui.input({ value: quiz?.title || opts.title || '', label: 'Study set title', placeholder: 'e.g. Biology · Chapter 3', maxLength: 200 });
    let subjectId = quiz?.subjectId || opts.subjectId || '';
    const subject = SS.ui.subjectSelect(subjectId, value => { subjectId = value; });
    let mode = opts.importText || opts.mode === 'import' ? 'import' : 'manual';
    const rows = el('div.qp-card-rows');
    const addRow = (term = '', def = '') => {
      const front = el('textarea.input', { rows: 2, maxLength: 4000, placeholder: 'Term / question', aria: { label: 'Term or question' } }); front.value = term;
      const back = el('textarea.input', { rows: 2, maxLength: 4000, placeholder: 'Definition / answer', aria: { label: 'Definition or answer' } }); back.value = def;
      const row = el('div.qp-card-row', el('span.qp-card-num'), front, back, SS.ui.iconBtn('trash', 'Remove this card', () => { row.remove(); renumber(); }));
      rows.append(row); renumber(); return row;
    };
    const renumber = () => [...rows.children].forEach((row, i) => { row.querySelector('.qp-card-num').textContent = i + 1; });
    (quiz?.cards || [{ term: '', def: '' }, { term: '', def: '' }, { term: '', def: '' }]).forEach(card => addRow(card.term, card.def));
    const manual = el('section.qp-manual', el('p.hint', { text: 'Every card needs a question and an answer. These become flashcards and test questions.' }), rows, button('+ Add card', () => addRow().querySelector('textarea').focus()));
    const area = el('textarea.input.qp-import-area', { rows: 9, spellcheck: false, placeholder: 'Paste Quizlet export here (term → Tab → definition, one card per line).\n\nCell\tBasic unit of life\nMitochondria\tProduces cellular energy', aria: { label: 'Quizlet export text' } }); area.value = opts.importText || '';
    const custom = SS.ui.input({ value: ' | ', label: 'Custom term separator', maxLength: 16 });
    const rowCustom = SS.ui.input({ value: '\\n', label: 'Card separator', maxLength: 16 });
    const separator = SS.ui.select({ label: 'Term and definition separator', value: 'auto', options: [{ value: 'auto', label: 'Detect automatically' }, { value: '\t', label: 'Tab · Quizlet default' }, { value: ',', label: 'Comma · CSV' }, { value: ';', label: 'Semicolon' }, { value: ' - ', label: 'Spaced dash' }, { value: 'custom', label: 'Custom separator' }] });
    const customField = SS.ui.field('Custom term separator', custom); customField.hidden = true;
    const preview = el('div.qp-import-preview', { attrs: { 'aria-live': 'polite' } });
    const header = el('input', { type: 'checkbox', checked: true, aria: { label: 'Skip a Term / Definition header row' } });
    const file = el('input', { type: 'file', accept: '.txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv', aria: { label: 'Import a text, CSV, or TSV file' } });
    let parsed = { cards: [], errors: [] };
    function refreshPreview() {
      customField.hidden = separator.value !== 'custom';
      parsed = parseImport(area.value, separator.value === 'custom' ? custom.value : separator.value, rowCustom.value, header.checked);
      preview.replaceChildren();
      if (!area.value.trim()) { preview.append(el('p.hint', { text: 'In Quizlet, choose Export, copy your terms and definitions, then paste them here. This imports exported text; Quizlet links are not imported.' })); return; }
      preview.append(el('strong', { text: `${parsed.cards.length} valid cards · ${parsed.errors.length} issues` }), el('p.hint', { text: `Term separator: ${parsed.separator === '\t' ? 'Tab' : '“' + parsed.separator + '”'}` }));
      if (parsed.errors.length) preview.append(el('div.qp-import-errors', { role: 'alert' }, parsed.errors.slice(0, 6).map(message => el('p', { text: message })), parsed.errors.length > 6 ? el('p', { text: `And ${parsed.errors.length - 6} more…` }) : null));
      if (parsed.cards.length) {
        const table = el('table.qp-preview-table', el('thead', el('tr', el('th', { text: 'Term / question' }), el('th', { text: 'Definition / answer' }))));
        table.append(el('tbody', parsed.cards.slice(0, 8).map(card => el('tr', el('td', { text: card.term }), el('td', { text: card.def }))))); preview.append(table);
        if (parsed.cards.length > 8) preview.append(el('p.hint', { text: `Previewing 8 of ${parsed.cards.length} cards.` }));
      }
    }
    let previewTimer;
    area.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 160); });
    [separator, custom, rowCustom, header].forEach(input => input.addEventListener('input', refreshPreview));
    file.addEventListener('change', async () => { const selected = file.files[0]; if (!selected) return; if (selected.size > 4 * 1024 * 1024) return SS.ui.toast('Choose a text file smaller than 4 MB.', { kind: 'error' }); try { area.value = await selected.text(); refreshPreview(); } catch (_) { SS.ui.toast('That file could not be read.', { kind: 'error' }); } });
    const importBox = el('section.qp-import', el('p.hint', { text: 'Quizlet export uses a Tab between terms and definitions, and a new line between cards. Quoted CSV fields are supported.' }), area, el('div.qp-form-grid', SS.ui.field('Between term and definition', separator), SS.ui.field('Between cards (\\n = new line)', rowCustom), customField), el('label.check-row', header, el('span', { text: 'Skip a Term / Definition header row' })), SS.ui.field('Or choose a file', file), preview, button('Preview & edit imported cards', () => {
      refreshPreview(); if (parsed.errors.length || !parsed.cards.length) return SS.ui.toast('Fix the import issues before continuing.', { kind: 'error' });
      rows.replaceChildren(); parsed.cards.forEach(card => addRow(card.term, card.def)); setMode('manual');
    }));
    function setMode(value) { mode = value; manual.hidden = mode !== 'manual'; importBox.hidden = mode !== 'import'; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode))); if (mode === 'import') refreshPreview(); }
    const tabs = el('div.w-tabs.qp-editor-tabs', { role: 'tablist', aria: { label: 'Create cards' } });
    [['manual', 'Write & edit cards'], ['import', 'Import Quizlet / text']].forEach(([value, label]) => tabs.append(el('button.w-tab', { type: 'button', role: 'tab', dataset: { mode: value }, text: label, on: { click: () => setMode(value) } })));
    dlg.body.append(el('div.qp-form-grid', SS.ui.field('Study set title', title), SS.ui.field('Subject', subject)), tabs, manual, importBox); setMode(mode);
    const save = () => {
      let cards = [];
      if (mode === 'import') { refreshPreview(); if (parsed.errors.length) return SS.ui.toast('Fix the import issues before saving. Nothing was imported.', { kind: 'error' }); cards = parsed.cards; }
      else {
        let bad = false;
        [...rows.children].forEach(row => { const fields = row.querySelectorAll('textarea'); const term = fields[0].value.trim(), def = fields[1].value.trim(); if (!term && !def) return; if (!term || !def) { bad = true; row.classList.add('qp-invalid'); } else { row.classList.remove('qp-invalid'); cards.push({ term, def }); } });
        if (bad) return SS.ui.toast('Complete both sides of every highlighted card.', { kind: 'error' });
      }
      if (!title.value.trim()) { title.focus(); return SS.ui.toast('Give your study set a title.', { kind: 'error' }); }
      if (!cards.length) return SS.ui.toast('Add at least one complete card.', { kind: 'error' });
      if (cards.length > 5000) return SS.ui.toast('Use up to 5,000 cards in one study set.', { kind: 'error' });
      if (quiz) SS.data.update('quizzes', quiz.id, { title: title.value.trim(), cards, subjectId });
      else { const created = SS.data.add('quizzes', { title: title.value.trim(), cards, subjectId }); SS.prefs.patch('ui', { quizId: created.id }); }
      dlg.close(); SS.ui.toast(`Study set saved · ${cards.length} cards`, { kind: 'success' });
    };
    dlg.foot.append(button('Cancel', () => dlg.close()), button(quiz ? 'Save changes' : 'Create study set', save, true));
  };

  C.test = (quizId, pool, overrides = {}) => {
    const quiz = SS.data.get('quizzes', quizId), all = valid(quiz?.cards);
    if (!all.length) return SS.ui.toast('Add at least one complete question and answer first.');
    const dlg = SS.ui.dialog({ eyebrow: 'Recall, then recharge', title: quiz.title, size: 'lg', class: 'qp-test' });
    let options = safeOptions({ ...defaults, ...(A.state.quizOptions || {}), ...overrides }), questions = [], index = 0, rewardTurns = 0;
    function setup() {
      dlg.body.replaceChildren(); dlg.foot.replaceChildren();
      const mode = SS.ui.select({ label: 'Test style', value: options.mode, options: typeOptions });
      const direction = SS.ui.select({ label: 'Question direction', value: options.direction, options: [{ value: 'def', label: 'Show term → recall definition' }, { value: 'term', label: 'Show definition → recall term' }] });
      const count = number('Number of questions', Math.min(options.limit, all.length), 1, all.length);
      const game = SS.ui.select({ label: 'Reward game', value: options.rewardGame, options: gameOptions });
      const threshold = number('Correct answers per reward', clamp(A.state.settings.threshold, 1, 100, 3), 1, 100), turns = number('Turns per reward', clamp(A.state.settings.turns, 1, 100, 3), 1, 100);
      const strict = el('input', { type: 'checkbox', checked: options.strict }), random = el('input', { type: 'checkbox', checked: options.shuffle });
      dlg.body.append(el('div.qp-test-intro', el('div.qp-kicker', { text: 'YOUR STUDY SESSION' }), el('p', { text: `${all.length} cards ready. Choose how you want to practice and which game to earn turns in.` })), el('div.qp-form-grid', SS.ui.field('Test style', mode), SS.ui.field('Number of questions', count, `Up to ${all.length}. Each card appears once per test.`), SS.ui.field('Question direction', direction), SS.ui.field('Reward game', game), SS.ui.field('Correct answers per reward', threshold), SS.ui.field('Turns per reward', turns)), el('label.check-row', random, el('span', { text: 'Shuffle questions' })), el('label.check-row', strict, el('span', { text: 'Strict written grading (ignore case and extra spaces only)' })), el('p.hint', { text: 'With strict grading off, small typos and close wording may count. You always see the expected answer. Game turns require a checked correct answer; flipping a flashcard does not award turns. Reward progress carries between tests for each game.' }));
      dlg.foot.append(button('Cancel', () => dlg.close()), button('Start test', () => {
        options = safeOptions({ mode: mode.value, direction: direction.value, limit: clamp(count.value, 1, all.length, 10), rewardGame: game.value, strict: strict.checked, shuffle: random.checked });
        A.state.quizOptions = options; A.state.settings.threshold = clamp(threshold.value, 1, 100, 3); A.state.settings.turns = clamp(turns.value, 1, 100, 3); if (A.state.progress) for (const gameId of ['chess', 'solitaire', '2048', 'tetris']) A.state.progress[gameId] = Math.max(0, Number(A.state.progress[gameId]) || 0) % A.state.settings.threshold; A.save(); start(pool || all);
      }, true));
    }
    function start(cards) {
      const chosen = options.shuffle ? shuffle(valid(cards)) : valid(cards);
      questions = chosen.slice(0, Math.min(options.limit, chosen.length)).map((card, i) => {
        let mode = options.mode === 'mixed' ? ['choice', 'written', 'tf'][i % 3] : options.mode;
        const prompt = options.direction === 'term' ? card.def : card.term, expected = options.direction === 'term' ? card.term : card.def;
        const distractors = shuffle([...new Set(all.map(c => options.direction === 'term' ? c.term : c.def))].filter(text => norm(text) !== norm(expected)));
        if (mode === 'choice' && !distractors.length) mode = 'written';
        const isTrue = !distractors.length || Math.random() < .5;
        return { card, prompt, expected, mode, choices: shuffle([expected, ...distractors.slice(0, 3)]), shown: isTrue ? expected : distractors[0], isTrue, checked: false, user: '', ok: false };
      });
      index = 0; rewardTurns = 0; drawQuestion();
    }
    function drawQuestion() {
      const q = questions[index]; if (!q) return results();
      dlg.body.replaceChildren(); dlg.foot.replaceChildren();
      const meta = el('div.qp-session-meta', el('span', { text: `Question ${index + 1} / ${questions.length}` }), el('span', { text: `${questions.filter(item => item.ok).length} correct · ${rewardTurns} turns earned` }));
      const progress = el('div.progress-track', el('div.progress-bar', { style: { width: `${index / questions.length * 100}%` } }));
      const card = el('div.qp-question', el('p.qp-kicker', { text: q.mode === 'tf' ? 'DO THESE MATCH?' : options.direction === 'term' ? 'RECALL THE TERM' : 'RECALL THE DEFINITION' }), el('h3.qp-prompt', { text: q.prompt }));
      const answerArea = el('div.qp-answer-area'), feedback = el('div.qp-feedback', { attrs: { 'aria-live': 'polite' } });
      let rewardCaption;
      const rewardText = () => `Earn ${A.state.settings.turns} ${gameOptions.find(g => g.value === options.rewardGame)?.label || ''} turns for every ${A.state.settings.threshold} correct answers · ${A.state.progress?.[options.rewardGame] || 0} / ${A.state.settings.threshold} toward the next reward · ${A.state.credits[options.rewardGame] || 0} turns banked.`;
      const submit = button('Check answer', check, true); let input;
      if (q.mode === 'written') {
        input = el('textarea.input.qp-answer', { rows: 3, placeholder: 'Type your answer…', spellcheck: false, aria: { label: 'Your answer' } });
        input.addEventListener('input', () => { q.user = input.value; }); input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } }); answerArea.append(input);
      } else {
        const choices = q.mode === 'tf' ? [{ value: true, label: 'True' }, { value: false, label: 'False' }] : q.choices.map(text => ({ value: text, label: text }));
        if (q.mode === 'tf') card.append(el('div.qp-statement', { text: q.shown }));
        choices.forEach(choice => { const b = el('button.qp-option', { type: 'button', text: choice.label, aria: { pressed: 'false' }, on: { click: () => { if (q.checked) return; q.user = choice.value; q.hasAnswer = true; answerArea.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === b))); } } }); answerArea.append(b); });
      }
      function check() {
        if (q.checked) return;
        if ((q.mode === 'written' && !String(q.user).trim()) || (q.mode !== 'written' && !q.hasAnswer)) { feedback.textContent = 'Choose or type an answer before checking.'; return; }
        q.checked = true;
        q.ok = q.mode === 'tf' ? q.user === q.isTrue : q.mode === 'choice' ? q.user === q.expected : gradeAnswer(q.user, q.expected, options.strict);
        if (input) input.disabled = true; answerArea.querySelectorAll('button').forEach(item => { item.disabled = true; }); submit.disabled = true;
        feedback.classList.toggle('qp-correct', q.ok); feedback.classList.toggle('qp-incorrect', !q.ok);
        feedback.replaceChildren(el('strong', { text: q.ok ? '✓ Correct' : 'Keep this one in your review pile' }), el('p', { text: q.mode === 'tf' ? `Correct answer: ${q.isTrue ? 'True' : 'False'}. ${q.expected}` : `Expected answer: ${q.expected}` }));
        dlg.foot.replaceChildren(button(index === questions.length - 1 ? 'See results' : 'Next question →', () => { index++; drawQuestion(); }, true));
        if (q.ok) {
          const result = A.correct(options.rewardGame); if (result?.earned) rewardTurns += A.state.settings.turns;
        }
        if (rewardCaption) rewardCaption.textContent = rewardText();
        meta.lastElementChild.textContent = `${questions.filter(item => item.ok).length} correct · ${rewardTurns} turns earned`;
      }
      card.append(answerArea); dlg.body.append(meta, progress, card, feedback);
      if (options.rewardGame !== 'none') { rewardCaption = el('p.hint.qp-reward-caption', { text: rewardText(), attrs: { 'aria-live': 'polite' } }); dlg.body.append(rewardCaption); }
      dlg.foot.append(submit);
      if (input && !SS.util.isCoarse()) requestAnimationFrame(() => input.focus());
    }
    function results() {
      const right = questions.filter(q => q.ok).length, missed = questions.filter(q => !q.ok);
      dlg.body.replaceChildren(); dlg.foot.replaceChildren();
      dlg.body.append(el('div.qp-results-score', el('strong', { text: Math.round(right / questions.length * 100) + '%' }), el('span', { text: `${right} of ${questions.length} correct · ${rewardTurns} game turns earned` })), el('h3', { text: 'Answer review' }));
      const review = el('div.qp-review');
      questions.forEach((q, i) => review.append(el('details.qp-review-item', { open: !q.ok }, el('summary', { text: `${q.ok ? '✓' : '○'} ${i + 1}. ${q.prompt}` }), el('p', el('b', { text: 'Your answer: ' }), el('span', { text: q.mode === 'tf' ? (q.user ? 'True' : 'False') + ` (shown: ${q.shown})` : q.user })), el('p', el('b', { text: 'Expected: ' }), el('span', { text: q.mode === 'tf' ? `${q.isTrue ? 'True' : 'False'} · ${q.expected}` : q.expected })))));
      dlg.body.append(review);
      if (missed.length) dlg.foot.append(button(`Retry ${missed.length} missed`, () => start(missed.map(q => q.card)), true));
      dlg.foot.append(button('New test', setup), button('Flashcards', () => { dlg.close(); C.study(quizId); }));
      if (options.rewardGame !== 'none' && A.state.credits[options.rewardGame] > 0) dlg.foot.append(button('Use earned turns', () => A.openGame(options.rewardGame)));
    }
    setup();
  };

  SS.registry.define({
    type: 'quiz-plus', name: 'Quiz & game lab', category: 'study', icon: 'cards', keepsContent: true,
    description: 'Import Quizlet text, make flashcards and tests, and earn turns in your favorite games.', keywords: 'quizlet flashcard test quiz rewards chess solitaire 2048 tetris',
    sizes: { s: [4, 4], m: [6, 5], l: [8, 6], xl: [12, 6] }, size: 'm', min: [3, 3], defaults: () => ({ ...defaults }), data: ['data:quizzes', 'arcade'],
    mount(ctx) {
      const update = () => ctx.render(() => {
        ctx.setActions([SS.ui.iconBtn('plus', 'Create a study set', () => C.edit(), 'sm'), SS.ui.iconBtn('sliders', 'Quiz settings', ctx.openSettings, 'sm')]);
        const sets = SS.data.all('quizzes');
        const box = el('div.qp-widget', el('div.qp-widget-intro', el('span.qp-widget-symbol', { text: '✦' }), el('div', el('p.qp-kicker', { text: 'LEARN · PLAY · REPEAT' }), el('h3', { text: 'A little recall. A little reward.' }), el('p.hint', { text: `Every ${A.state.settings.threshold} correct answers earns ${A.state.settings.turns} game turns.` }))));
        box.append(el('div.row-gap.qp-widget-create', button('＋ Create cards', () => C.edit()), button('Import Quizlet', () => C.edit(null, { mode: 'import' }), true)));
        if (!sets.length) box.append(el('p.hint', { text: 'Add your first set by typing cards or pasting a Quizlet export.' }));
        else {
          const list = el('div.qp-set-list');
          sets.forEach(set => list.append(el('div.qp-set', el('div.qp-set-copy', el('b', { text: set.title }), el('span.hint', { text: `${set.cards.length} cards` })), button('Cards', () => C.study(set.id)), button('Test →', () => C.test(set.id, null, ctx.config), true), SS.ui.iconBtn('edit', 'Edit ' + set.title, () => C.edit(set.id), 'sm')))); box.append(list);
        }
        return box;
      }); update(); return { update };
    },
    settings: () => [
      { type: 'select', key: 'mode', label: 'Default test style', options: typeOptions },
      { type: 'select', key: 'direction', label: 'Question direction', options: [{ value: 'def', label: 'Term → definition' }, { value: 'term', label: 'Definition → term' }] },
      { type: 'select', key: 'rewardGame', label: 'Default reward game', options: gameOptions },
      { type: 'slider', key: 'limit', label: 'Default question count', min: 1, max: 100, step: 1 },
      { type: 'toggle', key: 'shuffle', label: 'Shuffle questions' }, { type: 'toggle', key: 'strict', label: 'Strict written answers' },
      { type: 'note', text: 'Colors, backgrounds, fonts, borders, spacing and size are in this widget’s Appearance controls. Reward frequency and turn amounts can be changed before every test.' },
      { type: 'action', label: 'Import Quizlet export text', icon: 'copy', run: () => C.edit(null, { mode: 'import' }) }
    ],
    preview: () => el('div.pv-decks', el('i', { text: 'Learn' }), el('i', { text: 'Quiz' }), el('i', { text: 'Play' }))
  });
})(window.SS);
