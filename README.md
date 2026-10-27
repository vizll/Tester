# Tester

A Notion-style study workspace you can customize to your heart's content: widgets, themes, notes,
assignments, calendars, flashcards, quizzes and a few games — saved privately in your browser.

## Run it

Tester is a static site (HTML, CSS and JavaScript — no build step, no server code). Serve the folder
over HTTP so the chess engine's Web Worker and WebAssembly file can load:

```sh
cd Tester
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
| `nav.js` / `nav.css` | Sidebar: profile, Home, Quiz and your own tabs (add, rename, icon, reorder, delete, resize, collapse) |
| `quiz-plus.js` / `quiz-plus.css` | The Quiz tab: study sets, import/export, flashcards, quiz + game sessions, games & wins, settings |
| `study-plus.js` / `study-plus.css` | Study & play state: the learning gate, game boards and preferences, wins, profile |
| `chess.js` / `chess.css` | Chess against Stockfish (worker lifecycle, built-in fallback bot) |
| `arcade-games.js` / `arcade-games.css` | Solitaire, 2048 and turn-based Tetris |
| `gcal.js` / `gcal.css` | Optional read-only Google Calendar sync |
| `config.js` | Public configuration (the Google OAuth client ID) |
| `vendor/` | chess.js rules library, Stockfish worker + WASM, their licences and Stockfish's corresponding source |
| `tests/run-tests.js` | Automated browser checks (Playwright) |

## How studying and playing fit together

* Open **Quiz** in the sidebar. **Study sets** holds your flashcard sets: search them, filter by
  subject, create, edit (add, edit, reorder and remove cards), duplicate, export or delete.
* **Quiz & play** puts the questions on the left and your chosen game docked on the right. Every
  **3 correctly checked answers unlock 3 moves** in the selected game (change the numbers in Quiz →
  Settings). Wrong answers, flipping flashcards and marking your own answers don't count, and each
  question counts once.
* Moves are spent only by real plays: a legal chess move (the bot's reply is free), a 2048 slide that
  changes the board, a legal Solitaire move/draw/recycle, or a locked Tetris piece. Illegal or no-op
  inputs are free.
* Drag the divider (or focus it and use ←/→) to resize the game, hide it with the eye button, or on
  narrow screens switch between **Questions** and **Game**. Keys only reach the game while focus is
  inside the game panel.
* **Games & wins** shows wins (counted once per finished game) and every game's look and gameplay
  settings with a live preview. The palette button on the game panel opens the same settings.

### Importing from Quizlet

Tester imports text, not accounts or links. In Quizlet, open a set → **⋯ → Export**, copy the text
(term, Tab, definition — one card per line) and paste it into **Import** in the Quiz tab. CSV/TSV
files, quoted fields, header rows and custom separators work too; lines that can't be read are listed
and nothing is imported until they're fixed. **Export for Quizlet** saves a set as tab-separated text
that Quizlet's own Import accepts.

## Custom tabs

**Add tab** in the sidebar creates an empty dashboard with its own widgets and layout. Tabs use the
active theme's look; your notes, sets, assignments and events are shared by every tab, so deleting a
tab or widget never deletes content. Reorder tabs by dragging, with **Alt + ↑/↓**, or from a tab's
⋯ menu. Home (the active theme's dashboard) and Quiz are built in and can't be deleted.

## Google Calendar (optional, read-only)

Tester can show events from the Google calendars you choose next to your own events in the Calendar
widget. It only reads: it never creates, changes or deletes anything in Google Calendar.

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
6. In Tester: Calendar widget ⋯ → **Google Calendar settings…** (or ⋮ → Google Calendar…) →
   **Connect**, pick calendars, done. Use the **G** button on the calendar to refresh.

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

Upgrading from an earlier version is automatic and runs once: the old reward record
(`studyspace-play-v1` in localStorage) becomes the new study & play state — unused turns become
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
isolation, all four games (including chess against real Stockfish, stale-reply handling and the
fallback bot), set management and import/export, custom tabs, migration of an old save, backup round
trips, Google Calendar with local fixtures (not Google's real servers), and layouts at desktop,
tablet and phone widths.

## Licences

Tester's own code is the project's. Third-party components and their licences are listed in
`THIRD-PARTY-NOTICES.txt`; Stockfish (GPLv3) ships with its corresponding source in
`vendor/STOCKFISH-SOURCE.tar.gz`.
