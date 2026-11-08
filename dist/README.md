# Tester

A Notion-style study workspace you can customize to your heart's content: widgets, themes, notes,
assignments, calendars, flashcards, quizzes and a few games — saved privately in your browser.

## Run it

Tester is a static site (HTML, CSS and JavaScript — no build step, no server code). Serve the folder
over HTTP so the chess engine's Web Worker and WebAssembly file can load:

```sh
cd Tester/dist
python3 -m http.server 8000      # or: npx serve -l 8000
```

Then open <http://localhost:8000>. Any static host works (GitHub Pages, Netlify, a school server…).

Opening `index.html` straight from disk (`file://`) mostly works, but browsers block the Stockfish
worker there (chess falls back to Tester's simple built-in bot) and Google sign-in needs an
`http(s)` address.

## What's where

| File | What it does |
| --- | --- |
| `index.html` | The app: storage, data, themes, dashboard and widgets, panels, startup and migrations |
| `planner.js` / `planner.css` | Today home widgets (Today header, Due work, Week at a glance, Now & next class), class pages (header, notes & sets), Style presets and previews, example content, the welcome |
| `nav.js` / `nav.css` | Sidebar: compact profile, Home, Study, your tabs and pinned **Classes** (add from templates, rename, reorder, delete/unpin, resize, collapse) |
| `quiz-plus.js` / `quiz-plus.css` | The Study tab: study sets, import/export, flashcards, quiz + game sessions, focus timer, games & wins, settings |
| `study-plus.js` / `study-plus.css` | Study & play state: the learning gate, game boards and preferences, wins, profile |
| `chess.js` / `chess.css` | Chess against Stockfish at nine levels (worker lifecycle, built-in fallback bot) |
| `arcade-games.js` / `arcade-games.css` | Solitaire, 2048 and Block Puzzle |
| `gcal.js` / `gcal.css` | Optional read-only Google Calendar sync |
| `config.js` | Public configuration (the Google OAuth client ID) |
| `vendor/` | chess.js rules library, Stockfish worker + WASM, their licences and Stockfish's corresponding source |
| `tests/run-tests.js` | Automated browser checks (Playwright) |

## Today, styles and class pages

* **Today** is the home page on a fresh install: a large date heading, one **+ New** button (Quick add),
  a **Due** panel with overdue work first and then the next deadlines grouped by day, a week strip, your
  current or next class, and a short to-do list. The full calendar and every assignment live in the
  **Planner** tab, so Today keeps a single deadline list.
* **Customize** has three layers. **Style** changes colours, typography, wallpaper and card finish
  (curated styles first, everything granular under *Advanced*) and never moves or resizes a widget.
  **Layout** swaps the widget arrangement (Today, Class, Weekly Planner, Study & play, Exam Prep…) and
  holds spacing and density. **Workspaces** are complete saved combinations — the built-in ones, such as
  *Study & play*, are still there. Existing workspaces and layouts are kept when you upgrade.
* **Class pages**: open a subject and choose *Pin as class page*, or use **Add tab → Class**. A class page
  has a cover, an icon and the subject's colour, links (syllabus, Classroom, anything else), the class's
  deadlines, notes, study sets and calendar. Rearrange and resize its widgets like any tab. Widgets you
  add there, and anything you add with **+ New** or the **N** key, start with that class's subject, so a
  Biology assignment added on the Biology page also shows on Today and in the calendar.
* **Assignments** have a progress status — *To do*, *In progress*, *Submitted* (handed in) or *Done*
  (nothing to submit) — and an optional **Assignment link** with an *Open assignment link* button in the
  details. Ticking the circle still completes an assignment in one click.
* **Examples**: the welcome offers *Start fresh* or *Try with examples*. Example records are tracked by id,
  labelled “Example”, and removed in one step from Today or Settings → General; anything you added
  yourself (even under an example class) stays.

## How studying and playing fit together

* Open **Study** in the sidebar. **Study sets** holds your flashcard sets: search them, filter by
  subject, create, edit (add, edit, reorder and remove cards), duplicate, export or delete.
* **Focus timer** is the full-size study timer (the same timer as on your dashboard).
* **Quiz** puts the questions on the left; the game panel starts closed — choose *Play a game beside your
  quiz* to dock your chosen game on the right. Every
  **3 correctly checked answers unlock 3 moves** in the selected game (change the numbers in Quiz →
  Settings). Wrong answers, flipping flashcards and marking your own answers don't count, and each
  question counts once.
* Moves are spent only by real plays: a legal chess move (the bot's reply is free), a 2048 slide that
  changes the board, a legal Solitaire move/draw/recycle, or a placed Block Puzzle piece. Illegal or
  no-op inputs are free.
* Drag the divider (or focus it and use ←/→) to resize the game, use the expand button to make the game
  bigger in one click, hide it with the eye button, or on narrow screens switch between **Questions**
  and **Game**. Keys only reach the game while focus is inside the game panel.
* **Games & wins** shows wins (counted once per finished game) and every game's look and gameplay
  settings with a live preview. The palette button on the game panel opens the same settings.

### The games

* **Chess** — you play White against Stockfish running in your browser. Nine bot levels, easiest first:
  Starter (looks one move ahead), Beginner, Casual, Intermediate, Club, Professional, Master, Expert and
  Grandmaster (full strength, thinks longest). Pick the level right above the board or in the game's
  settings; it applies from the bot's next move. Settings also offer square contrast (soft, clear,
  high), coordinates, move animation, piece style and colours, and your own board image.
* **Block Puzzle** — an 8 × 8 board and a tray of three pieces. Drag a piece onto the board: an outline
  shows exactly where it will land (red when it doesn't fit) and the rows and columns it would clear
  light up. Full rows and columns clear together; clearing again on the next piece is a combo. When all
  three pieces are placed you get three new ones, at least one of which fits whenever anything can. The
  game ends when nothing in the tray fits; reaching the score target (3,000 by default) is a win.
  Without a mouse: press 1–3 (or tap a piece) to pick it up, move it with the arrow keys and press
  Enter (on touch, tap the spot twice). Placing a piece uses one move; drops that don't fit are free.
* **2048** and **Klondike Solitaire** — as you know them, with tile, card and table colours to choose.

### Importing from Quizlet

Tester imports text, not accounts or links. In Quizlet, open a set → **⋯ → Export**, copy the text
(term, Tab, definition — one card per line) and paste it into **Import** in the Quiz tab. CSV/TSV
files, quoted fields, header rows and custom separators work too; lines that can't be read are listed
and nothing is imported until they're fixed. **Export for Quizlet** saves a set as tab-separated text
that Quizlet's own Import accepts.

## Resizing widgets

* **Mouse or trackpad:** move the pointer to either bottom corner of a widget — a small corner arc
  appears. Drag it. The **bottom-right** corner keeps the widget's top-left corner in place; the
  **bottom-left** corner keeps its top-right corner in place. Sizes snap to the grid (or to 8 px on the
  free canvas; hold **Alt** for free sizing there). Press **Esc** while dragging to cancel.
* **Edit mode** (**E** or the Edit button) shows both corner handles on every widget; it is also the way
  to resize on touch screens. Focus a handle and use the arrow keys: on the bottom-left handle, ← widens
  and → narrows the widget leftwards.
* **Widget menu** (⋯ or right-click): **S / M / L / XL** presets, or **Resize…** to jump into edit mode
  with the handle focused.
* **Undo / redo:** each finished resize — including any widgets it pushed aside — is one step:
  **Ctrl/⌘+Z** undoes it, **Ctrl/⌘+Shift+Z** (or **Ctrl+Y**) redoes it.
* **Locked** widgets can't be moved or resized by any of these; unlock them from the ⋯ menu.
* **Phones** show widgets as a stacked list (reorder in edit mode); freeform sizes apply on wider
  screens.

### Widgets change shape, not just size

Each widget measures its own space and picks a presentation: a **strip** (thin and wide), **square**,
**wide** or **tall**, in a compact, regular or expanded size. Strips show the most important
information in one row; bigger widgets show more real items, details and controls. This never changes
saved settings — make a widget bigger again and its chosen view (for example the calendar's Month view)
comes back.

| Widget | How it adapts |
| --- | --- |
| **Freely adaptive** | |
| Title & heading | Strip: one line (subtitle beside it when wide); taller: larger heading and subtitle |
| Clock | Strip: time with the date beside it; larger: bigger time; other time zones also show local time |
| Date | Strip: one-line date; roomy: this month at a glance |
| Quote | Text size follows the space; very short widgets clamp to two lines |
| Daily focus | Strip: label beside the goal; taller: yesterday's focus and whether it was done |
| Countdown | Strip: title, days and date in a row; taller: your other upcoming countdowns (or exams) |
| Quick links | Strip: a row of app icons with "+N" for the rest; larger: labelled tiles |
| Assignments, Reminders, Upcoming | Strip: count, next items as pills, "+N" and add; wide: two columns |
| To-do list | Strip: open items as tickable pills plus quick add |
| Weekly timetable | Strip: the class on now and the next one; wide: today beside the next school day |
| Subjects & courses | Strip: subject pills with open-work counts; larger: cards with next due item |
| Quick capture | Taller: type buttons instead of the type menu (your typing is never interrupted) |
| Study timer | Strip: time, progress and controls in one row; wide: ring beside controls, sessions, presets |
| Study progress | Strip: today's focus and tasks against goals plus streak; larger: rings, week chart, week summary |
| Habit tracker | Strip: today's check-ins; wider: more days and a 30-day count; tall: a full week per habit |
| Note | Strip: just the text area (title stays in the header and notebook) |
| **Adaptive within limits** | |
| Calendar | Strip: this week with the selected day's items; tall: month plus day list. Google embed: hidden in a strip (with an "Open in Google Calendar" link), never reloaded by resizing |
| Flashcards | Strip: decks scroll sideways; taller: a grid of decks |
| Soundscape | Minimum height keeps the player and volume usable; wider: more ambience tiles per row |
| **Constrained** | |
| Calculator | 3–6 columns × 5–8 rows so every key stays usable; wide: recent results beside the keypad |
| Notebook | At least 4 × 5 so the editor and its tools stay usable |
| Grades & GPA | At least 4 × 4 so the class table stays editable |

Limits live in each widget's registry entry (`min`, `max`, `adapt`) and apply to dragging, keyboard
resizing, size presets and older saved layouts (which are adjusted to the nearest allowed size).
Games and full flashcard practice live in the Quiz tab, not on the dashboard, so their boards are
never distorted by widget resizing.

## Custom tabs

**Add tab** in the sidebar creates an empty dashboard with its own widgets and layout. Tabs use the
active theme's look; your notes, sets, assignments and events are shared by every tab, so deleting a
tab or widget never deletes content. Reorder tabs by dragging, with **Alt + ↑/↓**, or from a tab's
⋯ menu. Home (the active theme's dashboard) and Quiz are built in and can't be deleted.

## Add Google Calendar from the Calendar widget

1. Select **Google Calendar** on the Calendar widget.
2. Paste your Google email, Calendar ID, Google Calendar embed link, or embed code.
3. Optionally name the calendar, then select **Add calendar**.

The widget switches to your Google Calendar. Month, Week and Agenda controls still work. Select
**Tester calendar** to return to your local events, or the settings button to replace or remove the
linked calendar. Your choice is saved in this browser. The same linked calendar is available to
other Calendar widgets; each widget remembers which calendar view it displays.

To find a Calendar ID or embed link: open Google Calendar on a computer, select **Settings**, then
your calendar under **Settings for my calendars**, then **Integrate calendar**. Copy **Calendar ID**,
**Public URL to this calendar**, or **Embed code**. Google email works for your primary calendar.
Do not paste a secret iCal address.

Google controls access to the embedded calendar. For a private calendar, sign in to an account that
can view it. If your browser blocks it, use **Open in Google Calendar**, sign in, and reload Tester.
You do not need to make a private calendar public. Internet access is required for this view.
Your calendar ID is saved locally; loading the embedded view connects this browser to Google.
Embedded Google events appear in their own view; your local Tester events remain in the Tester view.

Google's embedding help: https://support.google.com/calendar/answer/41207?hl=en

### Optional: merge Google events into the Tester calendar

The secondary **Merge events with Tester** section offers the original read-only Google account
connection. Once the host configures it, users sign in and pick calendars; their Google events appear
beside local events in Tester's Month, Week and Agenda views. This option needs the one-time host
setup below. The paste-a-link option above needs no Google Cloud project or client ID.

How it works: Google Identity Services' **token model** signs you in from the browser — no server and
no client secret. Tester asks for the two narrowest read-only permissions:

* `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — see the list of your calendars
* `https://www.googleapis.com/auth/calendar.events.readonly` — view events on your calendars

The access token stays in memory for the open tab only (never saved, backed up or logged); after a
reload, **Refresh** signs in again. Your calendar choices and a copy of fetched events are kept in
the browser (separate from your own events, never in backups) so they still show offline.
**Disconnect** revokes the token and deletes that copy.

### Setup (once, by whoever hosts this copy of Tester)

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. **APIs & Services → Library**: enable the **Google Calendar API**.
3. Configure the **OAuth consent screen** (Google Auth Platform): app name, support email, and
   audience. While the app is in *Testing*, add the Google accounts that will use it as test users.
   Under data access, add the two scopes listed above.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorized
   JavaScript origins** add every address Tester is served from, e.g. `http://localhost:8000` and
   `https://yourname.github.io`. No redirect URI is needed for this sign-in method.
5. Copy the **client ID** (it ends in `.apps.googleusercontent.com`) into `config.js`:
   ```js
   window.TESTER_CONFIG = { googleClientId: '1234567890-abc.apps.googleusercontent.com' };
   ```
   For a quick personal test you can instead paste it under Google Calendar → *Advanced* in the app
   (saved in that browser only). Never put a client secret anywhere in Tester.
6. In Tester: Calendar widget → **Google Calendar** → **Merge events with Tester** →
   **Connect Google Calendar**, pick calendars, done. Use the **G** button on the calendar to refresh.

Notes and limits: Google may require app verification before accounts other than your test users
can connect; access tokens last about an hour, after which Refresh asks Google again (a pop-up —
allow pop-ups for the site); Google events appear in the Calendar widget (month, week, agenda), not
in the Upcoming or Assignments widgets; events are fetched for the dates the calendar is showing.

## Your data

Everything is stored in this browser (IndexedDB, with a localStorage fallback). **Customize → Data**
downloads a complete backup (themes, custom tabs and sidebar order, widgets, notes, assignments,
events, study sets, game boards, wins, game and quiz settings, profile, photos) and restores it
(merge or replace, checked before anything changes). Backups never include Google access or the copy
of Google events.

Upgrading from an earlier version is automatic. Block Puzzle replaced Tetris: unused Tetris moves
carry over to Block Puzzle, your Tetris colours, board colour, grid and corner choices and target size
carry over, and Tetris wins stay on record (they count in your total wins and are noted in Games &
wins). The unfinished Tetris board itself can't be converted and is dropped.

Upgrading from the first version also converts the old reward record
(`studyspace-play-v1` in localStorage) into the new study & play state — unused turns become
moves, wins, boards, game settings and profile looks are kept — and the old copy is removed only
after the new one is confirmed saved. Points, the reward shop, the study arcade and the trophy
cabinet were removed; their widgets disappear from layouts and old backups don't bring them back.
The "Quiz & game lab" widget becomes the Flashcards widget.

## Tests

```sh
npm install playwright   # once, if it isn't available yet
npx playwright install chromium
node tests/run-tests.js            # all checks
node tests/run-tests.js chess      # only tests whose name matches
```

The suite serves the folder itself and drives the real app in Chromium: the learning gate, keyboard
isolation, all four games (including chess against real Stockfish, the nine levels, stale-reply handling
and the fallback bot; Block Puzzle dragging with the outline preview, line clears and wins), set
management and import/export, custom tabs, migration of old saves (including Tetris → Block Puzzle),
backup round trips, Google Calendar with local fixtures (not Google's real servers), corner resizing
(both corners, limits, locks, collisions, Escape, undo/redo, reload, grid and canvas), adaptive widget
shapes and state kept while resizing, and layouts at desktop, tablet and phone widths.

## Licences

Tester's own code is the project's. Third-party components and their licences are listed in
`THIRD-PARTY-NOTICES.txt`; Stockfish (GPLv3) ships with its corresponding source in
`vendor/STOCKFISH-SOURCE.tar.gz`.
