# Tester apps — Mac, Windows and iPhone/iPad

Tester's web app (`../dist`) wrapped as real apps. Each app ships the whole web app inside it, works
offline, and keeps your data on the device. The same `dist` folder powers all three, so any change to
Tester shows up in every app the next time you build.

| Folder | App | Built with |
| --- | --- | --- |
| `desktop/` | **macOS** (`.dmg`, Apple Silicon + Intel) and **Windows** (installer + portable `.exe`) | Electron |
| `ios/` | **iPhone and iPad** (unsigned `.ipa` for SideStore / AltStore) | Swift + WKWebView |
| `icons/` | App icons (macOS `.icns`, Windows `.ico`, iOS 1024 px) | — |

## Easiest: let GitHub build all three (no Mac setup needed)

1. Put the whole `Tester 3.0` folder in a GitHub repository (private is fine). On github.com:
   **New repository** → **uploading an existing file** → drag the folder's contents in, including the
   hidden `.github` folder. (Or use GitHub Desktop.)
2. Open the repository's **Actions** tab → **Build apps** → **Run workflow**.
3. After about 10–15 minutes, open the finished run and download the artifacts:
   * **Tester-macOS** — `Tester-3.0.0-mac-arm64.dmg` (Apple Silicon) and `…-mac-x64.dmg` (Intel)
   * **Tester-Windows** — `Tester-3.0.0-windows-…-setup.exe` (installer) and `…-portable.exe`
   * **Tester-iOS** — `Tester.ipa`

Pushing a tag such as `v3.0.0` also publishes everything as a GitHub Release.

## Installing

**Mac** — open the `.dmg` and drag Tester to Applications. The app isn't notarized by Apple (that needs a
paid developer account), so the first time: right-click Tester → **Open** → **Open**. If macOS says the app
is damaged, run this once in Terminal, then open it normally:

```sh
xattr -cr /Applications/Tester.app
```

**Windows** — run the `setup.exe`. SmartScreen may warn about an unknown publisher: **More info → Run
anyway**. The portable `.exe` runs without installing.

**iPhone / iPad with SideStore** — get `Tester.ipa` onto the device (AirDrop it to Files, or download it in
Safari), then open **SideStore → My Apps → +** and choose `Tester.ipa`. SideStore signs it with your Apple
ID. With a free Apple ID, sideloaded apps must be refreshed every 7 days (SideStore does this in the
background) and you can have 3 sideloaded apps at once. AltStore works the same way.

## Building on your own Mac instead

Desktop (needs [Node.js](https://nodejs.org) 20+):

```sh
cd "Tester 3.0/apps/desktop"
npm install
npm start            # try it in a window
npm run dist:mac     # → apps/desktop/release/*.dmg
npm run dist:win     # → apps/desktop/release/*.exe (builds on a Mac too)
```

iOS (needs Xcode 15+ from the App Store, opened once):

```sh
brew install xcodegen
cd "Tester 3.0/apps/ios"
./build-ipa.sh       # → apps/release/Tester.ipa
```

## How the apps work

* **Your data stays on the device.** Each app serves Tester from inside itself on a private address
  (`tester://…`), so notes, assignments, themes and game progress persist between launches, exactly
  like in a browser. Data is not shared between the browser version and the apps, or between devices —
  use **Customize → Data → Download backup** in one and **Restore from backup** in another to move it.
* **Backups and exports**: on Mac/Windows a normal Save dialog appears; on iPhone/iPad the share sheet
  opens so you can save to Files, iCloud Drive or Google Drive.
* **Links** (Classroom, quick links, assignment links) open in your normal browser.
* **macOS**: the window uses a hidden title bar — drag the window by the top bar, and the traffic lights sit
  above the sidebar. Window size and position are remembered. **Help → Where is my data?** opens the app's
  data folder.
* **iPhone/iPad**: the gradient runs edge to edge behind the notch and home indicator, the status bar
  follows light or dark styles, and photos/files can be picked for backgrounds, covers and backup restore.

### iPhone widgets and hands-free to-dos (iOS 17+)

* **Widgets** — *Up Next* (what's due, late work first; Home and Lock Screen), *To-Do* (tick items off
  right on the widget, mic button to add by voice) and *Voice To-Do* (a one-tap mic). On iOS 18+ there's
  also a **Voice To-Do control** for Control Center, the Lock Screen and the Action button.
* **Voice To-Do** — opens Tester listening; say “Chem homework” (dates work: “due Friday”) and it's added
  when you pause. Speech is turned into text on the device when the iPhone supports it.
* **Action button**: Settings → Action Button → Shortcut → Tester → **Voice To-Do**.
  **Back Tap**: add Voice To-Do to your shortcuts in the Shortcuts app, then Settings → Accessibility →
  Touch → Back Tap → Double/Triple Tap → Voice To-Do. **Siri**: “Add a to-do in Tester”.
* To add without opening the app, build a shortcut with **Dictate Text → Add To-Do (Tester)**.
* The app and widgets share data through an app group. SideStore/AltStore register it when they sign
  the app; keep app extensions enabled when installing. Open Tester once after installing so the
  widgets have something to show. A free Apple ID uses one extra App ID for the widget extension.
* In the app: Customize → General → **iPhone extras**, or the mic in Quick add.

### Known limits

* **Google Calendar sign-in** (the optional read-only sync) only works in the browser version, because
  Google only allows sign-in from registered web addresses. Pasting a calendar's embed link still works.
* **Fonts** load from Google Fonts when online; offline the apps use the system font.
* **Chess engine on iOS**: if WebKit blocks the Stockfish worker inside the app, chess falls back to
  Tester's built-in bot automatically.
* The apps are unsigned. For App Store / notarized builds you need an Apple Developer account
  (and a Windows code-signing certificate); add the signing settings to `desktop/package.json` and the
  Xcode project then.
