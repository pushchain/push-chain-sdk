#!/bin/bash

set -e

SCOPE="core"

echo ""
echo "=== Publish @pushchain/core ==="
echo ""

CURRENT_VERSION=$(node -p "require('./packages/$SCOPE/package.json').version")
echo "Current version: $CURRENT_VERSION"
echo ""

# --- 1. Bump type ---
echo "Select bump type:"
echo "  1) patch"
echo "  2) minor"
echo "  3) major"
read -rp "Choice [1/2/3]: " BUMP_CHOICE

case "$BUMP_CHOICE" in
  1) BASE_BUMP="patch" ;;
  2) BASE_BUMP="minor" ;;
  3) BASE_BUMP="major" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

# --- 2. Alpha? ---
read -rp "Alpha release? [y/N]: " ALPHA_CHOICE

IS_ALPHA=$(echo "$CURRENT_VERSION" | grep -c "alpha" || true)

if [[ "$ALPHA_CHOICE" =~ ^[Yy]$ ]]; then
  PREID="alpha"
  if [[ "$IS_ALPHA" -eq 1 && "$BASE_BUMP" == "patch" ]]; then
    # Already on alpha, just increment: 5.1.4-alpha.2 -> 5.1.4-alpha.3
    BUMP_TYPE="prerelease"
  else
    # New alpha: patch -> prepatch, minor -> preminor, major -> premajor
    BUMP_TYPE="pre${BASE_BUMP}"
  fi
else
  PREID=""
  BUMP_TYPE="$BASE_BUMP"
fi

# --- 3. Preview version ---
if [ -n "$PREID" ]; then
  PREVIEW_VERSION=$(node -e "const s=require('semver'); console.log(s.inc('$CURRENT_VERSION','$BUMP_TYPE','$PREID'))")
else
  PREVIEW_VERSION=$(node -e "const s=require('semver'); console.log(s.inc('$CURRENT_VERSION','$BUMP_TYPE'))")
fi

echo ""
echo "  $CURRENT_VERSION -> $PREVIEW_VERSION"
echo ""
read -rp "Proceed? [Y/n]: " CONFIRM
if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
  echo "Aborted."
  exit 0
fi

# --- 4. OTP ---
read -rp "NPM OTP: " OTP
if [ -z "$OTP" ]; then
  echo "OTP is required."
  exit 1
fi

echo ""
echo "Publishing @pushchain/core@$PREVIEW_VERSION ..."
echo ""

# --- 5. Bump version + changelog ---
if [ -n "$PREID" ]; then
  npx ts-node scripts/bumpAndGenerateChangelog.ts "$SCOPE" "$BUMP_TYPE" "$PREID"
else
  npx ts-node scripts/bumpAndGenerateChangelog.ts "$SCOPE" "$BUMP_TYPE"
fi

# --- 6. Build ---
npx nx run "$SCOPE:build"

# --- 7. Copy package.json + README to dist ---
PACKAGE_DIR="dist/packages/$SCOPE"
VERSION=$(node -p "require('./packages/$SCOPE/package.json').version")

cp "packages/$SCOPE/package.json" "$PACKAGE_DIR/package.json"
if [ -f "packages/$SCOPE/README.md" ]; then
  cp "packages/$SCOPE/README.md" "$PACKAGE_DIR/README.md"
fi

# --- 8. Publish ---
npm publish "$PACKAGE_DIR" --access public --otp="$OTP"

# --- 9. Commit + tag + push ---
git add "packages/$SCOPE/package.json" "packages/$SCOPE/CHANGELOG.md"
git commit -m "release($SCOPE): bump to $VERSION"

TAG="$SCOPE@$VERSION"
git tag "$TAG"
git push origin HEAD
git push origin "$TAG"

echo ""
echo "Done! Published @pushchain/core@$VERSION"
echo "https://www.npmjs.com/package/@pushchain/core"
