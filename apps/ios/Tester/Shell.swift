import Foundation

/// Small pieces of CSS/JS injected into the page to make the web app feel native on iPhone and iPad.
enum Shell {
    /// Runs before the page's own scripts: marks the app and adds safe-area padding (notch, Dynamic
    /// Island, home indicator) so the gradient runs edge to edge while controls stay reachable.
    static let startScript = """
    (function () {
      var css = function (d) {
        d.classList.add('app-shell', 'app-ios');
        if (document.getElementById('tester-ios-shell')) return;
        var s = document.createElement('style');
      s.id = 'tester-ios-shell';
      s.textContent = `
        html.app-ios { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        html.app-ios .app { padding-top: calc(14px + env(safe-area-inset-top, 0px)); padding-bottom: calc(120px + env(safe-area-inset-bottom, 0px)); }
        html.app-ios .topbar { top: calc(10px + env(safe-area-inset-top, 0px)); }
        html.app-ios .nav-side { top: calc(16px + env(safe-area-inset-top, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); left: calc(16px + env(safe-area-inset-left, 0px)); }
        html.app-ios body.has-nav .app { margin-right: calc(24px + env(safe-area-inset-right, 0px)); }
        @media (max-width: 700px) {
          html.app-ios .nav-side { top: 0; bottom: 0; left: 0; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
          html.app-ios body.has-nav .app { margin-right: auto; width: calc(100% - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)); }
        }
        html.app-ios dialog.sheet { padding-bottom: env(safe-area-inset-bottom, 0px); }
        html.app-ios .topbar, html.app-ios .nav-item, html.app-ios .qz-tab, html.app-ios .w-head { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
      `;
        d.appendChild(s);
      };
      if (document.documentElement) css(document.documentElement);
      else {
        var mo = new MutationObserver(function () { if (document.documentElement) { mo.disconnect(); css(document.documentElement); } });
        mo.observe(document, { childList: true });
      }
    })();
    """

    /// Runs after the page is parsed: saving a file (backups, exported study sets) opens the iOS share
    /// sheet, and the status bar follows the page's light or dark background.
    static let endScript = """
    (function () {
      var h = window.webkit && window.webkit.messageHandlers;
      if (!h) return;
      if (window.SS && SS.util) {
        SS.util.download = function (filename, content, type) {
          var blob = content instanceof Blob ? content : new Blob([content], { type: type || 'application/json' });
          var reader = new FileReader();
          reader.onload = function () { h.testerSave.postMessage({ filename: String(filename || 'Tester-export'), data: String(reader.result).split(',')[1] || '' }); };
          reader.readAsDataURL(blob);
        };
      }
      var d = document.documentElement;
      var post = function () { h.testerChrome.postMessage({ dark: d.dataset.page === 'dark' }); };
      new MutationObserver(post).observe(d, { attributes: true, attributeFilter: ['data-page', 'data-mode'] });
      post();
      if (!window.SS || !h.testerWidgets) return;

      // Widgets + voice to-dos. The page sends a small summary (what's due, open to-dos) for the
      // Home Screen widgets, and applies to-dos added from Siri, Shortcuts, the Action button or a widget.
      var send = function (msg) { try { h.testerWidgets.postMessage(msg); } catch (e) {} };
      SS.native = {
        voice: function () { send({ type: 'voice' }); },
        setup: function () { send({ type: 'setup' }); }
      };
      var build = function () {
        var D = SS.data, U = SS.util, today = U.todayISO(), subj = {};
        D.all('subjects').forEach(function (s) { subj[s.id] = s; });
        var seen = {}, due = [];
        var add = function (x, overdue) {
          var key = x.kind + ':' + x.id;
          if (seen[key] || x.done) return; seen[key] = 1;
          var s = subj[x.subjectId], it = x.item || {};
          due.push({ id: x.id, kind: x.kind, title: String(x.title || '').slice(0, 120), date: x.date || '', time: x.time || '',
            subject: s ? s.name : '', color: (s && s.color) || it.color || '', status: x.status || '', overdue: !!overdue });
        };
        D.overdue().forEach(function (x) { if (x.kind !== 'todo') add(x, true); });
        D.agenda({ from: today, to: U.addDays(today, 45), kinds: ['assignment', 'exam', 'reminder'] }).forEach(function (x) { add(x, false); });
        var open = D.all('todos').filter(function (t) { return !t.done; });
        var dated = open.filter(function (t) { return t.dueDate; }).sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); });
        var undated = open.filter(function (t) { return !t.dueDate; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        var todos = dated.concat(undated).slice(0, 24).map(function (t) {
          return { id: t.id, text: String(t.text || '').slice(0, 160), due: t.dueDate || '', priority: t.priority || 'none' };
        });
        return { v: 1, updated: Date.now(), today: today, due: due.slice(0, 30), todos: todos, todosOpen: open.length,
          dueSoon: due.length, name: String(SS.prefs.get('name') || '') };
      };
      var last = '', timer = 0;
      var push = function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          try { var json = JSON.stringify(build()); var cmp = json.replace(/"updated":\\d+,/, ''); if (cmp !== last) { last = cmp; send({ type: 'snapshot', json: json }); } } catch (e) { console.error('[Tester] widget summary', e); }
        }, 450);
      };
      // Called by the app with to-dos queued while Tester was closed and checkmarks tapped on widgets.
      window.TesterNative = {
        apply: function (payload) {
          var out = { added: [], completed: [] };
          (payload.inbox || []).forEach(function (it) {
            try { var t = SS.capture('todo', String(it.text || '')); out.added.push({ inbox: it.id, id: (t && t.id) || '' }); } catch (e) { console.error(e); }
          });
          (payload.completions || []).forEach(function (c) {
            try {
              if (SS.data.get('todos', c.id)) SS.data.update('todos', c.id, { done: true });
              else if (SS.data.get('assignments', c.id)) SS.data.update('assignments', c.id, { done: true });
              else if (SS.data.get('reminders', c.id)) SS.data.update('reminders', c.id, { done: true });
            } catch (e) { console.error(e); }
            out.completed.push(c.id);
          });
          return JSON.stringify(out);
        },
        refresh: function () { last = ''; push(); }
      };
      var start = function () {
        if (start.done) return; start.done = true;
        SS.bus.on('data', push); SS.bus.on('day', push); SS.bus.on('prefs', push);
        push();
        send({ type: 'ready' });
      };
      if (SS.booted) start();
      else {
        SS.bus.on('booted', start);
        var tries = 0, poll = setInterval(function () { if (SS.booted || ++tries > 200) { clearInterval(poll); if (SS.booted) start(); } }, 150);
      }
    })();
    """
}
