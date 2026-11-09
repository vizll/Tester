#!/usr/bin/env bash
# Builds an unsigned Tester.ipa for sideloading with SideStore or AltStore (they sign it with your
# Apple ID). Needs a Mac with Xcode 15+ and XcodeGen (`brew install xcodegen`).
#   cd "Tester 3.0/apps/ios" && ./build-ipa.sh
# Output: Tester 3.0/apps/release/Tester.ipa
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
OUT="$ROOT/apps/release"

if ! command -v xcodebuild >/dev/null; then echo "Xcode is required (App Store → Xcode, then open it once)." >&2; exit 1; fi
if ! command -v xcodegen >/dev/null; then
  if command -v brew >/dev/null; then brew install xcodegen; else echo "Install XcodeGen first: brew install xcodegen" >&2; exit 1; fi
fi

echo "• Copying the web app"
rm -rf www && mkdir www
rsync -a --exclude 'tests' --exclude 'README.md' --exclude '.DS_Store' "$ROOT/dist/" www/

echo "• Generating the Xcode project"
xcodegen generate --quiet

echo "• Building (unsigned)"
rm -rf build
if ! xcodebuild -project Tester.xcodeproj -scheme Tester -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build > build.log 2>&1; then
  # GitHub Actions shows these lines as annotations on the run
  grep -E "(error|fatal error):" build.log | sort -u | head -12 | while IFS= read -r line; do echo "::error::${line}"; done
  tail -60 build.log
  echo "Build failed (full log: apps/ios/build.log)" >&2
  exit 1
fi
grep -E "warning:" build.log | sort -u | head -5 || true

APP="build/Build/Products/Release-iphoneos/Tester.app"
[ -d "$APP" ] || { echo "Build failed: $APP not found" >&2; exit 1; }
[ -d "$APP/PlugIns/TesterWidgets.appex" ] || { echo "::error::Widget extension missing from the app" >&2; exit 1; }

# Ad-hoc signing only records the entitlements (the shared app group for widgets). SideStore and
# AltStore read them, register the group with your Apple ID and re-sign everything with it.
echo "• Recording entitlements"
codesign --force --sign - --timestamp=none --entitlements Widgets/TesterWidgets.entitlements "$APP/PlugIns/TesterWidgets.appex"
codesign --force --sign - --timestamp=none --entitlements Tester/Tester.entitlements "$APP"
codesign -d --entitlements - "$APP" 2>/dev/null | grep -q "application-groups" || echo "::warning::App group entitlement not found after signing"

echo "• Packaging Tester.ipa"
rm -rf Payload && mkdir Payload && cp -R "$APP" Payload/
mkdir -p "$OUT"
rm -f "$OUT/Tester.ipa"
zip -qry "$OUT/Tester.ipa" Payload
rm -rf Payload
echo "Done: $OUT/Tester.ipa — open SideStore → My Apps → + and choose it."
