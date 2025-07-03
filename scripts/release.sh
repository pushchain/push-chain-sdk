#!/bin/bash

set -e

SCOPE=$1
BUMP=$2
OTP=$3

echo "SCOPE: ${SCOPE}"
echo "BUMP: ${BUMP}"
echo "OTP: ${OTP}"

ALLOWED_SCOPES=("core" "ui-kit")
ALLOWED_BUMPS=("patch" "minor" "major")

# Validate scope
if [[ ! " ${ALLOWED_SCOPES[*]} " =~ " ${SCOPE} " ]]; then
  echo "❌ Invalid scope: ${SCOPE}. Allowed: ${ALLOWED_SCOPES[*]}"
  exit 1
fi

# Validate bump
if [[ ! " ${ALLOWED_BUMPS[*]} " =~ " ${BUMP} " ]]; then
  echo "❌ Invalid bump type: ${BUMP}. Allowed: ${ALLOWED_BUMPS[*]}"
  exit 1
fi

# Validate OTP
if [ -z "$OTP" ]; then
  echo "❌ Missing OTP. Usage: ./scripts/release.sh <scope> <bump> <otp>"
  exit 1
fi

echo "🚀 Releasing @$SCOPE with a $BUMP bump..."

# Step 1: Bump version and generate changelog markdown
ts-node scripts/bumpAndGenerateChaneglog.ts "$SCOPE" "$BUMP"

# Step 2: Build the package
nx run "$SCOPE:build"

# Step 3: Publish to npm
PACKAGE_DIR="dist/packages/$SCOPE"
PACKAGE_NAME=$(node -p "require('./packages/$SCOPE/package.json').name")
VERSION=$(node -p "require('./packages/$SCOPE/package.json').version")

npm publish "$PACKAGE_DIR" --access public --otp="$OTP"

# Step 4: Commit version + changelog
git add "packages/$SCOPE/package.json" "packages/$SCOPE/CHANGELOG.md"
git commit -m "release($SCOPE): bump to $VERSION"

# Step 5: Git tag + push
TAG="$SCOPE@$VERSION"
git tag "$TAG"
git push origin HEAD    # ✅ Push the actual commit
git push origin "$TAG"  # ✅ Push the tag

# Step 6: GitHub release using changelog as body
CHANGELOG_FILE="packages/$SCOPE/CHANGELOG.md"

if [ ! -f "$CHANGELOG_FILE" ]; then
  echo "⚠️ No changelog file found for $SCOPE"
  exit 1
fi

# Extract only the latest changelog block (up to first ---)
LATEST_NOTES=$(awk '/^---$/ { exit } { print }' "$CHANGELOG_FILE")
gh release create "$TAG" --title "$TAG" --notes "$LATEST_NOTES"

echo "✅ Release complete: $TAG"
