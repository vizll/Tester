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
xcodebuild -project Tester.xcodeproj -scheme Tester -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build | { command -v xcpretty >/dev/null && xcpretty || cat; }

APP="build/Build/Products/Release-iphoneos/Tester.app"
[ -d "$APP" ] || { echo "Build failed: $APP not found" >&2; exit 1; }

echo "• Packaging Tester.ipa"
rm -rf Payload && mkdir Payload && cp -R "$APP" Payload/
mkdir -p "$OUT"
rm -f "$OUT/Tester.ipa"
zip -qry "$OUT/Tester.ipa" Payload
rm -rf Payload
echo "Done: $OUT/Tester.ipa — open SideStore → My Apps → + and choose it."
