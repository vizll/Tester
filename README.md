# Tester — Google Calendar update

Unzip this folder and double-click **Start Tester.command** on a Mac. Keep its window open while
using the website. If macOS asks which app to use, open the launcher with Terminal.

Alternatively, serve the `dist` folder with any static website server. On a Mac with Python 3:

    cd dist
    python3 -m http.server 8000

Then visit http://localhost:8000 in your browser.

To add a calendar, select **Google Calendar** on the Calendar widget, paste your Google email,
Calendar ID, embed link or embed code, and select **Add calendar**. Use **Tester calendar** to switch
back to your local calendar. Private calendars require access through your Google account; the widget
includes a direct Google Calendar link if your browser prevents embedded access.

**Resizing:** hover near either bottom corner of a widget and drag (bottom-right keeps the top-left
corner fixed; bottom-left keeps the top-right corner fixed). Esc cancels, Ctrl/⌘+Z undoes, Ctrl/⌘+Shift+Z
redoes. On touch screens use Edit mode. Widgets rearrange their content for strips, squares, wide and
tall shapes — see "Resizing widgets" in `dist/README.md` for which widgets adapt and how.

See `dist/README.md` for Google account sync setup and the complete feature guide.

## Desktop and iPhone apps

`apps/` wraps Tester as a Mac app, a Windows app and an iPhone/iPad app you can sideload with
SideStore or AltStore. See `apps/README.md` — the quickest route is GitHub Actions → **Build apps**.
