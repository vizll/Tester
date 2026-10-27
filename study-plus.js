/* Tester — study & play state. Correctly answered quiz questions unlock moves in the student's chosen
   game (by default 3 correct answers → 3 moves). This module owns that learning gate, the per-game
   boards and preferences, wins, and the profile shown in the sidebar. It is saved with everything
   else in the main store (key "play"); version 1 lived in localStorage ("studyspace-play-v1") together
   with a points economy that no longer exists, and is migrated once on startup. */
(function (SS) {
  'use strict';
  const U = SS.util;
  const { el } = U;
  const GAMES = ['chess', 'solitaire', '2048', 'tetris'];
  const VERSION = 2;
  const LEGACY_KEY = 'studyspace-play-v1';
  const MAX_COUNTED = 400;
  const counts = v => Object.fromEntries(GAMES.map(id => [id, Math.max(0, Math.min(1e6, Math.floor(Number(v && v[id]) || 0)))]));
  const QUIZ_MODES = ['mixed', 'choice', 'written', 'tf'];
  // only well-formed base64 images: these end up in CSS url("…") and <img src>
  const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

  /* Profile looks — every one is free to use (they used to be bought with points) */
  const BANNERS = {
    aurora: { name: 'Aurora', style: 'linear-gradient(135deg,#b8eee2,#b2ccff 52%,#e2bfff)' },
    sunset: { name: 'Sunset', style: 'linear-gradient(120deg,#ffcf71,#f49195,#9973d1)' },
    forest: { name: 'Moss & morning', style: 'linear-gradient(135deg,#142f30,#4b8464,#b9d18a)' },
    cosmos: { name: 'Cosmos', style: 'radial-gradient(ellipse at 20% 30%,#d198ff 0,transparent 45%),linear-gradient(135deg,#202144,#545ca8,#e38bbb)' },
    tide: { name: 'Deep tide', style: 'linear-gradient(120deg,#052e46,#147d92,#67d1cb)' }
  };
  const FRAMES = {
    simple: { name: 'Simple', color: '#ffffff' },
    mint: { name: 'Mint orbit', color: '#5dd9b3' },
    gold: { name: 'Golden scholar', color: '#e6b64c' },
    prism: { name: 'Prism', color: 'conic-gradient(#80e7dc,#8d9cff,#ef95d8,#ffd49d,#80e7dc)' }
  };

  const defaults = () => ({
    version: VERSION,
    game: 'chess',                         // the game newly earned moves go to
    actions: counts(),                     // moves available per game
    progress: 0,                           // correct answers toward the next grant
    settings: { need: 3, grant: 3 },       // correct answers needed → moves granted
    wins: counts(),
    stats: { correct: 0, answered: 0, sessions: 0, moves: counts() },
    counted: [],                           // keys of submitted questions that already counted
    quiz: { mode: 'mixed', direction: 'def', limit: 10, shuffle: true, strict: false },
    panel: { visible: true, ratio: 0.46, pane: 'quiz' },
    session: null,
    gameData: {},
    profile: { name: '', bio: 'One question at a time.', avatar: '', bannerImage: '', banner: 'aurora', frame: 'simple', simpleFrame: '#ffffff' }
  });

  const quizOptions = (raw = {}) => ({
    mode: QUIZ_MODES.includes(raw.mode) ? raw.mode : 'mixed',
    direction: raw.direction === 'term' ? 'term' : 'def',
    limit: U.clampNum(Math.floor(raw.limit), 1, 5000, 10),
    shuffle: raw.shuffle !== false,
    strict: raw.strict === true
  });

  /* Accepts version 1 (localStorage, with credits/points/shop fields) and version 2. Unknown and
     removed fields (points, lifetime, owned cosmetics, reward pop-up settings) are dropped. */
  function sanitize(raw) {
    const s = defaults();
    if (!U.isObj(raw)) return s;
    const v1 = !(Number(raw.version) >= 2);
    const set = U.isObj(raw.settings) ? raw.settings : {};
    s.settings.need = U.clampNum(Math.floor(v1 ? set.threshold : set.need), 1, 100, 3);
    s.settings.grant = U.clampNum(Math.floor(v1 ? set.turns : set.grant), 1, 100, 3);
    const oldQuiz = U.isObj(raw.quizOptions) ? raw.quizOptions : {};
    s.quiz = quizOptions(U.isObj(raw.quiz) ? raw.quiz : oldQuiz);
    s.game = GAMES.includes(raw.game) ? raw.game : GAMES.includes(oldQuiz.rewardGame) ? oldQuiz.rewardGame : 'chess';
    s.actions = counts(v1 ? raw.credits : raw.actions);
    s.wins = counts(raw.wins);
    if (v1) {
      // per-game progress becomes one shared counter: keep the selected game's (or the furthest) progress
      const p = counts(raw.progress);
      const pick = GAMES.includes(oldQuiz.rewardGame) ? p[oldQuiz.rewardGame] : Math.max(...GAMES.map(id => p[id]));
      s.progress = pick % s.settings.need;
      if (U.isObj(raw.profile)) s.stats.correct = Math.max(0, Math.floor(Number(raw.profile.correct) || 0));
    } else {
      s.progress = U.clampNum(Math.floor(raw.progress), 0, s.settings.need - 1, 0);
      const st = U.isObj(raw.stats) ? raw.stats : {};
      s.stats = { correct: U.clampNum(Math.floor(st.correct), 0, 1e9, 0), answered: U.clampNum(Math.floor(st.answered), 0, 1e9, 0), sessions: U.clampNum(Math.floor(st.sessions), 0, 1e9, 0), moves: counts(st.moves) };
      s.counted = (Array.isArray(raw.counted) ? raw.counted : []).filter(k => typeof k === 'string' && k.length < 120).slice(-MAX_COUNTED);
      const pn = U.isObj(raw.panel) ? raw.panel : {};
      s.panel = { visible: pn.visible !== false, ratio: U.clampNum(pn.ratio, 0.28, 0.72, 0.46), pane: pn.pane === 'game' ? 'game' : 'quiz' };
    }
    s.gameData = {};
    const gd = U.isObj(raw.gameData) ? raw.gameData : {};
    GAMES.forEach(id => {
      if (!U.isObj(gd[id])) return;
      const def = P.games.get(id);
      try { s.gameData[id] = def && def.sanitize ? def.sanitize(U.clone(gd[id])) : U.clone(gd[id]); } catch (_) { /* a damaged board starts fresh */ }
    });
    s.session = SS.quiz && SS.quiz.sanitizeSession ? SS.quiz.sanitizeSession(raw.session) : null;
    const pr = U.isObj(raw.profile) ? raw.profile : {};
    s.profile = {
      name: U.str(pr.name, 40), bio: typeof pr.bio === 'string' ? pr.bio.slice(0, 160) : s.profile.bio,
      avatar: IMAGE_RE.test(pr.avatar || '') ? pr.avatar : '', bannerImage: IMAGE_RE.test(pr.bannerImage || '') ? pr.bannerImage : '',
      banner: BANNERS[pr.banner] ? pr.banner : 'aurora', frame: FRAMES[pr.frame] ? pr.frame : 'simple',
      simpleFrame: U.hex(pr.simpleFrame, '#ffffff')
    };
    return s;
  }

  let state = defaults();
  const emit = detail => SS.bus.emit('play', detail || {});

  const P = SS.play = {
    GAMES, BANNERS, FRAMES, VERSION, LEGACY_KEY,
    games: new Map(),
    sanitize, quizOptions,
    get state() { return state; },
    load(raw) { state = sanitize(raw); },
    serialize: () => state,
    save() { SS.store.save('play', () => state); },
    changed(detail) { P.save(); emit(detail); },

    /* Games register their board, preview and settings here (see chess.js and arcade-games.js) */
    register(id, def) { if (GAMES.includes(id)) P.games.set(id, { id, ...def }); },
    title: id => P.games.get(id)?.title || id,
    icon: id => P.games.get(id)?.icon || '🎮',
    data(id) { if (!U.isObj(state.gameData[id])) state.gameData[id] = {}; return state.gameData[id]; },

    /* ---- The learning gate ---- */
    game: () => state.game,
    setGame(id) { if (!GAMES.includes(id) || state.game === id) return; state.game = id; P.changed({ type: 'game', game: id }); },
    actions: (id = state.game) => state.actions[id] || 0,
    progress: () => ({ have: state.progress, need: state.settings.need, grant: state.settings.grant }),
    /* Spend one move in a game. Call only after the move itself is known to be legal and to change something. */
    spend(id) {
      if (!(state.actions[id] > 0)) return false;
      state.actions[id]--; state.stats.moves[id] = (state.stats.moves[id] || 0) + 1;
      P.changed({ type: 'spend', game: id });
      return true;
    },
    /* Record one checked answer. A key counts once, however often it is submitted or re-rendered;
       wrong answers don't count; only `need` correct answers grant `grant` moves in the selected game. */
    submit(key, correct) {
      const out = { counted: false, granted: 0, game: state.game };
      if (!key || state.counted.includes(key)) return out;
      state.counted.push(key);
      if (state.counted.length > MAX_COUNTED) state.counted.splice(0, state.counted.length - MAX_COUNTED);
      state.stats.answered++;
      out.counted = true;
      if (correct) {
        state.stats.correct++;
        state.progress++;
        if (state.progress >= state.settings.need) {
          state.progress -= state.settings.need;
          state.actions[state.game] = (state.actions[state.game] || 0) + state.settings.grant;
          out.granted = state.settings.grant;
        }
      }
      P.changed({ type: 'answer', ...out });
      return out;
    },
    setRhythm({ need, grant }) {
      state.settings.need = U.clampNum(Math.floor(need), 1, 100, state.settings.need);
      state.settings.grant = U.clampNum(Math.floor(grant), 1, 100, state.settings.grant);
      state.progress = Math.min(state.progress, state.settings.need - 1);
      P.changed({ type: 'settings' });
    },
    /* Count a win once per finished game. `record` is the game's saved board; its flag is written in the
       same save as the win, so restoring, resetting or re-rendering a finished board can't count it again. */
    win(id, record) {
      if (!GAMES.includes(id) || !record || record.winCounted) return false;
      record.winCounted = true;
      state.wins[id]++;
      P.changed({ type: 'win', game: id });
      SS.ui.announce(`${P.title(id)} won. ${U.plural(state.wins[id], 'win')} in total.`);
      return true;
    },

    /* ---- Migration from version 1 (localStorage) ---- */
    readLegacy() { try { const raw = localStorage.getItem(LEGACY_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } },
    clearLegacy() {
      try {
        localStorage.removeItem(LEGACY_KEY);
        Object.keys(localStorage).filter(k => k.startsWith('studyspace-play-widgets-')).forEach(k => localStorage.removeItem(k));
      } catch (_) { /* nothing to clear */ }
    },

    /* ---- Profile ---- */
    profile: () => state.profile,
    avatar(size = 72) {
      const p = state.profile;
      return el('div.sp-avatar', { style: { width: `${size}px`, height: `${size}px`, background: p.frame === 'simple' ? p.simpleFrame : FRAMES[p.frame].color } },
        p.avatar ? el('img', { src: p.avatar, alt: '' }) : el('span', { text: (p.name || SS.prefs.get('name') || 'S').slice(0, 1).toUpperCase() }));
    },
    bannerCSS: () => (state.profile.bannerImage ? `center / cover url("${state.profile.bannerImage}")` : BANNERS[state.profile.banner].style),
    editProfile
  };

  /* ---- Shared building blocks for the game modules ---- */
  const TYPING = 'input, textarea, select, [contenteditable="true"], [data-own-keys]';
  P.kit = {
    /* Keys reach a game only while focus is inside its own panel (`target`), never from the quiz,
       and never Space/Enter aimed at a focused button (the button handles those itself). */
    keys(target, fn) {
      const handle = e => {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !target.isConnected) return;
        const t = e.target instanceof Element ? e.target : null;
        if (t && t.closest(TYPING)) return;
        if (t && t.closest('button, a[href], [role="button"]') && (e.key === ' ' || e.key === 'Enter' || e.code === 'Space')) return;
        fn(e);
      };
      target.addEventListener('keydown', handle);
      return () => target.removeEventListener('keydown', handle);
    },
    field: (label, node, hint) => el('label.ag-field', el('span', { text: label }), node, hint ? el('small.hint', { text: hint }) : null),
    select: (label, choices, value, change) => { const s = el('select.input', { aria: { label }, on: { change: e => change(e.target.value) } }, choices.map(([v, text]) => el('option', { value: String(v), text }))); s.value = String(value); return s; },
    color: (label, value, change) => el('input.ag-color', { type: 'color', value, aria: { label }, on: { input: e => change(e.target.value) } }),
    toggle: (label, value, change) => el('input', { type: 'checkbox', checked: !!value, aria: { label }, on: { change: e => change(e.target.checked) } }),
    range: (label, min, max, value, change) => el('input', { type: 'range', min, max, step: 1, value, aria: { label }, on: { input: e => change(Number(e.target.value)) } }),
    /* Save one preference of a game; every mounted copy (panel, preview) redraws from the 'play' event */
    setPref(id, key, value) { const d = P.data(id); d.prefs = { ...(d.prefs || {}), [key]: value }; P.changed({ type: 'prefs', game: id, key }); },
    async confirmNew(started) { return !started || SS.ui.confirm({ title: 'Start a new game?', message: 'This replaces the current board. Your available moves, wins and customization stay saved.', ok: 'New game', danger: false }); },
    /* "No moves available — answer 1 more question correctly to unlock 3 moves." */
    noMoves(id) {
      const g = P.progress(); const left = g.need - g.have;
      return P.game() === id ? `No moves available. Answer ${left} more ${left === 1 ? 'question' : 'questions'} correctly to unlock ${U.plural(g.grant, 'move')}. Your board is saved.` : `No ${P.title(id)} moves available. New moves go to ${P.title(P.game())} — pick ${P.title(id)} in the game selector to earn moves here.`;
    },
    movesLabel: id => (P.actions(id) ? `${U.plural(P.actions(id), 'move')} available` : 'No moves available')
  };

  function readImage(file, w, h, done) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { SS.ui.toast('Choose an image file.', { kind: 'error' }); return; }
    if (file.size > 15 * 1024 * 1024) { SS.ui.toast('Choose an image smaller than 15 MB.', { kind: 'error' }); return; }
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const k = Math.max(w / img.width, h / img.height);
      c.getContext('2d').drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
      URL.revokeObjectURL(url); done(c.toDataURL('image/webp', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); SS.ui.toast('That image could not be opened.', { kind: 'error' }); };
    img.src = url;
  }

  function editProfile() {
    const p = state.profile;
    const before = U.clone(p);
    const d = SS.ui.dialog({ eyebrow: 'Make yourself at home', title: 'Your profile', size: 'md' });
    const preview = el('div.sp-profile-preview');
    const paint = () => { preview.replaceChildren(el('div.sp-preview-banner', { style: { background: P.bannerCSS() } }), P.avatar(84)); };
    const apply = () => { paint(); P.changed({ type: 'profile' }); };
    const name = SS.ui.input({ value: p.name || SS.prefs.get('name'), label: 'Display name', maxLength: 40 });
    const bio = SS.ui.input({ value: p.bio, label: 'Profile message', maxLength: 160 });
    const avatarIn = el('input', { type: 'file', accept: 'image/*', aria: { label: 'Upload a profile picture' } });
    avatarIn.addEventListener('change', () => { readImage(avatarIn.files[0], 256, 256, data => { p.avatar = data; apply(); }); avatarIn.value = ''; });
    const bannerIn = el('input', { type: 'file', accept: 'image/*', aria: { label: 'Upload your own banner' } });
    bannerIn.addEventListener('change', () => { readImage(bannerIn.files[0], 900, 360, data => { p.bannerImage = data; apply(); drawChoices(); }); bannerIn.value = ''; });
    const choices = el('div');
    function drawChoices() {
      const banners = el('div.sp-look-grid', { role: 'radiogroup', aria: { label: 'Banner' } }, Object.entries(BANNERS).map(([id, b]) => el('button.sp-look', { type: 'button', role: 'radio', aria: { checked: String(!p.bannerImage && p.banner === id), label: b.name }, class: !p.bannerImage && p.banner === id ? 'on' : '', on: { click: () => { p.banner = id; p.bannerImage = ''; apply(); drawChoices(); } } }, el('span.sp-look-swatch', { style: { background: b.style } }), el('small', { text: b.name }))));
      const frames = el('div.sp-look-grid', { role: 'radiogroup', aria: { label: 'Avatar frame' } }, Object.entries(FRAMES).map(([id, f]) => el('button.sp-look', { type: 'button', role: 'radio', aria: { checked: String(p.frame === id), label: f.name }, class: p.frame === id ? 'on' : '', on: { click: () => { p.frame = id; apply(); drawChoices(); } } }, el('span.sp-look-swatch.round', { style: { background: id === 'simple' ? p.simpleFrame : f.color } }), el('small', { text: f.name }))));
      const frameColor = el('input.ag-color', { type: 'color', value: p.simpleFrame, aria: { label: 'Simple frame colour' }, on: { input: e => { p.simpleFrame = e.target.value; p.frame = 'simple'; apply(); } } });
      choices.replaceChildren(SS.ui.field('Banner', banners), el('div.row-gap', SS.ui.field('Or upload your own banner', bannerIn), p.bannerImage ? el('button.btn.btn-sm', { type: 'button', text: 'Remove uploaded banner', on: { click: () => { p.bannerImage = ''; apply(); drawChoices(); } } }) : null),
        SS.ui.field('Avatar frame', frames), SS.ui.field('Simple frame colour', frameColor));
    }
    paint(); drawChoices();
    d.body.append(preview, SS.ui.field('Display name', name), SS.ui.field('A little about you', bio),
      el('div.row-gap', SS.ui.field('Profile picture', avatarIn), p.avatar ? el('button.btn.btn-sm', { type: 'button', text: 'Remove picture', on: { click: e => { p.avatar = ''; apply(); e.currentTarget.remove(); } } }) : null),
      choices, el('p.hint', { text: 'Every banner and frame is free to use. Your profile is saved in this browser and included in backups.' }));
    d.foot.append(el('button.btn', { type: 'button', text: 'Cancel', on: { click: () => { Object.assign(p, before); P.changed({ type: 'profile' }); d.close(); } } }),
      el('button.btn.btn-primary', { type: 'button', text: 'Save profile', on: { click: () => { p.name = name.value.trim().slice(0, 40); p.bio = bio.value.trim().slice(0, 160); if (p.name) SS.prefs.set('name', p.name); P.changed({ type: 'profile' }); d.close(); } } }));
  }
})(window.SS);
