/* Tester — the sidebar: profile, the destinations the student arranges (Home, Study and their own tabs),
   pinned class pages, and switching between the dashboard and the Study view (id "quiz" for compatibility). Tabs are SS.ws "pages": each owns its widgets
   and layout, while notes, sets, assignments and other content stay shared by everything. */
(function (SS) {
  'use strict';
  const U = SS.util;
  const { el } = U;
  const W = SS.ws;
  const TAB_ICONS = ['note', 'book', 'notebook', 'cards', 'cap', 'calendar', 'checklist', 'target', 'star', 'flag', 'folder', 'timer', 'chart', 'sparkles', 'flame', 'leaf', 'coffee', 'music', 'bell', 'pin', 'zap', 'layers', 'palette', 'home', 'image', 'link', 'table', 'calc'];
  const WIDTH = { min: 200, max: 380, def: 248 };
  const isPhone = () => matchMedia('(max-width: 700px)').matches;

  let side = null, list = null, classList = null, classSection = null, quizHost = null;
  const isClass = it => it.kind === 'page' && !!it.subjectId && !!SS.data.subject(it.subjectId);
  let drag = null;

  const prefs = () => ({ width: WIDTH.def, collapsed: false, ...(SS.prefs.get('sidebar') || {}) });
  const setPrefs = patch => SS.prefs.set('sidebar', { ...prefs(), ...patch });
  const iconOf = (icon, size = 18) => (SS.icon.names.includes(icon) ? SS.icon(icon, size) : el('span.nav-emoji', { text: icon || '•', attrs: { 'aria-hidden': 'true' } }));

  const N = SS.nav = {
    TAB_ICONS,
    init() {
      quizHost = document.getElementById('quizView');
      side = el('aside.nav-side', { id: 'sidebar', aria: { label: 'Sidebar' } });
      document.body.prepend(side);
      document.body.append(el('div.nav-scrim', { on: { click: () => N.drawer(false) }, aria: { hidden: 'true' } }));
      build();
      applyPrefs();
      SS.bus.on('nav', drawList);
      SS.bus.on('ws:list', drawList);
      SS.bus.on('play', e => { if (!e || ['answer', 'spend', 'game', 'profile', 'settings', 'load'].includes(e.type)) { drawBadges(); if (e && e.type === 'profile') drawProfile(); } });
      SS.bus.on('prefs', ({ key }) => { if (key === 'sidebar' || key === 'all') { applyPrefs(); drawProfile(); } if (key === 'name' || key === 'all') drawProfile(); });
      SS.bus.on('data:subjects', drawList);
      SS.bus.on('view', ({ view, focus, force }) => { if (force && view === 'quiz' && SS.quiz.mounted()) SS.quiz.unmount(); show(view, focus); drawList(); });
      matchMedia('(max-width: 700px)').addEventListener?.('change', () => { N.drawer(false); applyPrefs(); });
      addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('nav-drawer-open')) N.drawer(false); });
      document.getElementById('topbar')?.prepend(N.menuButton());
      show(W.view(), false, true);
    },
    go(id, opts = {}) {
      if (isPhone()) N.drawer(false);
      if (W.view() === id) { if (opts.focus !== false) show(id, true, true); return; }
      W.setView(id, { focus: opts.focus !== false });
    },
    drawer(open) {
      document.body.classList.toggle('nav-drawer-open', !!open);
      const btn = document.getElementById('navMenuBtn'); if (btn) btn.setAttribute('aria-expanded', String(!!open));
      if (open) requestAnimationFrame(() => side.querySelector('.nav-item[aria-current="page"]')?.focus());
    },
    addTab,
    addClass: () => tabDialog(null, { template: 'class' }),
    menuButton: () => el('button.top-btn.icon-only.nav-menu-btn', { id: 'navMenuBtn', type: 'button', title: 'Open the sidebar', aria: { label: 'Open the sidebar', expanded: 'false', controls: 'sidebar' }, on: { click: () => N.drawer(!document.body.classList.contains('nav-drawer-open')) } }, SS.icon('list', 18))
  };

  /* ---------------- Switching views ---------------- */
  /* `keep`: don't re-render what's already on screen (startup renders once itself; re-selecting the open tab only moves focus) */
  function show(view, focus, keep) {
    const quiz = view === 'quiz';
    document.documentElement.dataset.view = quiz ? 'quiz' : W.isPage(W.page(view)) ? 'page' : 'home';
    if (quiz) {
      SS.dash.setActive(false);
      quizHost.hidden = false;
      if (!SS.quiz.mounted()) SS.quiz.mount(quizHost);
    } else {
      if (SS.quiz.mounted()) SS.quiz.unmount();
      quizHost.hidden = true;
      const wasActive = SS.dash.active;
      SS.dash.setActive(true);
      if (!keep || !wasActive) SS.dash.render();
    }
    const skip = document.querySelector('.skip-link'); if (skip) skip.href = quiz ? '#quizView' : '#dash';
    const item = W.navItems().find(x => x.id === view);
    document.title = item && view !== 'home' ? `${item.name} · ${SS.prefs.get('brand') || 'Tester'}` : (SS.prefs.get('brand') || 'Tester');
    SS.bus.emit('view-shown', { view });
    // move focus to the new view and start it at the top (focusing alone would tuck it under the sticky top bar)
    if (focus) requestAnimationFrame(() => { (quiz ? quizHost.querySelector('h1') || quizHost : document.getElementById('dash')).focus({ preventScroll: true }); if (!keep) scrollTo({ top: 0, behavior: 'instant' }); });
  }

  /* ---------------- Building the sidebar ---------------- */
  function build() {
    const inner = el('div.nav-inner');
    const profile = el('div.nav-profile');
    list = el('ul.nav-list', { role: 'list', aria: { label: 'Destinations' } });
    classList = el('ul.nav-list.nav-classes', { role: 'list', aria: { label: 'Classes' } });
    classSection = el('div.nav-class-wrap',
      el('div.nav-section', el('span', { id: 'navClassesLabel', text: 'Classes' }), el('button', { type: 'button', title: 'Pin a class page', aria: { label: 'Pin a class page' }, on: { click: () => N.addClass() } }, SS.icon('plus', 14))),
      classList);
    const add = el('button.nav-add', { type: 'button', on: { click: () => addTab() } }, SS.icon('plus', 16), el('span', { text: 'Add tab' }));
    const foot = el('div.nav-foot',
      el('button.nav-item.nav-plain', { type: 'button', on: { click: () => { if (isPhone()) N.drawer(false); SS.panels.customize('general'); } } }, SS.icon('settings', 18), el('span.nav-label', { text: 'Settings' })),
      el('small.nav-saved', { text: 'Saved privately in this browser' }));
    inner.append(profile, el('nav.nav-main', { aria: { label: 'Main' } }, list, classSection, add), foot);
    const collapse = el('button.nav-collapse', { type: 'button', on: { click: () => setPrefs({ collapsed: !prefs().collapsed }) } });
    const resize = el('div.nav-resize', { role: 'separator', tabIndex: 0, aria: { label: 'Resize sidebar', orientation: 'vertical', valuemin: WIDTH.min, valuemax: WIDTH.max } });
    side.append(inner, collapse, resize);
    bindResize(resize);
    drawProfile(); drawList();
  }
  function drawProfile() {
    const box = side?.querySelector('.nav-profile'); if (!box) return;
    const p = SS.play.profile();
    const compact = (SS.prefs.get('sidebar') || {}).profile !== 'banner';
    box.classList.toggle('compact', compact);
    box.replaceChildren(
      el('div.nav-banner', { style: { background: SS.play.bannerCSS() } }),
      el('button.nav-avatar', { type: 'button', title: 'Edit your profile', aria: { label: 'Edit your profile' }, on: { click: () => SS.play.editProfile() } }, SS.play.avatar(compact ? 40 : 64)),
      el('div.nav-who', el('b', { text: p.name || SS.prefs.get('name') || 'Your Tester' }), p.bio ? el('span', { text: p.bio }) : null));
  }
  function drawBadges() {
    const b = side?.querySelector('.nav-row[data-id="quiz"] .nav-badge'); if (!b) return;
    const n = SS.play.actions();
    b.hidden = !n; b.textContent = String(n);
    b.title = `${U.plural(n, 'move')} available in ${SS.play.title(SS.play.game())}`;
    b.setAttribute('aria-label', b.title);
  }
  function drawList() {
    if (!list) return;
    const active = W.view();
    const items = W.navItems();
    const focused = document.activeElement && side.contains(document.activeElement) ? document.activeElement.closest('.nav-row')?.dataset.id : null;
    const main = items.filter(it => !isClass(it)), classes = items.filter(isClass);
    const rowFor = (it, i, group) => {
      const row = el('li.nav-row', { dataset: { id: it.id, kind: isClass(it) ? 'class' : it.kind } });
      const s = isClass(it) ? SS.data.subject(it.subjectId) : null;
      const label = it.kind === 'home' ? `Home · ${W.active().name}` : it.name;
      const btn = el('button.nav-item', { type: 'button', title: label, aria: { current: it.id === active ? 'page' : null, label: s ? `${it.name}, class page` : it.kind === 'page' ? `${it.name}, custom tab` : null },
        on: { click: () => N.go(it.id), keydown: e => onItemKey(e, it, i, group) } },
        el('span.nav-grip', { title: 'Drag to reorder', aria: { hidden: 'true' } }, SS.icon('grip', 14)),
        s ? el('span.nav-class-ic', { style: { '--sc': s.color } }, SS.planner.classIcon({ ...s, icon: it.icon && it.icon !== 'cap' ? it.icon : s.icon }, 14)) : iconOf(it.icon), el('span.nav-label', { text: it.kind === 'home' ? 'Home' : it.name }),
        it.kind === 'quiz' ? el('span.nav-badge', { hidden: true }) : null,
        it.kind === 'quiz' ? el('span.nav-lock', { title: 'Built in — can be moved but not deleted' }, SS.icon('lock', 12)) : null);
      const more = el('button.icon-btn.xs.nav-more', { type: 'button', title: 'Tab options', aria: { label: `Options for ${it.kind === 'home' ? 'Home' : it.name}`, haspopup: 'menu' }, on: { click: e => itemMenu(it, i, e.currentTarget, null, group) } }, SS.icon('more', 15));
      row.append(btn, more);
      btn.addEventListener('contextmenu', e => { e.preventDefault(); itemMenu(it, i, null, e, group); });
      btn.addEventListener('pointerdown', e => beginDrag(e, row));
      return row;
    };
    list.replaceChildren(...main.map((it, i) => rowFor(it, i, main)));
    classList.replaceChildren(...classes.map((it, i) => rowFor(it, i, classes)));
    if (!classes.length) classList.append(el('li', el('button.nav-classes-empty', { type: 'button', on: { click: () => N.addClass() } }, 'Pin a class to give it its own page')));
    if (focused) side.querySelector(`.nav-row[data-id="${CSS.escape(focused)}"] .nav-item`)?.focus({ preventScroll: true });
    drawBadges();
  }

  /* ---------------- Tab actions ---------------- */
  const groupOf = it => (isClass(it) ? W.navItems().filter(isClass) : W.navItems().filter(x => !isClass(x)));
  function itemMenu(it, i, anchor, e, group) {
    group = group || groupOf(it);
    const n = group.length;
    const page = it.kind === 'page';
    const cls = isClass(it);
    SS.ui.menu([
      { heading: it.kind === 'home' ? 'Home' : it.name },
      cls && { label: 'Customize class…', icon: 'palette', onClick: () => SS.planner.editClass(it.subjectId) },
      page && { label: 'Rename…', icon: 'edit', onClick: () => renameTab(it.id) },
      page && !cls && { label: 'Change icon…', icon: 'sparkles', onClick: () => tabDialog(it.id) },
      { label: 'Move up', icon: 'arrowUp', kbd: 'Alt+↑', disabled: i === 0, onClick: () => move(it.id, -1) },
      { label: 'Move down', icon: 'arrowDown', kbd: 'Alt+↓', disabled: i === n - 1, onClick: () => move(it.id, 1) },
      page && !cls && { label: 'Duplicate tab', icon: 'copy', onClick: () => duplicateTab(it.id) },
      page && { label: 'Layout presets…', icon: 'layout', onClick: () => { N.go(it.id, { focus: false }); setTimeout(() => SS.panels.templates(), 60); } },
      it.kind === 'home' && { label: 'Switch workspace…', icon: 'layers', onClick: () => SS.panels.customize('themes') },
      page && '-',
      page && { label: cls ? 'Unpin class page…' : 'Delete tab…', icon: cls ? 'pin' : 'trash', danger: true, onClick: () => deleteTab(it.id) },
      !page && { label: it.kind === 'quiz' ? 'Study is built in and can’t be deleted' : 'Home is built in and can’t be deleted', icon: 'lock', disabled: true }
    ], anchor ? { anchor, label: 'Tab options', align: 'left' } : { x: e.clientX, y: e.clientY, label: 'Tab options' });
  }
  /* Move within its group (destinations or classes); the saved order is main group then classes */
  function move(id, dir) {
    const items = W.navItems(); const it = items.find(x => x.id === id); if (!it) return;
    const group = groupOf(it).map(x => x.id); const i = group.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    const other = items.filter(x => isClass(x) !== isClass(it)).map(x => x.id);
    W.setOrder(isClass(it) ? [...other, ...group] : [...group, ...other]);
    SS.ui.announce(`Moved to position ${j + 1} of ${group.length}.`);
    requestAnimationFrame(() => side.querySelector(`.nav-row[data-id="${CSS.escape(id)}"] .nav-item`)?.focus());
  }
  function onItemKey(e, it) {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(it.id, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const btns = [...side.querySelectorAll('.nav-row .nav-item')]; const i = btns.indexOf(e.currentTarget);
      btns[(i + (e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length]?.focus();
    } else if (e.key === 'F2' && it.kind === 'page') { e.preventDefault(); renameTab(it.id); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && it.kind === 'page') { e.preventDefault(); deleteTab(it.id); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); itemMenu(it, groupOf(it).findIndex(x => x.id === it.id), e.currentTarget.parentElement.querySelector('.nav-more')); }
  }
  async function renameTab(id) {
    const p = W.page(id); if (!p) return;
    const name = await SS.ui.prompt({ title: 'Rename tab', value: p.name, maxLength: 40, ok: 'Rename' });
    if (name) W.renamePage(id, name);
  }
  async function deleteTab(id) {
    const p = W.page(id); if (!p) return;
    const cls = !!(p.subjectId && SS.data.subject(p.subjectId));
    const ok = await SS.ui.confirm(cls
      ? { title: `Unpin the “${p.name}” class page?`, message: `The page and its layout are removed from your sidebar. The class, its assignments, notes and study sets stay saved — pin it again any time from the subject. You can undo right after.`, ok: 'Unpin', danger: false }
      : { title: `Delete the “${p.name}” tab?`, message: `Its ${U.plural(p.widgets.length, 'widget')} and layout are removed. Notes, study sets, assignments and other content are shared and stay saved. You can undo right after.`, ok: 'Delete tab' });
    if (ok) W.removePage(id);
  }
  function duplicateTab(id) {
    const src = W.page(id); if (!src) return;
    const copy = W.createPage({ name: `${src.name} copy`.slice(0, 40), icon: src.icon, after: id });
    if (!copy) return;
    copy.layout = U.clone(src.layout); copy.layout.mobileOrder = null;
    copy.widgets = U.clone(src.widgets).map(w => ({ ...w, id: U.uid('w') }));
    W.save(); SS.bus.emit('nav');
    SS.ui.toast(`Duplicated as “${copy.name}”`, { kind: 'success', action: { label: 'Open', fn: () => N.go(copy.id) } });
  }
  function addTab(opts) { tabDialog(null, opts); }

  /* Create a tab from a page template (Class, Weekly Planner, Exam Prep or Blank page), or change an
     existing tab's name and icon */
  const PAGE_TEMPLATES = () => [...SS.presets.TEMPLATES.filter(t => t.pages), { id: '', name: 'Blank page', icon: 'note', description: 'An empty page. Add only the widgets you want.' }];
  function tabDialog(id, opts = {}) {
    const page = id ? W.page(id) : null;
    let icon = page ? page.icon : 'note';
    let template = page ? null : (opts.template != null ? opts.template : '');
    let subjectId = '', iconTouched = false, nameTouched = false;
    const d = SS.ui.dialog({ eyebrow: page ? 'Edit tab' : 'New tab', title: page ? `“${page.name}”` : 'Add a tab', subtitle: page ? null : 'Start from a page template or a blank page. Each tab keeps its own widgets and layout.', size: page ? 'sm' : 'md', class: 'dlg-addtab' });
    const name = SS.ui.input({ value: page ? page.name : '', placeholder: 'e.g. Exam week, Reading, Chemistry', label: 'Tab name', maxLength: 40 });
    name.addEventListener('input', () => { nameTouched = true; });
    const grid = el('div.nav-icon-grid', { role: 'radiogroup', aria: { label: 'Icon' } });
    const emoji = SS.ui.input({ value: SS.icon.names.includes(icon) ? '' : icon, placeholder: 'or type an emoji', label: 'Emoji icon', maxLength: 8 });
    const paint = () => grid.querySelectorAll('button').forEach(b => { const on = b.dataset.icon === icon; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on || (!TAB_ICONS.includes(icon) && b === grid.firstElementChild) ? 0 : -1; });
    TAB_ICONS.forEach(name2 => grid.append(el('button.nav-icon-pick', { type: 'button', role: 'radio', dataset: { icon: name2 }, aria: { label: name2 }, title: name2, on: { click: () => { icon = name2; iconTouched = true; emoji.value = ''; paint(); } } }, SS.icon(name2, 18))));
    grid.addEventListener('keydown', e => {
      const btns = [...grid.querySelectorAll('button')]; const i = btns.indexOf(document.activeElement); if (i < 0) return;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key]; if (!step) return;
      e.preventDefault(); const b = btns[(i + step + btns.length) % btns.length]; b.focus(); b.click();
    });
    emoji.addEventListener('input', () => { const v = emoji.value.trim(); if (v) { icon = [...v].slice(0, 2).join(''); iconTouched = true; paint(); } });
    paint();
    // Class: pick a subject (or make one); the page, its widgets and anything added there use it
    const subjBox = el('div.field.tab-subject-field', { hidden: true });
    const drawSubjects = () => {
      const subs = SS.data.all('subjects').filter(x => !W.classPage(x.id));
      if (!subjectId || !subs.some(x => x.id === subjectId)) subjectId = subs[0] ? subs[0].id : '';
      const newName = SS.ui.input({ placeholder: 'New class name, e.g. Chemistry', label: 'New class name', maxLength: 80 });
      const sel = subs.length ? SS.ui.select({ label: 'Class', value: subjectId, options: [...subs.map(x => ({ value: x.id, label: x.name })), { value: '__new', label: '+ A new class…' }], onChange: v => { subjectId = v === '__new' ? '' : v; newName.hidden = v !== '__new'; if (v === '__new') newName.focus(); syncName(); } }) : null;
      newName.hidden = !!subs.length;
      newName.addEventListener('input', syncName);
      subjBox._newName = newName;
      subjBox.replaceChildren(el('div.field-label', { text: 'Which class?' }), el('div.tab-subject', sel, null), newName, el('p.hint', { text: subs.length ? 'Its assignments, exams, notes and study sets appear on the page. Anything you add there is tagged with it.' : 'Type the class name. Its colour and icon can be changed later.' }));
    };
    function syncName() {
      if (template !== 'class') return;
      const s = SS.data.subject(subjectId);
      if (!nameTouched) name.value = s ? s.name : (subjBox._newName ? subjBox._newName.value : '');
      if (!iconTouched) { icon = s && s.icon ? s.icon : 'cap'; paint(); }
    }
    const iconField = el('div.field', el('div.field-label', { text: 'Icon' }), grid, emoji);
    const tplWrap = el('div.tab-tpls', { role: 'radiogroup', aria: { label: 'Page template' } });
    const tplCards = page ? [] : PAGE_TEMPLATES().map(t => {
      const b = el('button.tab-tpl', { type: 'button', role: 'radio', aria: { checked: String(t.id === template) }, dataset: { tpl: t.id } },
        t.id ? SS.panels.layoutThumb(t.widgets) : el('div.tab-tpl-blank', SS.icon('plus', 20)),
        el('b', SS.icon(t.icon, 14), el('span', { text: t.name })), el('small', { text: t.description }));
      b.addEventListener('click', () => pickTemplate(t.id));
      return b;
    });
    tplWrap.append(...tplCards);
    function pickTemplate(t) {
      template = t;
      tplCards.forEach(b => b.setAttribute('aria-checked', String(b.dataset.tpl === t)));
      subjBox.hidden = t !== 'class';
      iconField.hidden = t === 'class';   // a class page uses its class's icon (Customize class changes it)
      if (t === 'class') { drawSubjects(); syncName(); }
      else if (!iconTouched) { icon = t === 'planner' ? 'calendar' : t === 'exam' ? 'target' : 'note'; paint(); }
    }
    const submit = () => {
      let nm = name.value.trim();
      if (!page && template === 'class' && !subjectId) {
        const typed = (subjBox._newName && subjBox._newName.value.trim()) || nm;
        if (!typed) { (subjBox._newName || name).focus(); return; }
        subjectId = SS.data.ensureSubject(typed);
        if (!nm) nm = typed;
      }
      if (!nm) { name.focus(); name.classList.add('shake'); setTimeout(() => name.classList.remove('shake'), 400); return; }
      if (page) { W.renamePage(page.id, nm); W.setPageIcon(page.id, icon); d.close(); return; }
      const created = W.createPage({ name: nm, icon, template: template || '', subjectId: template === 'class' ? subjectId : '', after: W.page(W.view()) && !W.page(W.view()).subjectId ? W.view() : null });
      d.close();
      if (created) { N.go(created.id); SS.ui.toast(template === 'class' ? `“${created.name}” class page pinned` : `“${created.name}” added`, { kind: 'success', timeout: 2400 }); }
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    if (!page) d.body.append(el('div.field', el('div.field-label', { text: 'Start from' }), tplWrap), subjBox);
    d.body.append(SS.ui.field('Name', name), iconField);
    d.foot.append(el('button.btn', { type: 'button', text: 'Cancel', on: { click: () => d.close() } }), el('button.btn.btn-primary', { type: 'button', text: page ? 'Save' : 'Create tab', on: { click: submit } }));
    if (!page) pickTemplate(template);
    requestAnimationFrame(() => (template === 'class' && subjBox._newName && !subjBox._newName.hidden ? subjBox._newName : name).focus());
  }

  /* ---------------- Drag to reorder (keyboard: Alt + ↑/↓ or the ⋯ menu) ---------------- */
  function beginDrag(e, row) {
    if (e.button !== 0 || prefs().collapsed && !isPhone()) return;
    const list = row.parentElement;
    const startY = e.clientY;
    drag = { row, id: row.dataset.id, startY, started: false, pointerId: e.pointerId };
    const moveFn = ev => {
      if (!drag) return;
      if (!drag.started) {
        if (Math.abs(ev.clientY - startY) < 6) return;
        drag.started = true; row.classList.add('dragging'); list.classList.add('reordering');
        try { row.setPointerCapture(drag.pointerId); } catch (_) { /* fine */ }
      }
      ev.preventDefault();
      const rows = [...list.children].filter(r => r !== row);
      const before = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      if (before) list.insertBefore(row, before); else list.append(row);
    };
    const up = () => {
      removeEventListener('pointermove', moveFn); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const d = drag; drag = null;
      if (!d || !d.started) return;
      row.classList.remove('dragging'); list.classList.remove('reordering');
      // swallow the click that follows a drag
      row.querySelector('.nav-item').addEventListener('click', ev => { ev.stopImmediatePropagation(); ev.preventDefault(); }, { capture: true, once: true });
      const mine = [...list.children].map(r => r.dataset.id).filter(Boolean);
      const mainIds = [...side.querySelectorAll('.nav-list:not(.nav-classes) > .nav-row')].map(r => r.dataset.id);
      const classIds = [...side.querySelectorAll('.nav-classes > .nav-row')].map(r => r.dataset.id);
      W.setOrder([...mainIds, ...classIds]);
      SS.ui.announce(`Moved to position ${mine.indexOf(d.id) + 1} of ${mine.length}.`);
    };
    addEventListener('pointermove', moveFn); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  /* ---------------- Width & collapse ---------------- */
  function applyPrefs() {
    const p = prefs();
    const width = U.clampNum(p.width, WIDTH.min, WIDTH.max, WIDTH.def);
    document.documentElement.style.setProperty('--nav-w', `${width}px`);
    document.body.classList.add('has-nav');
    document.body.classList.toggle('nav-collapsed', !!p.collapsed && !isPhone());
    const c = side.querySelector('.nav-collapse');
    c.replaceChildren(SS.icon(p.collapsed ? 'chevR' : 'chevL', 16));
    c.setAttribute('aria-label', p.collapsed ? 'Expand the sidebar' : 'Collapse the sidebar');
    c.setAttribute('aria-expanded', String(!p.collapsed)); c.title = c.getAttribute('aria-label');
    side.querySelector('.nav-resize').setAttribute('aria-valuenow', String(width));
    requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  }
  function bindResize(handle) {
    let startX = 0, startW = 0, live = 0;
    handle.addEventListener('pointerdown', e => { if (e.button !== 0) return; startX = e.clientX; startW = prefs().width; live = startW; handle.setPointerCapture(e.pointerId); document.body.classList.add('nav-resizing'); });
    handle.addEventListener('pointermove', e => { if (!handle.hasPointerCapture(e.pointerId)) return; live = U.clamp(Math.round(startW + e.clientX - startX), WIDTH.min, WIDTH.max); document.documentElement.style.setProperty('--nav-w', `${live}px`); handle.setAttribute('aria-valuenow', String(live)); });
    const end = e => { if (!handle.hasPointerCapture(e.pointerId)) return; handle.releasePointerCapture(e.pointerId); document.body.classList.remove('nav-resizing'); if (live && live !== startW) setPrefs({ width: live }); };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    handle.addEventListener('keydown', e => {
      const w = prefs().width;
      const next = { ArrowLeft: w - 12, ArrowRight: w + 12, Home: WIDTH.min, End: WIDTH.max }[e.key];
      if (next == null) return;
      e.preventDefault(); setPrefs({ width: U.clamp(next, WIDTH.min, WIDTH.max) });
    });
    handle.addEventListener('dblclick', () => setPrefs({ width: WIDTH.def }));
  }
})(window.SS);
