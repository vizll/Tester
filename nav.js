/* Tester — the sidebar: profile, the destinations the student arranges (Home, Quiz and their own tabs)
   and switching between the dashboard and the Quiz view. Tabs are SS.ws "pages": each owns its widgets
   and layout, while notes, sets, assignments and other content stay shared by everything. */
(function (SS) {
  'use strict';
  const U = SS.util;
  const { el } = U;
  const W = SS.ws;
  const TAB_ICONS = ['note', 'book', 'notebook', 'cards', 'cap', 'calendar', 'checklist', 'target', 'star', 'flag', 'folder', 'timer', 'chart', 'sparkles', 'flame', 'leaf', 'coffee', 'music', 'bell', 'pin', 'zap', 'layers', 'palette', 'home', 'image', 'link', 'table', 'calc'];
  const WIDTH = { min: 200, max: 380, def: 248 };
  const isPhone = () => matchMedia('(max-width: 700px)').matches;

  let side = null, list = null, quizHost = null;
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
      SS.bus.on('prefs', ({ key }) => { if (key === 'sidebar' || key === 'all') applyPrefs(); if (key === 'name' || key === 'all') drawProfile(); });
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
    if (focus) requestAnimationFrame(() => (quiz ? quizHost.querySelector('h1') || quizHost : document.getElementById('dash')).focus({ preventScroll: false }));
  }

  /* ---------------- Building the sidebar ---------------- */
  function build() {
    const inner = el('div.nav-inner');
    const profile = el('div.nav-profile');
    list = el('ul.nav-list', { role: 'list', aria: { label: 'Destinations' } });
    const add = el('button.nav-add', { type: 'button', on: { click: () => addTab() } }, SS.icon('plus', 16), el('span', { text: 'Add tab' }));
    const foot = el('div.nav-foot',
      el('button.nav-item.nav-plain', { type: 'button', on: { click: () => { if (isPhone()) N.drawer(false); SS.panels.customize('general'); } } }, SS.icon('settings', 18), el('span.nav-label', { text: 'Settings' })),
      el('small.nav-saved', { text: 'Saved privately in this browser' }));
    inner.append(profile, el('nav.nav-main', { aria: { label: 'Main' } }, list, add), foot);
    const collapse = el('button.nav-collapse', { type: 'button', on: { click: () => setPrefs({ collapsed: !prefs().collapsed }) } });
    const resize = el('div.nav-resize', { role: 'separator', tabIndex: 0, aria: { label: 'Resize sidebar', orientation: 'vertical', valuemin: WIDTH.min, valuemax: WIDTH.max } });
    side.append(inner, collapse, resize);
    bindResize(resize);
    drawProfile(); drawList();
  }
  function drawProfile() {
    const box = side?.querySelector('.nav-profile'); if (!box) return;
    const p = SS.play.profile();
    box.replaceChildren(
      el('div.nav-banner', { style: { background: SS.play.bannerCSS() } }),
      el('button.nav-avatar', { type: 'button', title: 'Edit your profile', aria: { label: 'Edit your profile' }, on: { click: () => SS.play.editProfile() } }, SS.play.avatar(64)),
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
    const focused = document.activeElement && list.contains(document.activeElement) ? document.activeElement.closest('.nav-row')?.dataset.id : null;
    list.replaceChildren(...items.map((it, i) => {
      const row = el('li.nav-row', { dataset: { id: it.id, kind: it.kind } });
      const label = it.kind === 'home' ? `Home · ${W.active().name}` : it.name;
      const btn = el('button.nav-item', { type: 'button', title: label, aria: { current: it.id === active ? 'page' : null, label: it.kind === 'page' ? `${it.name}, custom tab` : null },
        on: { click: () => N.go(it.id), keydown: e => onItemKey(e, it, i) } },
        el('span.nav-grip', { title: 'Drag to reorder', aria: { hidden: 'true' } }, SS.icon('grip', 14)),
        iconOf(it.icon), el('span.nav-label', { text: it.kind === 'home' ? 'Home' : it.name }),
        it.kind === 'quiz' ? el('span.nav-badge', { hidden: true }) : null,
        it.kind === 'quiz' ? el('span.nav-lock', { title: 'Built in — can be moved but not deleted' }, SS.icon('lock', 12)) : null);
      const more = el('button.icon-btn.xs.nav-more', { type: 'button', title: 'Tab options', aria: { label: `Options for ${it.kind === 'home' ? 'Home' : it.name}`, haspopup: 'menu' }, on: { click: e => itemMenu(it, i, e.currentTarget) } }, SS.icon('more', 15));
      row.append(btn, more);
      btn.addEventListener('contextmenu', e => { e.preventDefault(); itemMenu(it, i, null, e); });
      btn.addEventListener('pointerdown', e => beginDrag(e, row));
      return row;
    }));
    if (focused) list.querySelector(`.nav-row[data-id="${CSS.escape(focused)}"] .nav-item`)?.focus({ preventScroll: true });
    drawBadges();
  }

  /* ---------------- Tab actions ---------------- */
  function itemMenu(it, i, anchor, e) {
    const n = W.navItems().length;
    const page = it.kind === 'page';
    SS.ui.menu([
      { heading: it.kind === 'home' ? 'Home' : it.name },
      page && { label: 'Rename…', icon: 'edit', onClick: () => renameTab(it.id) },
      page && { label: 'Change icon…', icon: 'sparkles', onClick: () => tabDialog(it.id) },
      { label: 'Move up', icon: 'arrowUp', kbd: 'Alt+↑', disabled: i === 0, onClick: () => move(it.id, -1) },
      { label: 'Move down', icon: 'arrowDown', kbd: 'Alt+↓', disabled: i === n - 1, onClick: () => move(it.id, 1) },
      page && { label: 'Duplicate tab', icon: 'copy', onClick: () => duplicateTab(it.id) },
      it.kind === 'home' && { label: 'Switch theme…', icon: 'layers', onClick: () => SS.panels.customize('themes') },
      page && '-',
      page && { label: 'Delete tab…', icon: 'trash', danger: true, onClick: () => deleteTab(it.id) },
      !page && { label: it.kind === 'quiz' ? 'Quiz is built in and can’t be deleted' : 'Home is built in and can’t be deleted', icon: 'lock', disabled: true }
    ], anchor ? { anchor, label: 'Tab options', align: 'left' } : { x: e.clientX, y: e.clientY, label: 'Tab options' });
  }
  function move(id, dir) {
    if (!W.moveNav(id, dir)) return;
    const items = W.navItems(); const at = items.findIndex(x => x.id === id);
    SS.ui.announce(`Moved to position ${at + 1} of ${items.length}.`);
    requestAnimationFrame(() => list.querySelector(`.nav-row[data-id="${CSS.escape(id)}"] .nav-item`)?.focus());
  }
  function onItemKey(e, it) {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(it.id, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const btns = [...list.querySelectorAll('.nav-item')]; const i = btns.indexOf(e.currentTarget);
      btns[(i + (e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length]?.focus();
    } else if (e.key === 'F2' && it.kind === 'page') { e.preventDefault(); renameTab(it.id); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && it.kind === 'page') { e.preventDefault(); deleteTab(it.id); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); itemMenu(it, W.navItems().findIndex(x => x.id === it.id), e.currentTarget.parentElement.querySelector('.nav-more')); }
  }
  async function renameTab(id) {
    const p = W.page(id); if (!p) return;
    const name = await SS.ui.prompt({ title: 'Rename tab', value: p.name, maxLength: 40, ok: 'Rename' });
    if (name) W.renamePage(id, name);
  }
  async function deleteTab(id) {
    const p = W.page(id); if (!p) return;
    const ok = await SS.ui.confirm({ title: `Delete the “${p.name}” tab?`, message: `Its ${U.plural(p.widgets.length, 'widget')} and layout are removed. Notes, study sets, assignments and other content are shared and stay saved. You can undo right after.`, ok: 'Delete tab' });
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
  function addTab() { tabDialog(null); }

  /* Create a tab, or change an existing tab's name and icon */
  function tabDialog(id) {
    const page = id ? W.page(id) : null;
    let icon = page ? page.icon : 'note';
    const d = SS.ui.dialog({ eyebrow: page ? 'Edit tab' : 'New tab', title: page ? `“${page.name}”` : 'Add a tab', subtitle: page ? null : 'A new tab starts as an empty dashboard with its own widgets and layout.', size: 'sm' });
    const name = SS.ui.input({ value: page ? page.name : '', placeholder: 'e.g. Exam week, Reading, Chemistry', label: 'Tab name', maxLength: 40 });
    const grid = el('div.nav-icon-grid', { role: 'radiogroup', aria: { label: 'Icon' } });
    const emoji = SS.ui.input({ value: SS.icon.names.includes(icon) ? '' : icon, placeholder: 'or type an emoji', label: 'Emoji icon', maxLength: 8 });
    const paint = () => grid.querySelectorAll('button').forEach(b => { const on = b.dataset.icon === icon; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on || (!TAB_ICONS.includes(icon) && b === grid.firstElementChild) ? 0 : -1; });
    TAB_ICONS.forEach(name2 => grid.append(el('button.nav-icon-pick', { type: 'button', role: 'radio', dataset: { icon: name2 }, aria: { label: name2 }, title: name2, on: { click: () => { icon = name2; emoji.value = ''; paint(); } } }, SS.icon(name2, 18))));
    grid.addEventListener('keydown', e => {
      const btns = [...grid.querySelectorAll('button')]; const i = btns.indexOf(document.activeElement); if (i < 0) return;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key]; if (!step) return;
      e.preventDefault(); const b = btns[(i + step + btns.length) % btns.length]; b.focus(); b.click();
    });
    emoji.addEventListener('input', () => { const v = emoji.value.trim(); if (v) { icon = [...v].slice(0, 2).join(''); paint(); } });
    paint();
    const submit = () => {
      const nm = name.value.trim();
      if (!nm) { name.focus(); name.classList.add('shake'); setTimeout(() => name.classList.remove('shake'), 400); return; }
      if (page) { W.renamePage(page.id, nm); W.setPageIcon(page.id, icon); d.close(); return; }
      const created = W.createPage({ name: nm, icon, after: W.page(W.view()) ? W.view() : null });
      d.close();
      if (created) { N.go(created.id); SS.ui.toast(`“${created.name}” added`, { kind: 'success', timeout: 2400 }); }
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    d.body.append(SS.ui.field('Name', name), el('div.field', el('div.field-label', { text: 'Icon' }), grid, emoji));
    d.foot.append(el('button.btn', { type: 'button', text: 'Cancel', on: { click: () => d.close() } }), el('button.btn.btn-primary', { type: 'button', text: page ? 'Save' : 'Create tab', on: { click: submit } }));
    requestAnimationFrame(() => name.focus());
  }

  /* ---------------- Drag to reorder (keyboard: Alt + ↑/↓ or the ⋯ menu) ---------------- */
  function beginDrag(e, row) {
    if (e.button !== 0 || prefs().collapsed && !isPhone()) return;
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
      const order = [...list.children].map(r => r.dataset.id);
      W.setOrder(order);
      SS.ui.announce(`Moved to position ${order.indexOf(d.id) + 1} of ${order.length}.`);
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
