/* Tester — the planner layer: the Today home and its widgets (Today header, Due work, Week strip,
   Next class), class pages (header, notes & sets), Style presets with live mini previews, example
   content that is tracked and removable in one step, the first-run welcome and a few helpers that let
   other views (the Study tab's focus timer) borrow a widget. Everything here builds on SS.registry,
   SS.ws pages/templates and the shared content in SS.data. */
(function (SS) {
  'use strict';
  const U = SS.util;
  const { el } = U;
  const K = SS.kit;
  const R = SS.registry;
  const D = SS.data;
  const PL = SS.planner = {};

  const today = () => U.todayISO();
  const subj = id => D.subject(id);
  const subjColor = (id, fb) => D.subjectColor(id, fb || 'var(--w-faint)');
  const minutesOf = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
  const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const initial = name => (String(name || '?').trim()[0] || '?').toUpperCase();
  const isEmoji = s => /\p{Extended_Pictographic}/u.test(String(s || ''));
  /* A web address someone pasted: no spaces, and a real-looking host (has a dot) or localhost */
  U.webURL = raw => {
    const v = String(raw || '').trim(); if (!v || /\s/.test(v)) return null;
    const url = U.safeURL(v); if (!url) return null;
    if (url.startsWith('mailto:')) return url;
    try { const h = new URL(url).hostname; return /\.[a-z0-9-]{2,}$/i.test(h) || h === 'localhost' ? url : null; } catch (_) { return null; }
  };

  /* ================================================================
     Example content ("Try with examples") — tracked by id in prefs.demo
     ================================================================ */
  const KIND_COLL = { assignment: 'assignments', event: 'events', exam: 'events', reminder: 'reminders', todo: 'todos' };
  let demoSets = null;
  const demoReg = () => SS.prefs.get('demo') || null;
  const rebuildDemo = () => { const r = demoReg(); demoSets = r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, new Set(v)])) : {}; };
  SS.bus.on('prefs', ({ key }) => { if (key === 'demo' || key === 'all') rebuildDemo(); });

  const DEMO = SS.demo = {
    reg: demoReg,
    is(coll, id) { if (!demoSets) rebuildDemo(); return !!(demoSets[coll] && demoSets[coll].has(id)); },
    isItem: it => !!it && !!KIND_COLL[it.kind] && DEMO.is(KIND_COLL[it.kind], it.id),
    count() { const r = demoReg(); if (!r) return 0; return Object.entries(r).reduce((n, [coll, ids]) => n + (coll === 'pages' ? ids.filter(id => SS.ws.page(id)).length : D.COLLECTIONS.includes(coll) ? ids.filter(id => D.has(coll, id)).length : 0), 0); },
    active: () => DEMO.count() > 0,

    /* Adds the examples next to whatever the student already has; returns the registry */
    seed() {
      const t = today(); const d = n => U.addDays(t, n);
      const reg = {};
      const add = (coll, raw) => { const item = D.add(coll, { ...raw, sample: true }); if (item) (reg[coll] = reg[coll] || []).push(item.id); return item; };
      const subjects = {};
      [['bio', 'Biology', '#21a67a', '🧬'], ['math', 'Math', '#5b7cfa', '📐'], ['eng', 'English', '#e0607e', '📖'], ['hist', 'History', '#f08c2e', '🏛️']].forEach(([k, name, color, icon]) => {
        const existing = D.all('subjects').find(s => s.name.toLowerCase() === name.toLowerCase());
        subjects[k] = existing ? existing.id : add('subjects', { name, color, icon, cover: { style: 'soft' }, links: k === 'bio' ? [{ title: 'Syllabus', url: 'https://docs.google.com/', kind: 'syllabus' }, { title: 'Classroom', url: 'https://classroom.google.com/', kind: 'classroom' }, { title: 'Khan Academy', url: 'https://www.khanacademy.org/science/biology', kind: 'link' }] : [{ title: 'Classroom', url: 'https://classroom.google.com/', kind: 'classroom' }] }).id;
      });
      const s = subjects;
      add('assignments', { title: 'Reading response: chapter 3', subjectId: s.eng, dueDate: d(-1), dueTime: '23:59', priority: 'medium', description: 'One page on the narrator’s choices.' });
      add('assignments', { title: 'Lab report: enzymes', subjectId: s.bio, dueDate: d(1), dueTime: '08:00', priority: 'high', status: 'progress', link: 'https://docs.google.com/', description: 'Include the graph from Tuesday’s experiment.' });
      add('assignments', { title: 'Problem set 3.2', subjectId: s.math, dueDate: d(2), priority: 'medium', link: 'https://classroom.google.com/' });
      add('assignments', { title: 'Read chapters 4–5', subjectId: s.eng, dueDate: d(4), priority: 'low' });
      add('assignments', { title: 'Essay outline: causes of WWI', subjectId: s.hist, dueDate: d(6), priority: 'medium', status: 'progress' });
      add('assignments', { title: 'Worksheet 2.1', subjectId: s.math, dueDate: d(-2), priority: 'medium', status: 'submitted' });
      add('events', { title: 'Math quiz: linear functions', kind: 'exam', date: d(3), allDay: false, start: '08:00', end: '08:50', subjectId: s.math });
      const ev = add('events', { title: 'Biology unit test', kind: 'exam', date: d(9), allDay: false, start: '09:00', end: '09:50', subjectId: s.bio });
      add('events', { title: 'Soccer practice', kind: 'event', date: d(2), allDay: false, start: '16:00', end: '17:30' });
      add('reminders', { title: 'Bring calculator for Math', date: d(3), time: '07:30' });
      add('reminders', { title: 'Start reviewing for the Bio test', date: d(5), time: '18:00', eventId: ev ? ev.id : '' });
      const list = D.ensureList('inbox');
      add('todos', { listId: list, text: 'Pack gym clothes', dueDate: d(2) });
      add('todos', { listId: list, text: 'Email Ms. Rivera about the project', priority: 'high' });
      add('todos', { listId: list, text: 'Print the reading guide' });
      [[1, '08:00', '08:50', s.math, 'Room 101'], [1, '09:00', '09:50', s.bio, 'Lab 2'], [1, '10:00', '10:50', s.eng, 'Room 214'], [1, '13:10', '14:00', s.hist, 'Room 118']].forEach(([, start, end, subjectId, room]) => {
        [1, 2, 3, 4, 5].forEach(day => { if (subjectId === s.hist && day % 2 === 0) return; add('timetable', { day, start, end, subjectId, title: subj(subjectId)?.name || 'Class', room }); });
      });
      const folder = add('folders', { name: 'Biology' });
      add('notes', { folderId: folder.id, title: 'Cells: structure & function', subjectId: s.bio, content: 'Cell structure and functions:\n- Nucleus: controls cell activity\n- Mitochondria: makes energy (ATP)\n- Ribosomes: build proteins' });
      add('notes', { folderId: folder.id, title: 'Enzyme lab — observations', subjectId: s.bio, content: 'Reaction rate peaked around 37 °C. Above 60 °C the enzyme stopped working (denatured).' });
      add('quizzes', { title: 'Cell basics', subjectId: s.bio, cards: [{ term: 'Cell', def: 'The basic unit of life' }, { term: 'Mitochondria', def: 'Where the cell makes energy' }, { term: 'Nucleus', def: 'Holds the cell’s DNA' }, { term: 'Ribosome', def: 'Builds proteins' }] });
      add('quizzes', { title: 'Linear functions', subjectId: s.math, cards: [{ term: 'Slope', def: 'Rise over run' }, { term: 'y-intercept', def: 'Where the line crosses the y-axis' }, { term: 'y = mx + b', def: 'Slope-intercept form' }] });
      add('countdowns', { title: 'Winter break', date: d(30) });
      add('habits', { name: 'Read 20 minutes', color: '#21a67a', log: { [d(-1)]: true, [d(-2)]: true, [d(-3)]: true } });
      // a pinned class page so the example shows what a class looks like
      if (!SS.ws.classPage(s.bio)) {
        const page = SS.ws.createPage({ name: 'Biology', icon: '🧬', subjectId: s.bio, template: 'class' });
        if (page) reg.pages = [page.id];
      }
      const prev = demoReg() || {};
      Object.entries(prev).forEach(([k, v]) => { reg[k] = [...new Set([...(v || []), ...(reg[k] || [])])]; });
      SS.prefs.set('demo', reg);
      ['assignments', 'events', 'reminders', 'todos'].forEach(c => D.touch(c));   // repaint with “Example” labels
      return reg;
    },

    /* Removes every example record. Personal content is kept, including subjects or folders that the
       student's own records use. Undo restores everything. */
    clear(opts = {}) {
      const reg = demoReg(); if (!reg) return 0;
      const before = { content: D.snapshot(), pages: U.clone(SS.ws.state.pages), order: [...SS.ws.state.order], view: SS.ws.view(), reg: U.clone(reg) };
      const ids = Object.fromEntries(Object.entries(reg).map(([k, v]) => [k, new Set(v)]));
      const mine = (coll, x) => !(ids[coll] && ids[coll].has(x.id));
      const keepSubjects = new Set();
      ['assignments', 'events', 'notes', 'quizzes', 'timetable'].forEach(c => D.all(c).forEach(x => { if (mine(c, x) && x.subjectId) keepSubjects.add(x.subjectId); }));
      SS.ws.pages().forEach(p => { if (p.subjectId && !(ids.pages && ids.pages.has(p.id))) keepSubjects.add(p.subjectId); });
      const keepFolders = new Set(D.all('notes').filter(n => mine('notes', n)).map(n => n.folderId));
      let removed = 0;
      Object.keys(ids).forEach(coll => {
        if (!D.COLLECTIONS.includes(coll)) return;
        const out = D.removeWhere(coll, x => ids[coll].has(x.id) && !(coll === 'subjects' && keepSubjects.has(x.id)) && !(coll === 'folders' && keepFolders.has(x.id)), { undo: false });
        removed += out.length;
      });
      (ids.pages ? [...ids.pages] : []).forEach(pid => { if (!SS.ws.page(pid)) return; SS.ws.state.pages = SS.ws.state.pages.filter(p => p.id !== pid); SS.ws.state.order = SS.ws.state.order.filter(x => x !== pid); removed++; });
      SS.ws.save(); SS.bus.emit('nav');
      if (before.view !== 'home' && !SS.ws.state.order.includes(before.view)) SS.ws.setView('home');
      SS.prefs.set('demo', null);
      if (opts.undo !== false) SS.undo.push('Examples removed', () => {
        D.COLLECTIONS.forEach(c => D.set(c, before.content[c]));
        SS.ws.state.pages = before.pages; SS.ws.state.order = SS.ws.sanitizeOrder(before.order, before.pages); SS.ws.save(); SS.bus.emit('nav');
        SS.prefs.set('demo', before.reg);
      });
      return removed;
    }
  };

  /* ================================================================
     Styles: colours, type, wallpaper and card finish — never positions or sizes
     ================================================================ */
  const STYLE_KEYS = ['mode', 'accent', 'accent2', 'surface', 'surfaceDark', 'text', 'textDark', 'chrome', 'bg', 'font', 'radius', 'widget', 'stickers'];
  const CURATED = [
    { id: 'calm', name: 'Calm', blurb: 'Soft blue-lilac glass', appearance: () => U.clone(SS.presets.CALM) },
    { id: 'paper', name: 'Paper', blurb: 'Warm paper, crisp cards, serif headings', appearance: () => ({
      mode: 'light', accent: '#2f56c9', accent2: '#d9576f', surface: '#fffefb', text: '#1f2126',
      bg: { type: 'gradient', colors: ['#f7f4ee', '#f3efe7', '#efeae1'], angle: 170, animate: false, glow: false, grain: true },
      font: 'classic', radius: 16,
      widget: { surface: 'solid', opacity: 100, blur: 0, saturation: 100, shadow: 14, border: 45, padding: 'normal' },
      stickers: { on: false, set: '', count: 8, opacity: 50 } }) },
    { id: 'night', name: 'Night', blurb: 'Low-glare dark glass for late sessions', appearance: () => ({
      mode: 'dark', accent: '#9aa8ff', accent2: '#5eead4', surface: '#161a27', surfaceDark: '#161a27',
      bg: { type: 'mesh', colors: ['#070a12', '#151b3d', '#0b2431', '#20133a'], animate: false, glow: false },
      font: 'inter', radius: 22,
      widget: { surface: 'frosted', opacity: 64, blur: 22, saturation: 130, shadow: 50, border: 26, padding: 'normal' },
      stickers: { on: false, set: '', count: 8, opacity: 40 } }) }
  ];
  PL.CURATED = CURATED;
  /* every style: the curated three, then the look of each built-in workspace */
  PL.styles = () => [
    ...CURATED.map(s => ({ ...s, curated: true })),
    ...SS.presets.PRESETS.filter(p => !['today', 'study-play'].includes(p.id)).map(p => ({ id: 'preset:' + p.id, name: p.name, icon: p.icon, blurb: p.description, appearance: () => U.clone(p.appearance) }))
  ];
  PL.style = id => PL.styles().find(s => s.id === id) || null;
  const sig = a => [a.mode, a.accent, (a.bg && a.bg.type) || '', ((a.bg && a.bg.colors) || [])[0] || '', a.font, (a.widget && a.widget.surface) || ''].join('|').toLowerCase();
  PL.currentStyleId = (ws = SS.ws.active()) => { const now = sig(ws.appearance); const hit = PL.styles().find(s => sig(SS.ws.sanitizeAppearance(s.appearance())) === now); return hit ? hit.id : ''; };

  /* Apply a style to a workspace: colours, typography, wallpaper and card finish change; widget
     positions, sizes, filters, per-widget overrides, spacing, density and text size stay. */
  PL.applyStyle = (id, ws = SS.ws.active(), opts = {}) => {
    const st = PL.style(id); if (!st || !ws) return;
    const before = U.clone(ws.appearance);
    const next = st.appearance();
    const keep = { gap: before.gap, density: before.density, scale: before.scale };
    const merged = { ...before };
    STYLE_KEYS.forEach(k => { merged[k] = next[k] !== undefined ? U.clone(next[k]) : SS.ws.DEFAULT_APPEARANCE()[k]; });
    ws.appearance = SS.ws.sanitizeAppearance({ ...merged, ...keep });
    const repaint = () => { SS.ws.touch(ws, { appearance: true, meta: true }); if (SS.ws.active() === ws) { SS.theme.apply(ws); SS.dash.restyleAll(); SS.dash.layoutPass(); } SS.bus.emit('ws:list'); SS.bus.emit('style', { ws }); };
    repaint();
    if (opts.undo !== false) SS.undo.push(`Style: ${st.name}`, () => { ws.appearance = before; repaint(); }, { toast: opts.toast !== false });
  };

  /* Mini preview: the same representative content in every style — heading, a deadline row with a
     subject tag, a card surface and the primary button — so differences are obvious at a glance. */
  PL.stylePreview = (appearanceRaw, opts = {}) => {
    const a = SS.ws.sanitizeAppearance(U.clone(appearanceRaw));
    const k = SS.theme.tokens(a);
    const fake = { appearance: a, widgets: [] };
    const card = SS.theme.widgetStyle(fake, { style: {} }, { dense: true });
    const f = SS.theme.FONTS[a.font] || SS.theme.FONTS.inter;
    const box = el('div.sp-prev', { aria: { hidden: 'true' }, class: [k.dark ? 'sp-dark' : '', k.pageDark ? 'sp-page-dark' : ''].join(' ') });
    const paint = data => { const css = SS.theme.backgroundCSS(a, data); box.style.backgroundImage = css.image; box.style.backgroundColor = css.color; };
    paint(null);
    if (a.bg.type === 'image' && a.bg.imageId) SS.theme.imageData(a.bg.imageId).then(x => x && paint(x));
    if (a.bg.dim) box.append(el('span.sp-dim', { style: { background: a.bg.dimColor === 'light' ? `rgba(255,255,255,${a.bg.dim / 100})` : `rgba(8,9,14,${a.bg.dim / 100})` } }));
    const r = Math.max(2, Math.min(12, (a.radius || 16) / 2.4));
    const vars = { '--sp-page': k.pageText, '--sp-muted': U.rgba(k.pageText, 0.62), '--sp-accent': k.accent, '--sp-ink': k.accentInk, '--sp-r': `${r}px`, '--sp-display': f.display, '--sp-body': f.body };
    Object.entries(vars).forEach(([n, v]) => box.style.setProperty(n, v));
    const cardEl = el('div.sp-card');
    ['--w-bg', '--w-text', '--w-muted', '--w-faint', '--w-line', '--w-border', '--w-shadow', '--w-accent', '--w-fill'].forEach(n => { if (card.vars[n]) box.style.setProperty(n, card.vars[n]); });
    if (['frosted', 'liquid'].includes(card.style.surface)) box.classList.add('sp-glass');
    const row = (title, tag, color, due, late) => el('div.sp-row', { style: { '--sc': color } }, el('i.sp-check'), el('span.sp-title', { text: title }), el('span.sp-tag', { text: tag }), el('span.sp-due', { class: late ? 'late' : '', text: due }));
    cardEl.append(el('div.sp-card-h', { text: 'Due' }), row('Lab report', 'Biology', '#21a67a', 'Tue', false), row('Essay outline', 'History', '#f08c2e', 'Fri', false));
    box.append(
      el('div.sp-top', el('div.sp-heads', el('span.sp-eyebrow', { text: 'Tuesday' }), el('b.sp-heading', { text: 'November 10' })), el('span.sp-new', { text: '+ New' })),
      cardEl,
      el('div.sp-side', el('i'), el('i'), el('i')));
    if (opts.label) box.append(el('span.sp-label', { text: opts.label }));
    return box;
  };
  // every theme/workspace thumbnail now shows the representative preview
  SS.panels.themeThumb = (ws, opts = {}) => PL.stylePreview(ws.appearance, opts);

  /* Style picker grid (Customize → Style, and the welcome) */
  PL.styleGrid = ({ styles, value, onPick, size }) => {
    const grid = el('div.sp-grid', { role: 'radiogroup', aria: { label: 'Styles' }, class: size ? 'sp-' + size : '' });
    const cards = styles.map(s => {
      const b = el('button.sp-pick', { type: 'button', role: 'radio', aria: { checked: String(s.id === value), label: `${s.name}: ${s.blurb || ''}` }, dataset: { id: s.id } },
        PL.stylePreview(s.appearance()), el('span.sp-pick-text', el('b', { text: `${s.icon ? s.icon + ' ' : ''}${s.name}` }), s.blurb ? el('small', { text: s.blurb }) : null));
      b.addEventListener('click', () => { cards.forEach(c => c.setAttribute('aria-checked', String(c === b))); onPick(s.id); });
      return b;
    });
    grid.append(...cards);
    return grid;
  };

  /* Upgraders: switch to (or add) the Today workspace without touching their own */
  PL.tryToday = () => {
    let ws = SS.ws.all().find(w => w.presetId === 'today');
    if (!ws) ws = SS.ws.restorePreset('today');
    if (!ws) return;
    if (SS.ws.view() !== 'home') SS.nav.go('home', { focus: false });
    SS.ws.switchTo(ws.id);
    SS.ui.toast('This is Today. Your other workspaces are one click away in the top bar.', { icon: 'sun', timeout: 5200 });
  };

  /* ================================================================
     Class pages
     ================================================================ */
  PL.openClass = (subjectId, opts = {}) => {
    const s = subj(subjectId); if (!s) return null;
    let page = SS.ws.classPage(subjectId);
    if (!page) {
      page = SS.ws.createPage({ name: s.name, icon: s.icon || 'cap', subjectId, template: 'class', after: opts.after });
      if (!page) return null;
      if (opts.toast !== false) SS.ui.toast(`“${s.name}” is pinned to your sidebar`, { kind: 'success', icon: 'pin', timeout: 3000 });
    }
    if (opts.go !== false) SS.nav.go(page.id);
    return page;
  };
  /* Subjects open their class page when one is pinned, otherwise the subject overview */
  PL.openSubject = subjectId => (SS.ws.classPage(subjectId) ? PL.openClass(subjectId) : SS.panels.subject(subjectId));
  PL.currentSubject = () => { const p = SS.ws.page(SS.ws.view()); return p && p.subjectId && subj(p.subjectId) ? p.subjectId : ''; };

  const COVER_STYLES = [{ value: 'soft', label: 'Soft' }, { value: 'bold', label: 'Bold' }, { value: 'mesh', label: 'Mesh' }, { value: 'photo', label: 'Photo', icon: 'image' }, { value: 'none', label: 'None' }];
  PL.coverCSS = (s, imageData) => {
    const c = s.color; const c2 = U.mix(c, '#7a65ad', 0.45); const c3 = U.mix(c, '#ffffff', 0.55);
    const st = s.cover ? s.cover.style : 'soft';
    if (st === 'photo' && imageData) return `linear-gradient(180deg, rgba(0,0,0,.0) 40%, rgba(0,0,0,.28)), url("${imageData}") center / cover`;
    if (st === 'bold') return `linear-gradient(125deg, ${c}, ${c2})`;
    if (st === 'mesh') return `radial-gradient(at 12% 20%, ${U.rgba(c, 0.9)} 0, transparent 55%), radial-gradient(at 88% 10%, ${U.rgba(c2, 0.85)} 0, transparent 52%), radial-gradient(at 70% 95%, ${U.rgba(U.mix(c, '#ffd49d', 0.5), 0.8)} 0, transparent 55%), ${c3}`;
    if (st === 'none') return 'transparent';
    return `linear-gradient(120deg, ${U.rgba(c, 0.32)}, ${U.rgba(c2, 0.2)} 60%, ${U.rgba(c3, 0.25)})`;
  };
  const classIcon = (s, size = 22) => {
    const ic = s.icon;
    if (ic && SS.icon.names.includes(ic)) return SS.icon(ic, size);
    return el('span.cls-glyph', { text: ic && isEmoji(ic) ? ic : initial(s.name), aria: { hidden: 'true' } });
  };
  PL.classIcon = classIcon;

  /* Customize a class: name, colour, icon, cover and resource links (stored on the subject, shared by
     the class page, the subject overview and every widget that shows the subject) */
  PL.editClass = subjectId => {
    const s = subj(subjectId); if (!s) return;
    const dlg = SS.ui.dialog({ eyebrow: 'Class', title: `Customize ${s.name}`, size: 'md', class: 'dlg-class' });
    let color = s.color, icon = s.icon || '', cover = { ...(s.cover || { style: 'soft', imageId: '' }) };
    let links = U.clone(s.links || []);
    const name = SS.ui.input({ value: s.name, label: 'Class name', maxLength: 80 });
    const preview = el('div.cls-edit-preview');
    const paintPreview = async () => {
      const data = cover.style === 'photo' && cover.imageId ? await SS.theme.imageData(cover.imageId) : null;
      const fake = { ...s, name: name.value.trim() || s.name, color, icon, cover };
      preview.replaceChildren(el('div.cls-edit-cover', { style: { background: PL.coverCSS(fake, data) } }), el('span.cls-icon', { style: { '--sc': color } }, classIcon(fake, 22)), el('b', { text: fake.name }));
    };
    name.addEventListener('input', paintPreview);
    const colorCtl = SS.ui.color({ label: 'Class colour', value: color, swatches: U.SUBJECT_COLORS.concat(['#14b8a6', '#9b5de5', '#d4a514', '#7b2d26']), onChange: v => { color = v || color; paintPreview(); } });
    const QUICK = ['🧬', '📐', '📖', '🏛️', '🧪', '🌍', '🎨', '🎵', '💻', '⚽', '🗣️', '📊', '✍️', '🔭'];
    const iconIn = SS.ui.input({ value: isEmoji(icon) ? icon : '', placeholder: 'Type an emoji', label: 'Class icon', maxLength: 8 });
    const picks = el('div.cls-icon-picks', QUICK.map(e => el('button.cls-icon-pick', { type: 'button', text: e, aria: { label: `Use ${e}` }, on: { click: () => { icon = e; iconIn.value = e; paintPreview(); } } })),
      el('button.cls-icon-pick.txt', { type: 'button', text: 'Aa', title: 'Use the first letter', aria: { label: 'Use the first letter' }, on: { click: () => { icon = ''; iconIn.value = ''; paintPreview(); } } }));
    iconIn.addEventListener('input', () => { const v = iconIn.value.trim(); icon = v ? [...v].slice(0, 2).join('') : ''; paintPreview(); });
    const coverSeg = SS.ui.segmented({ label: 'Cover', value: cover.style, wrap: true, options: COVER_STYLES, onChange: v => {
      if (v === 'photo' && !cover.imageId) { uploadCover(); return; }
      cover.style = v; paintPreview();
    } });
    function uploadCover() {
      const inp = el('input', { type: 'file', accept: 'image/*' });
      inp.addEventListener('change', async () => {
        const file = inp.files[0]; if (!file) { coverSeg.setValue(cover.style); return; }
        try { const data = await U.shrinkImage(file, 1600, 0.82); const rec = { id: U.uid('cv'), data, kind: 'cover', name: file.name, at: Date.now() }; await SS.store.images.put(rec); SS.theme.images.set(rec.id, data); cover = { style: 'photo', imageId: rec.id }; coverSeg.setValue('photo'); paintPreview(); }
        catch (_) { SS.ui.toast('Couldn’t use that photo. Try a JPG, PNG or WebP.', { kind: 'error' }); coverSeg.setValue(cover.style); }
      });
      inp.click();
    }
    const linkBox = el('div.cls-links-edit');
    const drawLinks = () => {
      linkBox.replaceChildren(...links.map((l, i) => {
        const t = SS.ui.input({ value: l.title, placeholder: 'Title', label: `Link ${i + 1} title`, maxLength: 80 });
        const u = SS.ui.input({ value: l.url, placeholder: 'https://…', label: `Link ${i + 1} address`, maxLength: 2000 });
        const kind = SS.ui.select({ label: `Link ${i + 1} type`, value: l.kind, options: [{ value: 'syllabus', label: 'Syllabus' }, { value: 'classroom', label: 'Classroom' }, { value: 'link', label: 'Other' }], onChange: v => { l.kind = v; } });
        t.addEventListener('input', () => { l.title = t.value; }); u.addEventListener('input', () => { l.url = u.value; });
        return el('div.cls-link-row', kind, t, u, el('button.icon-btn.sm', { type: 'button', aria: { label: `Remove link ${i + 1}` }, title: 'Remove', on: { click: () => { links.splice(i, 1); drawLinks(); } } }, SS.icon('x', 15)));
      }), el('div.row-gap',
        el('button.btn.btn-sm', { type: 'button', on: { click: () => { links.push({ title: 'Syllabus', url: '', kind: 'syllabus' }); drawLinks(); } } }, SS.icon('plus', 14), 'Syllabus'),
        el('button.btn.btn-sm', { type: 'button', on: { click: () => { links.push({ title: 'Classroom', url: '', kind: 'classroom' }); drawLinks(); } } }, SS.icon('plus', 14), 'Classroom'),
        el('button.btn.btn-sm', { type: 'button', on: { click: () => { links.push({ title: '', url: '', kind: 'link' }); drawLinks(); } } }, SS.icon('plus', 14), 'Other link')));
    };
    drawLinks(); paintPreview();
    dlg.body.append(preview, SS.ui.field('Name', name), el('div.field', el('div.field-label', { text: 'Colour' }), colorCtl),
      el('div.field', el('div.field-label', { text: 'Icon' }), picks, iconIn), SS.ui.field('Cover', coverSeg),
      el('div.field', el('div.field-label', { text: 'Resources' }), el('p.hint', { text: 'Syllabus, Google Classroom, textbook, anything you open often for this class.' }), linkBox));
    dlg.foot.append(el('button.btn', { type: 'button', text: 'Cancel', on: { click: () => dlg.close() } }), el('button.btn.btn-primary', { type: 'button', text: 'Save', on: { click: () => {
      const nm = name.value.trim(); if (!nm) { name.focus(); return; }
      const bad = links.find(l => l.url.trim() && !U.webURL(l.url));
      if (bad) { SS.ui.toast(`“${bad.title || bad.url}” isn’t a valid web address.`, { kind: 'error' }); return; }
      const oldName = s.name;
      D.update('subjects', s.id, { name: nm, color, icon, cover, links: links.filter(l => l.url.trim()).map(l => ({ ...l, url: U.webURL(l.url), title: l.title.trim() })) });
      const page = SS.ws.classPage(s.id);
      if (page) { if (page.name === oldName) SS.ws.renamePage(page.id, nm); SS.ws.setPageIcon(page.id, icon || 'cap'); }
      dlg.close();
    } } }));
  };

  /* Add menu for a class: everything starts with the class's subject */
  PL.addForSubject = (subjectId, anchor) => SS.ui.menu([
    { heading: `Add to ${subj(subjectId)?.name || 'this class'}` },
    { label: 'Assignment', icon: 'checklist', onClick: () => SS.editors.assignment(null, { subjectId }) },
    { label: 'Exam', icon: 'cap', onClick: () => SS.editors.event(null, { kind: 'exam', subjectId }) },
    { label: 'Event', icon: 'calendar', onClick: () => SS.editors.event(null, { subjectId }) },
    { label: 'Note', icon: 'note', onClick: () => PL.newNote(subjectId) },
    { label: 'Study set', icon: 'cards', onClick: () => SS.cards.edit(null, { subjectId }) },
    { label: 'Class time', icon: 'clock', onClick: () => SS.editors.timetable(null, { subjectId, title: subj(subjectId)?.name || '', day: new Date().getDay() || 1 }) },
    '-',
    { label: 'Quick add…', icon: 'zap', kbd: 'N', onClick: () => SS.panels.quickAdd({ subjectId }) }
  ], { anchor, label: 'Add to class' });
  PL.newNote = subjectId => {
    const s = subj(subjectId);
    let f = s ? D.all('folders').find(x => x.name === s.name) : null;
    if (!f) f = D.add('folders', { name: s ? s.name : 'Notes' });
    const n = D.add('notes', { folderId: f.id, title: '', subjectId: subjectId || '' });
    SS.panels.notebook(n.id);
  };

  /* ================================================================
     Shared bits for the planner widgets
     ================================================================ */
  const whenLabel = (date, time) => {
    const n = U.daysFromToday(date);
    if (n < 0) return n === -1 ? 'Yesterday' : `${-n} days late`;
    if (n === 0) return time ? U.fmtTime(time) : 'Today';
    if (n === 1) return time ? `Tmrw ${U.fmtTime(time)}` : 'Tomorrow';
    if (n < 7) return U.fmtDate(date, { weekday: 'short' });
    return U.fmtDate(date, { month: 'short', day: 'numeric' });
  };
  const openPlanner = () => { const p = SS.ws.pages().find(x => x.template === 'planner') || SS.ws.pages().find(x => x.widgets.some(w => w.type === 'calendar') && !x.subjectId); if (p) SS.nav.go(p.id); else SS.panels.library({ query: 'calendar' }); };
  PL.openPlanner = openPlanner;
  const markDone = (it, row) => {
    const coll = KIND_COLL[it.kind]; if (!coll) return;
    const title = it.title;
    const done = () => {
      D.update(coll, it.id, { done: true });
      SS.undo.push(`Done: “${title.length > 40 ? title.slice(0, 38) + '…' : title}”`, () => D.update(coll, it.id, { done: false }), { toast: false });
      const left = D.overdue().filter(x => x.kind === 'assignment').length + D.agenda({ from: today(), to: today(), kinds: ['assignment'] }).length;
      SS.ui.toast(left ? `Nice — “${title}” is done` : 'All caught up for today 🎉', { kind: 'success', icon: left ? 'check' : 'sparkles', action: { label: 'Undo', fn: () => SS.undo.run() }, timeout: 4200 });
    };
    if (row && !U.reducedMotion()) { row.classList.add('dw-leaving'); setTimeout(done, 360); } else done();
  };

  /* ================================================================
     Widget: Today header
     ================================================================ */
  R.define({
    type: 'today', name: 'Today header', category: 'planning', icon: 'sun',
    description: 'A large date heading with a greeting, what’s due at a glance, and one clear + New button.',
    keywords: 'date heading greeting new add planner today hero',
    sizes: { s: [6, 2], m: [8, 2], l: [12, 2], xl: [12, 3] }, size: 'l', min: [4, 2], max: [12, 4], adapt: 'limited', sizeAware: true, header: false,
    defaults: () => ({ greeting: true, summary: true }),
    data: ['day', 'prefs', 'data:assignments', 'data:events', 'data:todos', 'data:reminders', 'data:timetable', 'style'],
    mount(ctx) {
      const update = () => ctx.render(() => {
        const c = ctx.config; const t = today(); const cw = ctx.cw || 600;
        const opts = cw >= 600 ? { weekday: 'long', month: 'long', day: 'numeric' } : cw >= 380 ? { weekday: 'long', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' };
        const dateText = U.fmtDate(t, opts);
        const parts = (() => { try { return new Intl.DateTimeFormat(undefined, opts).formatToParts(U.parseISO(t)); } catch (_) { return null; } })();
        const heading = el('h1.td-date');
        if (parts) parts.forEach(p => heading.append(p.type === 'weekday' ? el('span.td-wd', { text: p.value }) : document.createTextNode(p.value)));
        else heading.textContent = dateText;
        heading.setAttribute('aria-label', dateText);
        const name = SS.prefs.get('name');
        const classesToday = D.all('timetable').filter(e => e.day === new Date().getDay()).length;
        const summary = K.summary() + (classesToday ? ` · ${U.plural(classesToday, 'class', 'classes')} today` : '');
        const newBtn = el('button.btn.btn-primary.td-new', { type: 'button', title: 'Add an assignment, exam, to-do, reminder, event or note (N)', on: { click: () => SS.panels.quickAdd() } }, SS.icon('plus', 18), el('span', { text: 'New' }));
        const demo = DEMO.active() ? el('div.td-demo', el('span.td-demo-dot'), el('span', { text: 'Showing examples' }), el('button.link-btn', { type: 'button', aria: { label: 'Remove examples' }, on: { click: () => removeExamples() } }, 'Remove', el('b.td-demo-x', { text: ' examples' }))) : null;
        return el('div.td-hero', { class: [cw < 520 ? 'td-compact' : '', ctx.ch && ctx.ch > 150 ? 'td-tall' : ''].join(' ') },
          el('div.td-titles',
            c.greeting !== false ? el('p.td-eyebrow', { text: `Good ${U.greeting()}${name ? ', ' + name : ''}` }) : null,
            heading,
            c.summary !== false ? el('p.td-sum', { text: summary }) : null),
          el('div.td-actions', demo, newBtn));
      });
      update();
      return { update, resize: update };
    },
    settings: () => [
      { key: 'greeting', type: 'toggle', label: 'Show a greeting' },
      { key: 'summary', type: 'toggle', label: 'Show what’s due at a glance' },
      { type: 'note', text: 'Set your name in Settings → General. + New opens Quick add (shortcut: N).' }
    ],
    preview: () => el('div.pv-today', el('small', { text: 'Good morning' }), el('b', { text: 'Tuesday, Nov 10' }), el('i', { text: '+ New' }))
  });
  async function removeExamples() {
    const n = DEMO.count();
    const ok = await SS.ui.confirm({ title: 'Remove the examples?', message: `${U.plural(n, 'example item')} (assignments, exams, classes, notes and the example class page) will be removed. Anything you added yourself stays. You can undo right after.`, ok: 'Remove examples', danger: false });
    if (ok) DEMO.clear();
  }
  PL.removeExamples = removeExamples;

  /* ================================================================
     Widget: Due work — overdue first, then the next few deadlines
     ================================================================ */
  R.define({
    type: 'due', name: 'Due work', category: 'planning', icon: 'flag', keepsContent: true, dense: true,
    description: 'The one list that matters today: overdue work first, then the next few deadlines, grouped by day with subject colours.',
    keywords: 'due deadlines overdue homework assignments exams today planner focus',
    sizes: { s: [4, 5], m: [6, 7], l: [7, 9], xl: [8, 10] }, size: 'l', min: [3, 3], max: [12, 14], adapt: 'free', sizeAware: true,
    defaults: () => ({ days: 14, limit: 8, subjectId: '', todos: false, exams: true }),
    title: () => 'Due',
    data: ['data:assignments', 'data:events', 'data:todos', 'data:subjects', 'day', 'minute'],
    mount(ctx) {
      const update = () => ctx.render(() => {
        const c = ctx.config; const t = today();
        const kinds = ['assignment', ...(c.exams !== false ? ['exam'] : []), ...(c.todos ? ['todo'] : [])];
        const overdue = D.overdue({ subjectId: c.subjectId }).filter(x => kinds.includes(x.kind));
        const ahead = D.agenda({ from: t, to: U.addDays(t, U.clampNum(c.days, 1, 120, 14)), kinds, subjectId: c.subjectId }).filter(x => !overdue.some(o => o.id === x.id));
        const limit = U.clampNum(c.limit, 3, 30, 8);
        const shown = ahead.slice(0, Math.max(limit, ahead.filter(x => U.daysFromToday(x.date) <= 1).length));
        const more = ahead.length - shown.length;
        // open assignments without a date still belong somewhere visible (e.g. one just added from here)
        const undated = D.all('assignments').filter(a => !a.done && !a.dueDate && (!c.subjectId || a.subjectId === c.subjectId)).sort((a, b) => b.createdAt - a.createdAt)
          .map(a => ({ kind: 'assignment', id: a.id, title: a.title, date: '', time: '', subjectId: a.subjectId, priority: a.priority, status: a.status }));
        const s = c.subjectId ? subj(c.subjectId) : null;
        ctx.setActions([
          overdue.length ? el('span.dw-badge', { text: `${overdue.length} late`, title: `${U.plural(overdue.length, 'item')} overdue` }) : null,
          SS.ui.iconBtn('plus', s ? `New ${s.name} assignment` : 'New assignment', () => SS.editors.assignment(null, { subjectId: c.subjectId }), 'sm')
        ]);
        if (K.isStrip(ctx)) return K.listStrip({ ctx, label: 'Due', count: overdue.length ? `${overdue.length} overdue` : `${ahead.length} due`, empty: 'All caught up', items: [...overdue.map(x => ({ ...x, overdue: true })), ...ahead, ...undated], add: () => SS.editors.assignment(null, { subjectId: c.subjectId }), addLabel: 'New assignment' });
        if (!overdue.length && !ahead.length && !undated.length) return emptyState(c, s);
        const box = el('div.dw', { class: ctx.cw < 330 ? 'dw-narrow' : '' });
        const list = el('div.dw-list', { role: 'list' });
        if (overdue.length) {
          list.append(groupHead('Overdue', overdue.length, 'late'));
          overdue.forEach(it => list.append(dueRow(it, true)));
        }
        let last = null;
        shown.forEach(it => {
          const n = U.daysFromToday(it.date);
          const key = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 7 ? it.date : 'later';
          if (key !== last) {
            last = key;
            const label = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? U.fmtDate(it.date, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Later';
            list.append(groupHead(label, null, n === 0 ? 'today' : ''));
          }
          list.append(dueRow(it, false));
        });
        if (undated.length) {
          list.append(groupHead('No due date', null, ''));
          undated.slice(0, 3).forEach(it => list.append(dueRow(it, false)));
          if (undated.length > 3) list.append(el('button.link-btn.dw-more', { type: 'button', text: `${undated.length - 3} more without a date`, on: { click: openPlanner } }));
        }
        box.append(K.scroll('due', list));
        if (more > 0 || !c.subjectId) box.append(el('div.dw-foot', more > 0 ? el('span', { text: `${more} more in the next ${U.plural(c.days, 'day')}` }) : el('span', { text: overdue.length ? 'Catch up on overdue work first' : ahead.length > 3 ? 'Plan a little each day' : 'A light stretch ahead' }),
          el('button.link-btn', { type: 'button', on: { click: openPlanner } }, 'Open planner', SS.icon('chevR', 13))));
        return box;
      });
      function groupHead(label, count, cls) {
        return el('div.dw-group', { class: cls || '', role: 'presentation' }, el('span', { text: label }), count ? el('b', { text: String(count) }) : null);
      }
      function dueRow(it, late) {
        const s = it.subjectId ? subj(it.subjectId) : null;
        const color = s ? s.color : (it.kind === 'exam' ? 'var(--w-accent)' : 'var(--w-faint)');
        const asg = it.kind === 'assignment' ? D.get('assignments', it.id) : null;
        const row = el('div.dw-row', { role: 'listitem', class: [late ? 'late' : '', 'k-' + it.kind, it.priority === 'high' ? 'hi' : ''].join(' '), style: { '--sc': color } });
        const toggle = ['assignment', 'todo', 'reminder'].includes(it.kind);
        if (toggle) {
          const chk = K.check(false, `Mark “${it.title}” done`, v => { if (v) markDone(it, row); });
          row.append(chk);
        } else row.append(el('span.dw-kind', { title: K.kindLabel(it.kind) }, SS.icon(it.kind === 'exam' ? 'cap' : 'calendar', 14)));
        const meta = el('div.dw-meta');
        if (s && !ctx.config.subjectId) meta.append(el('span.dw-subj', el('i'), el('span', { text: s.name })));
        if (it.kind === 'exam') meta.append(el('span.chip.chip-exam', { text: 'Exam' }));
        if (asg && (asg.status === 'progress')) meta.append(el('span.chip.chip-status.st-progress', { text: 'In progress' }));
        if (it.time && it.date && U.daysFromToday(it.date) > 1) meta.append(el('span.dw-time', { text: U.fmtTime(it.time) }));
        else if (it.time && late) meta.append(el('span.dw-time', { text: `due ${U.fmtTime(it.time)}` }));
        if (it.priority === 'high') meta.append(el('span.chip.chip-high', { text: 'High' }));
        if (DEMO.isItem(it)) meta.append(K.exampleChip());
        const open = el('button.dw-open', { type: 'button', aria: { label: `${K.kindLabel(it.kind)}: ${it.title}, ${late ? 'overdue' : it.date ? 'due ' + U.relDay(it.date) : 'no due date'}. Open details.` }, on: { click: () => K.openItem(it) } },
          el('span.dw-title', el('span', { text: it.title }, it.priority === 'high' ? el('i.dw-hi', { text: '●', title: 'High priority', aria: { hidden: 'true' } }) : null)), meta.children.length ? meta : null);
        row.append(open, el('span.dw-when', { class: late ? 'late' : it.date && U.daysFromToday(it.date) === 0 ? 'today' : '', text: it.date ? whenLabel(it.date, it.time) : '' }));
        if (asg && asg.link) row.append(el('a.icon-btn.xs.dw-link', { href: asg.link, target: '_blank', rel: 'noopener noreferrer', title: `Open assignment link (${U.hostOf(asg.link)})`, aria: { label: `Open the link for ${it.title}` } }, SS.icon('external', 13)));
        return row;
      }
      function emptyState(c, s) {
        const ever = D.all('assignments').some(a => !c.subjectId || a.subjectId === c.subjectId);
        const noSubjects = !D.all('subjects').length;
        return el('div.dw-empty',
          el('div.dw-empty-art', el('span'), SS.icon(ever ? 'check' : 'flag', 26)),
          el('h3', { text: ever ? 'You’re all caught up' : (s ? `Nothing due for ${s.name}` : 'Your deadlines will live here') }),
          el('p', { text: ever ? `Nothing due in the next ${U.plural(c.days, 'day')}. A good moment to get ahead or review.` : 'Add your first assignment or exam and Tester sorts everything by what’s due next.' }),
          el('div.row-gap',
            el('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => SS.editors.assignment(null, { subjectId: c.subjectId }) } }, SS.icon('plus', 14), 'Add assignment'),
            el('button.btn.btn-sm', { type: 'button', on: { click: () => SS.editors.event(null, { kind: 'exam', subjectId: c.subjectId }) } }, SS.icon('cap', 14), 'Add exam')),
          noSubjects && !c.subjectId ? el('button.link-btn.dw-setup', { type: 'button', on: { click: () => SS.editors.subject() } }, 'Set up your classes first', SS.icon('chevR', 13)) : null);
      }
      update();
      // on the minute, re-render only when something just became overdue
      const sigNow = () => D.overdue({ subjectId: ctx.config.subjectId }).length;
      let lastSig = sigNow();
      return { update: e => { if (e instanceof Date) { const n = sigNow(); if (n === lastSig) return; lastSig = n; } else lastSig = sigNow(); update(); }, resize: update };
    },
    settings: () => [
      { key: 'days', type: 'slider', label: 'Look ahead', min: 3, max: 60, step: 1, unit: ' days' },
      { key: 'limit', type: 'slider', label: 'Upcoming items to show', min: 3, max: 20, step: 1 },
      { key: 'exams', type: 'toggle', label: 'Include exams' },
      { key: 'todos', type: 'toggle', label: 'Include to-dos with due dates' },
      { key: 'subjectId', type: 'subject', label: 'Only this subject' },
      { type: 'note', text: 'Tick the circle to finish an assignment. Open one to set its progress (In progress, Submitted…) or its link.' }
    ],
    preview: () => el('div.pv-list', [['Reading response', 'Late'], ['Lab report', 'Tmrw'], ['Problem set', 'Tue']].map(([t, d]) => el('div', el('i'), el('span', { text: t }), el('small', { text: d }))))
  });

  /* ================================================================
     Widget: Week strip
     ================================================================ */
  R.define({
    type: 'weekstrip', name: 'Week at a glance', category: 'planning', icon: 'calendar',
    description: 'Seven days in one compact row. Dots show what’s due; tap a day to see it.',
    keywords: 'week strip days glance calendar compact',
    sizes: { s: [4, 2], m: [5, 2], l: [6, 2], xl: [12, 2] }, size: 'm', min: [3, 2], max: [12, 4], adapt: 'limited', sizeAware: true, header: false,
    defaults: () => ({ offset: 0 }),
    data: ['data:assignments', 'data:events', 'data:todos', 'data:reminders', 'data:subjects', 'day', 'prefs'],
    mount(ctx) {
      let offset = 0;
      const update = () => ctx.render(() => {
        const ws = SS.prefs.get('weekStart') || 0;
        const t = today(); const dow = U.parseISO(t).getDay();
        const start = U.addDays(t, -((dow - ws + 7) % 7) + offset * 7);
        const days = Array.from({ length: 7 }, (_, i) => U.addDays(start, i));
        const items = D.agenda({ from: days[0], to: days[6], kinds: ['assignment', 'exam', 'event', 'reminder'], includeDone: false });
        const by = new Map(days.map(d => [d, []])); items.forEach(it => by.get(it.date)?.push(it));
        const range = `${U.fmtDate(days[0], { month: 'short', day: 'numeric' })} – ${U.fmtDate(days[6], U.parseISO(days[0]).getMonth() === U.parseISO(days[6]).getMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
        const head = el('div.wk-head',
          el('span.wk-title', { text: offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : 'Week of' }), el('span.wk-range', { text: range }),
          el('span.grow'),
          offset !== 0 ? el('button.link-btn.wk-today', { type: 'button', text: 'Today', on: { click: () => { offset = 0; update(); } } }) : null,
          SS.ui.iconBtn('chevL', 'Previous week', () => { offset--; update(); }, 'xs'), SS.ui.iconBtn('chevR', 'Next week', () => { offset++; update(); }, 'xs'));
        const row = el('div.wk-days', { role: 'list' });
        days.forEach(d => {
          const list = by.get(d); const n = U.daysFromToday(d);
          const dots = el('span.wk-dots', { aria: { hidden: 'true' } });
          list.slice(0, 3).forEach(it => dots.append(el('i', { class: it.kind === 'exam' ? 'exam' : '', style: { '--dc': it.subjectId ? subjColor(it.subjectId) : (it.kind === 'reminder' ? '#f08c2e' : 'var(--w-accent)') } })));
          if (list.length > 3) dots.append(el('b', { text: '+' }));
          const b = el('button.wk-day', { type: 'button', role: 'listitem', class: [n === 0 ? 'today' : '', n < 0 ? 'past' : '', list.some(x => x.kind === 'exam') ? 'has-exam' : ''].join(' '),
            aria: { label: `${U.fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? `: ${U.plural(list.length, 'item')}` : ': nothing due'}` },
            on: { click: e => dayPop(d, list, e.currentTarget) } },
          el('span.wk-wd', { text: U.fmtDate(d, { weekday: ctx.cw < 330 ? 'narrow' : 'short' }) }), el('span.wk-num', { text: String(U.parseISO(d).getDate()) }), dots);
          row.append(b);
        });
        return el('div.wk', head, row);
      });
      function dayPop(d, list, anchor) {
        const n = U.daysFromToday(d);
        const box = el('div.wk-pop',
          el('div.wk-pop-h', el('b', { text: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : U.fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' }) }), el('small', { text: list.length ? U.plural(list.length, 'item') : 'Nothing due' })),
          list.length ? el('div.wl', list.map(it => K.agendaRow(it, { showDate: false }))) : el('p.hint', { text: 'A free day. Add something?' }),
          el('div.row-gap.wk-pop-f',
            el('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => { SS.ui.closeMenu(); SS.editors.assignment(null, { dueDate: d, subjectId: PL.currentSubject() }); } } }, SS.icon('plus', 14), 'Assignment'),
            el('button.btn.btn-sm', { type: 'button', on: { click: () => { SS.ui.closeMenu(); SS.editors.event(null, { date: d, subjectId: PL.currentSubject() }); } } }, SS.icon('calendar', 14), 'Event'),
            el('button.link-btn', { type: 'button', on: { click: () => { SS.ui.closeMenu(); openPlanner(); } } }, 'Calendar', SS.icon('chevR', 13))));
        box.querySelectorAll('.wl-item').forEach(r => r.addEventListener('click', () => SS.ui.closeMenu()));
        SS.ui.popover(anchor, box, { label: `Due ${U.fmtDate(d)}`, align: 'left' });
      }
      update();
      return { update, resize: update };
    },
    settings: () => [{ type: 'note', text: 'The week starts on the day set in Settings → General. Dots are coloured by subject; exams have a ring.' }],
    preview: () => el('div.pv-week', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => el('span', { class: i === 2 ? 'on' : '', text: x })))
  });

  /* ================================================================
     Widget: Next class
     ================================================================ */
  PL.classNow = () => {
    const all = D.all('timetable'); if (!all.length) return { none: true };
    const now = new Date(); const dow = now.getDay(); const t = nowMinutes();
    const todays = all.filter(e => e.day === dow).sort((a, b) => a.start.localeCompare(b.start));
    const cur = todays.find(e => minutesOf(e.start) <= t && t < minutesOf(e.end)) || null;
    let next = todays.find(e => minutesOf(e.start) > t) || null, inDays = 0;
    for (let k = 1; !next && k <= 7; k++) { const l = all.filter(e => e.day === (dow + k) % 7).sort((a, b) => a.start.localeCompare(b.start)); if (l.length) { next = l[0]; inDays = k; } }
    const later = todays.filter(e => minutesOf(e.start) > t && e !== next);
    const nextDay = next ? all.filter(e => e.day === next.day && e !== next && e.start > next.start).sort((a, b) => a.start.localeCompare(b.start)) : [];
    return { cur, next, inDays, later: inDays === 0 ? later : nextDay, todayCount: todays.length };
  };
  R.define({
    type: 'nextclass', name: 'Now & next class', category: 'planning', icon: 'clock',
    description: 'The class you’re in right now, or the next one, with its room and how long until it starts.',
    keywords: 'class next now timetable schedule period room',
    sizes: { s: [3, 3], m: [5, 3], l: [6, 4], xl: [8, 4] }, size: 'm', min: [3, 2], max: [12, 6], adapt: 'free', sizeAware: true,
    title: () => 'Classes',
    defaults: () => ({ showLater: true }),
    data: ['data:timetable', 'data:subjects', 'minute', 'day'],
    mount(ctx) {
      const update = () => ctx.render(() => {
        const st = PL.classNow();
        ctx.setActions(SS.ui.iconBtn('plus', 'Add class time', () => SS.editors.timetable(null, { day: new Date().getDay() || 1, subjectId: PL.currentSubject() }), 'sm'));
        if (st.none) return el('div.nc-empty', SS.icon('clock', 20), el('div', el('b', { text: 'Add your class schedule' }), el('p', { text: 'Enter each class once and it repeats every week.' })),
          el('button.btn.btn-sm', { type: 'button', on: { click: () => SS.editors.timetable(null, { day: new Date().getDay() || 1 }) } }, SS.icon('plus', 14), 'Add a class'));
        const label = e => (e.subjectId && subj(e.subjectId)?.name) || e.title;
        const color = e => (e.subjectId ? subjColor(e.subjectId, 'var(--w-accent)') : 'var(--w-accent)');
        const go = e => (e.subjectId && subj(e.subjectId) ? PL.openSubject(e.subjectId) : SS.editors.timetable(e.id));
        const block = (e, tag, when, extra) => el('button.nc-block', { type: 'button', class: tag === 'Now' ? 'now' : '', style: { '--sc': color(e) }, aria: { label: `${tag}: ${label(e)}, ${when}${e.room ? ', ' + e.room : ''}` }, on: { click: () => go(e) } },
          el('span.nc-tag', { text: tag }),
          el('span.nc-name', { text: label(e) }),
          el('span.nc-when', { text: [when, e.room].filter(Boolean).join(' · ') }),
          extra || null);
        const box = el('div.nc', { class: ctx.cw >= 420 && ctx.ch >= 150 ? 'nc-wide' : '' });
        const t = nowMinutes();
        if (st.cur) {
          const total = minutesOf(st.cur.end) - minutesOf(st.cur.start); const done = t - minutesOf(st.cur.start);
          box.append(block(st.cur, 'Now', `until ${U.fmtTime(st.cur.end)} · ${U.minutesLabel(minutesOf(st.cur.end) - t)} left`, el('span.nc-bar', el('i', { style: { width: `${Math.round(U.clamp(done / Math.max(1, total), 0, 1) * 100)}%` } }))));
        }
        if (st.next) {
          const mins = minutesOf(st.next.start) - t;
          const when = st.inDays === 0 ? (mins <= 90 ? `in ${U.minutesLabel(mins)}` : `at ${U.fmtTime(st.next.start)}`) : st.inDays === 1 ? `Tomorrow ${U.fmtTime(st.next.start)}` : `${U.weekdayNames(0, 'long')[st.next.day]} ${U.fmtTime(st.next.start)}`;
          if (!st.cur || ctx.ch >= 130 || ctx.shape === 'stack') box.append(block(st.next, st.cur ? 'Next' : 'Next class', when));
          else box.append(el('p.nc-then', { text: `Next: ${label(st.next)} ${when}` }));
        }
        if (ctx.config.showLater !== false && st.later.length && (ctx.ch >= 110 || ctx.shape === 'stack')) box.append(el('div.nc-then.nc-later', el('span', { text: st.cur || st.inDays === 0 ? 'Later today' : 'Then' }), st.later.slice(0, 4).map(e => el('button.nc-chip', { type: 'button', style: { '--sc': color(e) }, on: { click: () => go(e) } }, el('i'), el('span', { text: label(e) }), el('small', { text: U.fmtTime(e.start) })))));
        if (!st.cur && !st.next) box.append(el('p.nc-then', { text: 'No classes in the next week.' }));
        return box;
      });
      update();
      return { update, resize: update };
    },
    settings: () => [{ key: 'showLater', type: 'toggle', label: 'List the rest of today’s classes' }, { type: 'action', label: 'Add a class time', icon: 'plus', run: () => SS.editors.timetable(null, { day: new Date().getDay() || 1 }) }],
    preview: () => el('div.pv-tt', [['Now', 'Biology'], ['10:00', 'English']].map(([a, b]) => el('div', el('small', { text: a }), el('span', { text: b }))))
  });

  /* ================================================================
     Widget: Class header (cover, icon, name, resources, add)
     ================================================================ */
  R.define({
    type: 'classhead', name: 'Class header', category: 'study', icon: 'cap', keepsContent: true,
    description: 'A class page’s cover with its icon, colour, class times and resource links (syllabus, Classroom…).',
    keywords: 'class cover subject course header syllabus classroom links',
    sizes: { s: [6, 3], m: [8, 3], l: [12, 3], xl: [12, 4] }, size: 'l', min: [4, 2], max: [12, 6], adapt: 'limited', sizeAware: true, header: false,
    defaults: () => ({ subjectId: '' }),
    data: ['data:subjects', 'data:assignments', 'data:events', 'data:timetable', 'day'],
    mount(ctx) {
      let cover = null;
      const update = () => ctx.render(() => {
        const s = subj(ctx.config.subjectId);
        if (!s) return SS.ui.empty('cap', 'Pick a class', 'Choose which subject this page is for.', el('button.btn.btn-sm', { type: 'button', on: { click: () => ctx.openSettings() } }, 'Choose a subject'));
        const open = D.all('assignments').filter(a => a.subjectId === s.id && !a.done).length;
        const exam = D.agenda({ from: today(), kinds: ['exam'], subjectId: s.id })[0];
        const times = D.all('timetable').filter(e => e.subjectId === s.id).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
        const dayNames = U.weekdayNames(0, 'short');
        const timeText = times.length ? summarizeTimes(times, dayNames) : '';
        const room = times.find(e => e.room)?.room || '';
        const coverEl = el('div.ch-cover', { style: { background: PL.coverCSS(s, cover && cover.id === s.cover?.imageId ? cover.data : null) } });
        if (s.cover && s.cover.style === 'photo' && s.cover.imageId && !(cover && cover.id === s.cover.imageId)) SS.theme.imageData(s.cover.imageId).then(data => { if (data) { cover = { id: s.cover.imageId, data }; coverEl.style.background = PL.coverCSS(s, data); } });
        const links = (s.links || []).map(l => el('a.ch-link', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'lk-' + l.kind, title: l.url }, SS.icon(l.kind === 'syllabus' ? 'book' : l.kind === 'classroom' ? 'cap' : 'link', 14), el('span', { text: l.title || U.hostOf(l.url) }), SS.icon('external', 11)));
        const stats = [open ? `${open} to do` : 'All caught up', exam ? `${exam.title} ${U.relDay(exam.date).toLowerCase()}` : '', timeText, room].filter(Boolean);
        return el('div.ch', { style: { '--sc': s.color }, class: [s.cover && s.cover.style === 'none' ? 'ch-plain' : '', ctx.cw < 520 ? 'ch-compact' : ''].join(' ') },
          coverEl,
          el('div.ch-body',
            el('span.ch-icon', classIcon(s, 26)),
            el('div.ch-titles', el('h1.ch-name', { text: s.name }), el('p.ch-stats', stats.map((x, i) => el('span', { text: x, class: i === 0 && open ? 'hot' : '' })))),
            el('div.ch-actions',
              el('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: e => PL.addForSubject(s.id, e.currentTarget) } }, SS.icon('plus', 15), 'Add'),
              el('button.icon-btn.sm.ch-edit', { type: 'button', title: 'Customize this class', aria: { label: 'Customize this class' }, on: { click: () => PL.editClass(s.id) } }, SS.icon('palette', 16)))),
          el('div.ch-links', links.length ? links : null,
            el('button.ch-link.ch-addlink', { type: 'button', on: { click: () => PL.editClass(s.id) } }, SS.icon('plus', 13), el('span', { text: links.length ? 'Link' : 'Add syllabus, Classroom & links' }))));
      });
      update();
      return { update, resize: update };
    },
    settings: () => [{ key: 'subjectId', type: 'subject', label: 'Class (subject)' }, { type: 'action', label: 'Customize the class (cover, icon, links)…', icon: 'palette', run: ctx => PL.editClass(ctx.config.subjectId) }],
    preview: () => el('div.pv-class', el('i'), el('b', { text: 'Biology' }), el('small', { text: 'Syllabus · Classroom' }))
  });
  function summarizeTimes(times, names) {
    // "Mon, Wed, Fri 9:00" when the start time is shared, otherwise "Mon 9:00 · Tue 10:00…"
    const starts = [...new Set(times.map(e => e.start))];
    if (starts.length === 1) return `${[...new Set(times.map(e => names[e.day]))].join(', ')} ${U.fmtTime(starts[0])}`;
    return times.slice(0, 3).map(e => `${names[e.day]} ${U.fmtTime(e.start)}`).join(' · ') + (times.length > 3 ? '…' : '');
  }

  /* ================================================================
     Widget: Class work — notes and study sets for one subject
     ================================================================ */
  R.define({
    type: 'classwork', name: 'Notes & study sets', category: 'study', icon: 'notebook', keepsContent: true,
    description: 'A class’s notes and flashcard sets in one place, with buttons to add more for that class.',
    keywords: 'class notes sets flashcards subject study materials',
    sizes: { s: [4, 5], m: [5, 6], l: [6, 7], xl: [8, 8] }, size: 'm', min: [3, 3], max: [12, 12], adapt: 'free', sizeAware: true,
    defaults: () => ({ subjectId: '', tab: 'notes' }),
    title: c => (c.tab === 'sets' ? 'Study sets' : 'Notes'),
    data: ['data:notes', 'data:quizzes', 'data:subjects'],
    mount(ctx) {
      const update = () => ctx.render(() => {
        const c = ctx.config; const sid = c.subjectId; const s = subj(sid);
        const notes = D.all('notes').filter(n => !sid || n.subjectId === sid).sort((a, b) => b.updatedAt - a.updatedAt);
        const sets = D.all('quizzes').filter(q => !sid || q.subjectId === sid);
        ctx.setActions(SS.ui.iconBtn('plus', c.tab === 'sets' ? 'New study set' : 'New note', () => (c.tab === 'sets' ? SS.cards.edit(null, { subjectId: sid }) : PL.newNote(sid)), 'sm'));
        const box = el('div.cw');
        box.append(el('div.w-toolbar', K.tabs([{ value: 'notes', label: 'Notes', count: notes.length }, { value: 'sets', label: 'Study sets', count: sets.length }], c.tab, v => ctx.setConfig({ tab: v }), 'Show')));
        if (c.tab === 'sets') {
          if (!sets.length) box.append(SS.ui.empty('cards', s ? `No ${s.name} sets yet` : 'No study sets yet', 'Make flashcards, then quiz yourself in the Study tab.', el('button.btn.btn-sm', { type: 'button', on: { click: () => SS.cards.edit(null, { subjectId: sid }) } }, SS.icon('plus', 14), 'New study set')));
          else box.append(K.scroll('cw-sets', el('div.wl', sets.map(q => el('div.wl-item.cw-set', el('span.wl-kind', SS.icon('cards', 15)), el('div.wl-main', el('div.wl-title', { text: q.title }), el('div.wl-meta', el('span.chip', { text: U.plural(q.cards.length, 'card') }), D.subject(q.subjectId) && !sid ? SS.ui.subjectChip(q.subjectId) : null)),
            el('button.btn.btn-xs', { type: 'button', text: 'Cards', on: { click: () => SS.cards.study(q.id) } }), el('button.btn.btn-xs', { type: 'button', text: 'Quiz', aria: { label: `Quiz yourself: ${q.title}` }, on: { click: () => SS.quiz.practice(q.id) } }))))));
        } else {
          if (!notes.length) box.append(SS.ui.empty('note', s ? `No ${s.name} notes yet` : 'No notes yet', 'Notes you tag with this class show up here.', el('button.btn.btn-sm', { type: 'button', on: { click: () => PL.newNote(sid) } }, SS.icon('plus', 14), 'New note')));
          else box.append(K.scroll('cw-notes', el('div.wl', notes.map(n => el('button.wl-item.cw-note', { type: 'button', on: { click: () => SS.panels.notebook(n.id) } }, el('span.wl-kind', SS.icon('note', 15)), el('div.wl-main', el('div.wl-title', { text: n.title || 'Untitled note' }), el('div.wl-desc', { text: U.stripMarkdown(n.content).slice(0, 110) || 'Empty note' })), el('small.cw-date', { text: U.relDay(U.toISO(new Date(n.updatedAt))) }))))));
        }
        return box;
      });
      update();
      return { update, resize: update };
    },
    settings: () => [{ key: 'subjectId', type: 'subject', label: 'Only this subject' }, { key: 'tab', type: 'segmented', label: 'Show first', options: [{ value: 'notes', label: 'Notes' }, { value: 'sets', label: 'Study sets' }] }],
    preview: () => el('div.pv-list', [['Cells', 'Note'], ['Enzyme lab', 'Note'], ['Cell basics', '4 cards']].map(([t, d]) => el('div', el('i'), el('span', { text: t }), el('small', { text: d }))))
  });

  /* ================================================================
     Borrow a widget outside the dashboard (the Study tab's full-size timer)
     ================================================================ */
  PL.embed = (host, type, config = {}, opts = {}) => {
    const def = R.get(type); if (!def) return { destroy() {} };
    const widget = { id: U.uid('emb'), type, config: { ...U.clone(def.defaults()), ...config }, style: {} };
    const frame = el('article.widget.embed-widget', { dataset: { type }, role: 'region', aria: { label: opts.label || def.name } });
    const body = el('div.w-body');
    frame.append(el('div.w-surface', el('div.w-sheen')), body);
    host.append(frame);
    const subs = [];
    const paint = () => { const look = SS.ws.active(); const s = SS.theme.widgetStyle(look, widget, def); frame.className = ['widget', 'embed-widget', ...s.classes, 'no-head'].join(' '); [...frame.style].filter(p => p.startsWith('--w-')).forEach(p => frame.style.removeProperty(p)); Object.entries(s.vars).forEach(([k, v]) => frame.style.setProperty(k, v)); };
    paint();
    const ctx = {
      id: widget.id, def, el: frame, body, widget, get config() { return widget.config; }, stacked: false, editing: false,
      width: 0, height: 0, size: 'l', hsize: 'tall', shape: 'square', tier: 'expanded', cw: 0, ch: 0,
      setConfig(patch) { Object.assign(widget.config, typeof patch === 'function' ? patch(widget.config) : patch); api.update && api.update({ config: true }); if (opts.onConfig) opts.onConfig(widget.config); },
      setActions() {}, setTitle() {}, on(evt, fn) { subs.push(SS.bus.on(evt, fn)); }, openSettings() {},
      render(build) { const out = build(); if (out instanceof Node) body.replaceChildren(out); else if (Array.isArray(out)) body.replaceChildren(...out.filter(Boolean)); }
    };
    const measure = () => { const r = frame.getBoundingClientRect(); const cs = getComputedStyle(body); ctx.width = r.width; ctx.height = r.height; ctx.cw = Math.max(0, body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); ctx.ch = Math.max(0, body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)); const sh = SS.layout.shapeOf(ctx.cw, ctx.ch, false); ctx.shape = sh.shape; ctx.tier = sh.tier; ctx.size = r.width < 230 ? 'xs' : r.width < 330 ? 's' : r.width < 470 ? 'm' : r.width < 680 ? 'l' : 'xl'; };
    measure();
    let api = {};
    try { api = def.mount(ctx) || {}; } catch (err) { console.error('[Tester] embedded widget failed', err); body.replaceChildren(SS.ui.empty('alert', 'This hit a problem', 'Try reloading the page.')); }
    (def.data || []).forEach(evt => subs.push(SS.bus.on(evt, payload => { try { api.update && api.update(payload); } catch (err) { console.error(err); } })));
    subs.push(SS.bus.on('theme-applied', paint), SS.bus.on('ws:switch', paint), SS.bus.on('style', paint));
    let key = '';
    const ro = new ResizeObserver(U.raf(() => { measure(); const k2 = `${ctx.shape}|${ctx.tier}|${Math.round(ctx.cw / 40)}|${Math.round(ctx.ch / 40)}`; if (k2 !== key) { key = k2; try { api.resize ? api.resize(ctx) : api.update && api.update({ resize: true }); } catch (err) { console.error(err); } } }));
    ro.observe(frame);
    return { el: frame, destroy() { ro.disconnect(); subs.forEach(o => o()); try { api.unmount && api.unmount(); } catch (_) { /* gone */ } frame.remove(); } };
  };

  /* ================================================================
     Welcome: a polished default, three styles to choose from, and a choice of how to start
     ================================================================ */
  const oldWelcome = SS.panels.welcome;
  SS.panels.welcome = (fromMenu = false) => {
    const migrated = !!SS.meta?.migratedFrom && !SS.prefs.get('upgradeSeen');
    if (migrated || fromMenu) return oldWelcome(fromMenu);
    let start = 'fresh';
    let styleId = PL.currentStyleId() || 'calm';
    const ws = SS.ws.active();
    const dlg = SS.ui.dialog({ title: 'Welcome to Tester', subtitle: 'Your personal study desk. Make it yours in under a minute — you can change everything later.', size: 'lg', class: 'dlg-welcome dlg-onboard', dismissable: true, focus: '.dlg-foot .btn-primary',
      onClose: () => { SS.prefs.set('onboarded', true); } });
    const name = SS.ui.input({ value: SS.prefs.get('name'), placeholder: 'Your first name (optional)', label: 'Your name', maxLength: 30 });
    const grid = PL.styleGrid({ styles: PL.styles().filter(s => s.curated), value: styleId, size: 'lg', onPick: id => { styleId = id; PL.applyStyle(id, ws, { undo: false }); } });
    const startCards = el('div.ob-start', { role: 'radiogroup', aria: { label: 'How do you want to start?' } });
    const opt = (id, icon, title, text) => {
      const b = el('button.ob-opt', { type: 'button', role: 'radio', aria: { checked: String(id === start) }, dataset: { start: id } }, el('span.ob-ic', SS.icon(icon, 20)), el('span.ob-t', el('b', { text: title }), el('small', { text })));
      b.addEventListener('click', () => { start = id; startCards.querySelectorAll('.ob-opt').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
      return b;
    };
    startCards.append(opt('fresh', 'sparkles', 'Start fresh', 'A clean Today page. Add your first class or assignment when you’re ready.'), opt('examples', 'layers', 'Try with examples', 'Sample classes, deadlines and notes, clearly labelled. Remove them in one click.'));
    dlg.body.append(
      SS.ui.field('What should we call you?', name),
      el('div.field', el('div.field-label', { text: 'Pick a style' }), grid, el('p.hint', { text: 'More styles, colours and wallpapers live in Customize → Style.' })),
      el('div.field', el('div.field-label', { text: 'How do you want to start?' }), startCards));
    dlg.foot.append(el('button.btn.btn-primary.ob-go', { type: 'button', on: { click: () => {
      SS.prefs.set('name', name.value.trim());
      if (start === 'examples' && !DEMO.active()) { DEMO.seed(); SS.ui.toast('Examples added — they’re labelled “Example”. Remove them any time from Today.', { icon: 'layers', timeout: 5200 }); }
      dlg.close();
      SS.bus.emit('day');
    } } }, 'Open my desk', SS.icon('chevR', 15)));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); dlg.foot.querySelector('.btn-primary').click(); } });
  };

  /* ================================================================
     Quick add knows which class page it was opened from
     ================================================================ */
  SS.bus.on('view', () => SS.bus.emit('dash:subject', PL.currentSubject()));
})(window.SS);
