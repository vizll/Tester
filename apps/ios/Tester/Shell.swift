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
    })();
    """
}
