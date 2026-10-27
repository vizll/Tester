/* Tester — optional, READ-ONLY Google Calendar sync. Events from the calendars the student selects are
   shown beside their own local events; nothing is ever created, changed or deleted in Google.
   - Sign-in uses Google Identity Services' token model, which suits a static browser app (no server).
   - Permissions: calendar.calendarlist.readonly (list your calendars) and calendar.events.readonly (view
     events) — the narrowest scopes that do the job.
   - The access token lives only in memory for this tab. It is never stored, backed up or logged; after
     a reload, Refresh signs in again. Selected calendars and a disposable copy of fetched events are kept
     in this browser (separate from local events, never in backups) so they show offline.
   - The public OAuth client ID comes from config.js (see README). There is no client secret. */
(function (SS) {
  'use strict';
  const U = SS.util;
  const { el } = U;
  const SCOPE_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
  const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events.readonly';
  const GSI_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/calendar/v3';
  const FRESH_MS = 5 * 60 * 1000;
  const MAX_PAGES = 20;
  const CLIENT_RE = /^[\w-]{4,120}\.apps\.googleusercontent\.com$/;

  let token = null;                 // { value, expiresAt } — memory only
  let tokenClient = null, gsiPromise = null;
  let settings = { connected: false, calendars: [], lastRefresh: null, clientId: '', listScope: true };
  let cache = { events: {}, ranges: {} };   // events by "calendarId|eventId"; fetched ranges per calendar
  let status = { state: 'off', message: '' };
  let wanted = [];                  // visible ranges asked for by calendar widgets
  let busy = false, wantTimer = null, loaded = false;

  const clientId = () => { const fromConfig = window.TESTER_CONFIG && window.TESTER_CONFIG.googleClientId; return CLIENT_RE.test(fromConfig || '') ? fromConfig : CLIENT_RE.test(settings.clientId || '') ? settings.clientId : ''; };
  const tokenValid = () => !!token && Date.now() < token.expiresAt;
  const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };
  const emit = () => SS.bus.emit('gcal', { state: status.state });
  const setStatus = (state, message = '') => { if (status.state === state && status.message === message) return; status = { state, message }; emit(); };
  const saveSettings = () => SS.store.save('gcal', () => ({ version: 1, connected: settings.connected, calendars: settings.calendars, lastRefresh: settings.lastRefresh, clientId: settings.clientId, listScope: settings.listScope }));
  const saveCache = () => SS.store.save('gcal-cache', () => cache);

  function sanitizeSettings(raw) {
    const s = { connected: false, calendars: [], lastRefresh: null, clientId: '', listScope: true };
    if (!U.isObj(raw)) return s;
    s.connected = !!raw.connected;
    s.calendars = (Array.isArray(raw.calendars) ? raw.calendars : []).filter(c => U.isObj(c) && typeof c.id === 'string' && c.id.length < 300).slice(0, 100).map(c => ({ id: c.id, summary: U.str(c.summary, 200) || c.id, color: U.hex(c.color, '#4285f4'), primary: !!c.primary, selected: c.selected !== false }));
    s.lastRefresh = Number(raw.lastRefresh) || null;
    s.clientId = CLIENT_RE.test(raw.clientId || '') ? raw.clientId : '';
    s.listScope = raw.listScope !== false;
    return s;
  }
  function sanitizeCache(raw) {
    const c = { events: {}, ranges: {} };
    if (!U.isObj(raw)) return c;
    if (U.isObj(raw.events)) Object.values(raw.events).slice(0, 20000).forEach(ev => { const e = U.isObj(ev) && ev.calId && ev.id ? normalize(ev, ev.calId) : null; if (e) c.events[e.key] = e; });
    if (U.isObj(raw.ranges)) Object.entries(raw.ranges).forEach(([cal, list]) => { if (Array.isArray(list)) c.ranges[cal] = list.filter(r => Array.isArray(r) && U.isISO(r[0]) && U.isISO(r[1])).slice(-40); });
    return c;
  }

  /* ---------------- Mapping Google events to local days ---------------- */
  const safeLink = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)google\.com$/.test(u.hostname) ? u.href : ''; } catch (_) { return ''; } };
  /* Accepts an API event or an already normalized one (from the cache) */
  function normalize(ev, calId) {
    if (!U.isObj(ev) || !ev.id || ev.status === 'cancelled') return null;
    const s = ev.start || {}, e = ev.end || {};
    const allDay = typeof ev.allDay === 'boolean' ? ev.allDay : !!s.date;
    const start = typeof ev.start === 'string' ? ev.start : (allDay ? s.date : s.dateTime);
    let end = typeof ev.end === 'string' ? ev.end : (allDay ? e.date : e.dateTime);
    if (allDay ? !U.isISO(start) : Number.isNaN(Date.parse(start))) return null;
    if (allDay ? !U.isISO(end) || end <= start : Number.isNaN(Date.parse(end)) || Date.parse(end) < Date.parse(start)) end = allDay ? U.addDays(start, 1) : start;
    return {
      key: `${calId}|${ev.id}`, calId, id: String(ev.id).slice(0, 300), iCalUID: U.str(ev.iCalUID, 300), title: U.str(ev.summary ?? ev.title, 300) || '(No title)', allDay, start, end,
      location: U.str(ev.location, 300), description: U.str(ev.description, 2000), htmlLink: safeLink(ev.htmlLink), recurring: !!(ev.recurringEventId || ev.recurring)
    };
  }
  /* The local days an event covers. All-day end dates are exclusive (a one-day event on the 5th ends on
     the 6th). A timed event ending exactly at midnight doesn't spill into the next day. Dates come from the
     browser's local time, so events keep their correct days across time zones and DST changes. */
  function daysOf(ev) {
    if (ev.allDay) {
      const out = []; for (let d = ev.start; d < ev.end && out.length < 366; d = U.addDays(d, 1)) out.push(d);
      return out.length ? out : [ev.start];
    }
    const s = new Date(ev.start), e = new Date(ev.end);
    const first = U.toISO(s);
    const last = e > s ? U.toISO(new Date(e.getTime() - 1)) : first;
    const out = []; for (let d = first; d <= last && out.length < 366; d = U.addDays(d, 1)) out.push(d);
    return out;
  }
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /* Agenda items (one per day an event covers) for the calendar widget, de-duplicated across calendars */
  function itemsBetween(from, to) {
    if (!settings.connected && !Object.keys(cache.events).length) return [];
    const selected = new Map(settings.calendars.filter(c => c.selected).map((c, i) => [c.id, { ...c, order: i }]));
    const seen = new Set(); const out = [];
    Object.values(cache.events).filter(ev => selected.has(ev.calId)).sort((a, b) => selected.get(a.calId).order - selected.get(b.calId).order).forEach(ev => {
      const dupe = `${ev.iCalUID || ev.id}|${ev.start}`;
      if (seen.has(dupe)) return; seen.add(dupe);
      const days = daysOf(ev);
      days.forEach((date, i) => {
        if (date < from || date > to) return;
        const cal = selected.get(ev.calId);
        const time = !ev.allDay && i === 0 ? hhmm(new Date(ev.start)) : '';
        out.push({ kind: 'gcal', id: `${ev.key}#${date}`, title: days.length > 1 ? `${ev.title} (${i + 1}/${days.length})` : ev.title, date, time, subjectId: '', done: false, color: cal.color, calendar: cal.summary, item: ev });
      });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
  }

  /* ---------------- Google Identity Services (token model) ---------------- */
  function loadGsi() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return (gsiPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = GSI_SRC; s.async = true;
      const t = setTimeout(() => { s.remove(); reject(new Error('gsi-timeout')); }, 12000);
      s.onload = () => { clearTimeout(t); window.google && google.accounts && google.accounts.oauth2 ? resolve() : reject(new Error('gsi')); };
      s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('gsi')); };
      document.head.append(s);
    }).catch(err => { gsiPromise = null; throw err; }));
  }
  /* Must run from a click (the browser blocks pop-ups otherwise). Resolves true when a token arrives. */
  async function signIn() {
    const id = clientId();
    if (!id) { setStatus('unconfigured', 'Google Calendar isn’t set up for this copy of Tester yet. Add a Google OAuth client ID in config.js (see README), or paste one under Advanced.'); return false; }
    if (!navigator.onLine) { setStatus('offline', 'You’re offline. Connect to the internet to sign in to Google.'); return false; }
    setStatus('connecting', 'Waiting for Google…');
    try { await loadGsi(); } catch (_) { setStatus('error', 'Couldn’t load Google sign-in. Check your connection or any content blocker, then try again.'); return false; }
    return new Promise(resolve => {
      const done = ok => { resolve(ok); };
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: id,
          scope: `${SCOPE_LIST} ${SCOPE_EVENTS}`,
          include_granted_scopes: true,
          callback: resp => {
            if (!resp || resp.error) {
              setStatus('error', resp && resp.error === 'access_denied' ? 'Google access wasn’t allowed, so nothing was connected. Your local calendar still works.' : `Google sign-in didn’t finish (${(resp && resp.error) || 'unknown error'}). Try again.`);
              done(false); return;
            }
            const oauth = google.accounts.oauth2;
            if (!oauth.hasGrantedAllScopes(resp, SCOPE_EVENTS)) { setStatus('error', 'Tester needs the “View events on all your calendars” permission to show your Google events. Connect again and leave that box ticked.'); try { oauth.revoke(resp.access_token, () => {}); } catch (_) { /* best effort */ } done(false); return; }
            settings.listScope = oauth.hasGrantedAllScopes(resp, SCOPE_LIST);
            token = { value: resp.access_token, expiresAt: Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 60) * 1000 };
            done(true);
          },
          error_callback: err => {
            const type = err && err.type;
            setStatus('error', type === 'popup_failed_to_open' ? 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then select Connect again.' : type === 'popup_closed' ? 'The Google sign-in window was closed before finishing. Nothing was changed.' : 'Google sign-in didn’t finish. Try again.');
            done(false);
          }
        });
        tokenClient.requestAccessToken({ prompt: settings.connected ? '' : 'consent' });
      } catch (_) { setStatus('error', 'Google sign-in couldn’t start in this browser.'); done(false); }
    });
  }

  /* ---------------- Calendar API ---------------- */
  class ApiError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }
  async function api(path, params = {}) {
    if (!tokenValid()) throw new ApiError('auth', 'Your Google session ended. Select Refresh to sign in again.');
    const url = new URL(API + path);
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
    let res;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${token.value}` } }); }
    catch (_) { throw new ApiError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? 'Couldn’t reach Google Calendar. Check your connection and select Refresh.' : 'You’re offline.'); }
    if (res.ok) return res.json();
    let reason = '';
    try { const body = await res.json(); reason = (body.error && (body.error.errors?.[0]?.reason || body.error.status)) || ''; } catch (_) { /* no body */ }
    if (res.status === 401) { token = null; throw new ApiError('auth', 'Your Google session expired. Select Refresh to sign in again.'); }
    if (res.status === 429 || /rateLimit/i.test(reason)) throw new ApiError('rate', 'Google is limiting requests right now. Wait a minute, then select Refresh.');
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(reason)) throw new ApiError('config', 'The Google Calendar API isn’t enabled for this OAuth client’s Google Cloud project. Enable it (see README), then try again.');
    if (res.status === 403) throw new ApiError('permission', 'Google refused access to that calendar. Disconnect and connect again, allowing calendar access.');
    if (res.status === 404 || res.status === 410) throw new ApiError('missing', 'That calendar is no longer available.');
    throw new ApiError('server', `Google Calendar had a problem (${res.status}). Try Refresh in a little while.`);
  }
  async function loadCalendars() {
    if (!settings.listScope) { settings.calendars = settings.calendars.length ? settings.calendars : [{ id: 'primary', summary: 'Your main calendar', color: '#4285f4', primary: true, selected: true }]; return; }
    const prev = new Map(settings.calendars.map(c => [c.id, c]));
    const list = []; let pageToken = '';
    for (let i = 0; i < MAX_PAGES; i++) {
      const data = await api('/users/me/calendarList', { maxResults: 250, pageToken, minAccessRole: 'reader' });
      (data.items || []).forEach(c => { if (c && c.id && !c.deleted && !list.some(x => x.id === c.id)) list.push({ id: c.id, summary: U.str(c.summaryOverride || c.summary, 200) || c.id, color: U.hex(c.backgroundColor, '#4285f4'), primary: !!c.primary, selected: prev.has(c.id) ? prev.get(c.id).selected : !!c.primary }); });
      if (!data.nextPageToken) break; pageToken = data.nextPageToken;
    }
    list.sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary));
    settings.calendars = list;
    // drop cached events of calendars that are gone
    Object.values(cache.events).forEach(ev => { if (!list.some(c => c.id === ev.calId)) delete cache.events[ev.key]; });
  }
  /* Fetch one calendar's events overlapping [from, to] (local days), replacing what was cached for that
     window so edits and deletions in Google show up. Recurring events arrive as single instances. */
  async function fetchRange(cal, from, to) {
    const timeMin = U.parseISO(from).toISOString();
    const timeMax = U.parseISO(U.addDays(to, 1)).toISOString();
    const fresh = []; let pageToken = '';
    for (let i = 0; i < MAX_PAGES; i++) {
      const data = await api(`/calendars/${encodeURIComponent(cal.id)}/events`, { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: 250, timeZone: zone(), pageToken });
      (data.items || []).forEach(ev => { const n = normalize(ev, cal.id); if (n) fresh.push(n); });
      if (!data.nextPageToken) break; pageToken = data.nextPageToken;
    }
    Object.values(cache.events).forEach(ev => { if (ev.calId === cal.id && daysOf(ev).some(d => d >= from && d <= to)) delete cache.events[ev.key]; });
    fresh.forEach(ev => { cache.events[ev.key] = ev; });
    const ranges = (cache.ranges[cal.id] || []).filter(r => !(r[0] >= from && r[1] <= to));
    ranges.push([from, to, Date.now()]);
    cache.ranges[cal.id] = ranges.slice(-40);
  }
  const covered = (cal, from, to) => (cache.ranges[cal.id] || []).some(r => r[0] <= from && r[1] >= to && Date.now() - r[2] < FRESH_MS);

  async function sync({ force = false } = {}) {
    if (busy || !settings.connected) return;
    if (!tokenValid()) { setStatus('needs-auth', settings.lastRefresh ? `Showing events saved ${new Date(settings.lastRefresh).toLocaleString()}. Select Refresh to update them.` : 'Select Refresh to sign in and load your Google events.'); return; }
    const ranges = wanted.length ? wanted : [[U.addDays(U.todayISO(), -7), U.addDays(U.todayISO(), 35)]];
    const cals = settings.calendars.filter(c => c.selected);
    const jobs = []; cals.forEach(c => ranges.forEach(([f, t]) => { if (force || !covered(c, f, t)) jobs.push([c, f, t]); }));
    if (!jobs.length) { setStatus('ok'); return; }
    busy = true; setStatus('loading', 'Updating Google events…');
    const problems = [];
    try {
      for (const [c, f, t] of jobs) {
        try { await fetchRange(c, f, t); }
        catch (err) { if (err.kind === 'missing') { problems.push(`“${c.summary}” is no longer available.`); continue; } throw err; }
      }
      settings.lastRefresh = Date.now(); saveSettings(); saveCache();
      setStatus('ok', problems.join(' '));
    } catch (err) {
      saveCache();
      setStatus(err.kind === 'auth' ? 'needs-auth' : err.kind === 'offline' ? 'offline' : 'error', err.kind === 'offline' ? `You’re offline. ${settings.lastRefresh ? `Showing events saved ${new Date(settings.lastRefresh).toLocaleString()}.` : ''}` : err.message || 'Google Calendar couldn’t be updated.');
    } finally { busy = false; }
  }

  /* ---------------- Public API ---------------- */
  const G = SS.gcal = {
    SCOPES: [SCOPE_LIST, SCOPE_EVENTS],
    normalize, daysOf, itemsBetween,
    status: () => ({ ...status }),
    connected: () => settings.connected,
    configured: () => !!clientId(),
    calendars: () => settings.calendars.map(c => ({ ...c })),
    lastRefresh: () => settings.lastRefresh,
    async init() {
      const rawSettings = await SS.store.get('gcal'); const rawCache = await SS.store.get('gcal-cache');
      settings = sanitizeSettings(rawSettings && !rawSettings.__corrupt ? rawSettings : null);
      cache = sanitizeCache(rawCache && !rawCache.__corrupt ? rawCache : null);
      loaded = true;
      status = settings.connected ? { state: 'needs-auth', message: settings.lastRefresh ? `Showing events saved ${new Date(settings.lastRefresh).toLocaleString()}. Select Refresh to update them.` : 'Select Refresh to sign in and load your Google events.' } : { state: clientId() ? 'off' : 'unconfigured', message: '' };
      emit();
      addEventListener('online', () => { if (settings.connected && tokenValid()) sync(); });
      addEventListener('offline', () => { if (settings.connected) setStatus('offline', `You’re offline. ${settings.lastRefresh ? `Showing events saved ${new Date(settings.lastRefresh).toLocaleString()}.` : ''}`); });
    },
    /* Calendar widgets report what they show; fetching is debounced and skips windows that are fresh */
    want(from, to) {
      if (!loaded || !settings.connected) return;
      if (!wanted.some(r => r[0] <= from && r[1] >= to)) { wanted = wanted.filter(r => !(r[0] >= from && r[1] <= to)); wanted.push([from, to]); if (wanted.length > 6) wanted = wanted.slice(-6); }
      if (!tokenValid() || !settings.calendars.some(c => c.selected && !covered(c, from, to))) return;
      clearTimeout(wantTimer);
      wantTimer = setTimeout(() => sync(), 300);
    },
    async connect() {
      if (!(await signIn())) return false;
      try {
        settings.connected = true;
        await loadCalendars();
        saveSettings();
        await sync({ force: true });
        SS.ui.toast('Google Calendar connected (read-only)', { kind: 'success' });
        return true;
      } catch (err) { setStatus(err.kind === 'auth' ? 'needs-auth' : 'error', err.message || 'Couldn’t load your calendars.'); saveSettings(); return false; }
    },
    async refresh() {
      if (!settings.connected) return G.connect();
      if (!tokenValid() && !(await signIn())) return false;
      try { await loadCalendars(); saveSettings(); } catch (err) { setStatus(err.kind === 'auth' ? 'needs-auth' : 'error', err.message); return false; }
      await sync({ force: true });
      return status.state === 'ok';
    },
    setSelected(id, on) {
      const c = settings.calendars.find(x => x.id === id); if (!c) return;
      c.selected = !!on; saveSettings(); emit();
      if (on && tokenValid()) sync();
    },
    /* Forget the Google connection: revoke the token, remove the cached Google events. Local events stay. */
    disconnect() {
      const t = token && token.value; token = null;
      if (t && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(t, () => {}); } catch (_) { /* best effort */ } }
      settings = { ...settings, connected: false, calendars: [], lastRefresh: null };
      cache = { events: {}, ranges: {} }; wanted = [];
      saveSettings(); SS.store.remove('gcal-cache').catch(() => {});
      setStatus(clientId() ? 'off' : 'unconfigured', '');
      SS.ui.toast('Google Calendar disconnected. Its events were removed from Tester; your own events are untouched.', { kind: 'success' });
    },
    setClientId(id) { settings.clientId = CLIENT_RE.test(id) ? id : ''; saveSettings(); if (status.state === 'unconfigured' && clientId()) setStatus('off'); emit(); },
    privacyText: () => 'Optional. If you connect Google Calendar, your browser signs in with Google and reads events from the calendars you pick (read-only — Tester never changes your Google calendars). Event details go straight from Google to this browser and a copy is kept here so it works offline. Tester has no server, and the Google access token is kept only in memory for this tab — never saved, backed up or shared. Disconnect any time to remove the copy; you can also remove access in your Google Account settings.',
    details(item) {
      const ev = item.item || item;
      const when = ev.allDay
        ? (daysOf(ev).length > 1 ? `${U.fmtDate(ev.start, { weekday: 'short', month: 'short', day: 'numeric' })} – ${U.fmtDate(U.addDays(ev.end, -1), { weekday: 'short', month: 'short', day: 'numeric' })} · all day` : `${U.fmtDate(ev.start, { weekday: 'long', month: 'long', day: 'numeric' })} · all day`)
        : `${new Date(ev.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${new Date(ev.end).toLocaleString([], daysOf(ev).length > 1 ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' })}`;
      const cal = settings.calendars.find(c => c.id === ev.calId);
      const d = SS.ui.dialog({ eyebrow: 'Google Calendar · read-only', title: ev.title, size: 'sm' });
      d.body.append(
        el('p.gcal-when', SS.icon('clock', 15), el('span', { text: when })),
        cal ? el('p.gcal-cal', el('i', { style: { background: cal.color } }), el('span', { text: cal.summary })) : null,
        ev.recurring ? el('p.hint', { text: 'Part of a repeating event.' }) : null,
        ev.location ? el('p.gcal-loc', SS.icon('pin', 15), el('span', { text: ev.location })) : null,
        ev.description ? el('p.gcal-desc', { text: ev.description.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim() }) : null,
        el('p.panel-note', SS.icon('lock', 14), el('span', { text: 'This event comes from Google Calendar and can’t be edited or moved in Tester. Change it in Google Calendar, then select Refresh.' })));
      d.foot.append(ev.htmlLink ? el('a.btn.mr-auto', { href: ev.htmlLink, target: '_blank', rel: 'noopener noreferrer' }, SS.icon('external', 14), 'Open in Google Calendar') : null, el('button.btn.btn-primary', { type: 'button', text: 'Close', on: { click: () => d.close() } }));
    },
    panel
  };

  function panel() {
    const d = SS.ui.dialog({ eyebrow: 'Optional · read-only', title: 'Google Calendar', size: 'md', class: 'gcal-panel' });
    const box = el('div.gcal-box');
    d.body.append(box);
    const draw = () => {
      const st = status;
      const state = el('div.gcal-state', { class: `st-${st.state}`, role: 'status' },
        el('b', { text: { off: 'Not connected', unconfigured: 'Not set up', connecting: 'Connecting…', loading: 'Updating…', ok: 'Connected', 'needs-auth': settings.connected ? 'Connected — sign-in needed to update' : 'Not connected', offline: 'Offline', error: 'Something went wrong' }[st.state] || 'Not connected' }),
        settings.lastRefresh ? el('span', { text: `Last updated ${new Date(settings.lastRefresh).toLocaleString()}` }) : null,
        st.message ? el('p', { text: st.message }) : null);
      const actions = el('div.row-gap',
        !settings.connected ? el('button.btn.btn-primary', { type: 'button', disabled: !clientId() || st.state === 'connecting', on: { click: () => G.connect().then(draw) } }, SS.icon('link', 15), 'Connect Google Calendar') : null,
        settings.connected ? el('button.btn.btn-primary', { type: 'button', disabled: st.state === 'loading' || st.state === 'connecting', on: { click: () => G.refresh().then(draw) } }, SS.icon('refresh', 15), 'Refresh') : null,
        settings.connected ? el('button.btn.btn-danger', { type: 'button', on: { click: async () => { if (await SS.ui.confirm({ title: 'Disconnect Google Calendar?', message: 'Google events will disappear from Tester and the saved copy is deleted. Your own events, assignments and reminders are not affected.', ok: 'Disconnect' })) { G.disconnect(); draw(); } } } }, 'Disconnect') : null);
      const cals = settings.connected && settings.calendars.length ? el('fieldset.gcal-cals', el('legend', { text: 'Show these calendars' }), settings.calendars.map(c => el('label.check-row', el('input', { type: 'checkbox', checked: c.selected, on: { change: e => { G.setSelected(c.id, e.target.checked); } } }), el('i.gcal-dot', { style: { background: c.color } }), el('span', { text: c.summary + (c.primary ? ' (main)' : '') })))) : null;
      const advanced = el('details.gcal-adv', el('summary', { text: 'Advanced: OAuth client ID' }),
        el('p.hint', { text: window.TESTER_CONFIG && window.TESTER_CONFIG.googleClientId ? 'This copy of Tester has a client ID set in config.js.' : 'If you host Tester yourself, put your Google OAuth client ID in config.js — or paste it here for this browser only. A client ID is public; never paste a client secret.' }),
        (() => { const i = SS.ui.input({ value: settings.clientId, placeholder: '1234-abc.apps.googleusercontent.com', label: 'OAuth client ID', maxLength: 140 }); const save = el('button.btn.btn-sm', { type: 'button', text: 'Save client ID', on: { click: () => { const v = i.value.trim(); if (v && !CLIENT_RE.test(v)) { SS.ui.toast('That doesn’t look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).', { kind: 'error' }); return; } G.setClientId(v); draw(); SS.ui.toast(v ? 'Client ID saved for this browser' : 'Client ID cleared'); } } }); return el('div.row-gap', i, save); })());
      box.replaceChildren(
        el('p', { text: 'See your Google Calendar events next to your own events in the Calendar widget. Tester only reads them — editing and deleting stay in Google Calendar.' }),
        state, actions, cals || '',
        el('p.hint', { text: G.privacyText() }),
        advanced);
    };
    draw();
    const off = SS.bus.on('gcal', draw);
    const orig = d.close; d.close = r => { off(); orig(r); };
    d.foot.append(el('button.btn.btn-primary', { type: 'button', text: 'Done', on: { click: () => d.close() } }));
  }

  // Expose pure helpers for the automated checks in tests/
  G._test = { sanitizeSettings, sanitizeCache, setCache: c => { cache = sanitizeCache(c); }, setSettings: s => { settings = sanitizeSettings(s); }, hasToken: () => !!token };
})(window.SS);
