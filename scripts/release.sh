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

# Step 1: Bump version and generate .changeset markdown
ts-node scripts/bumpAndGenerateChaneglog.ts "$SCOPE" "$BUMP"

# Step 2: Build the package
nx run "$SCOPE:build"

# Step 3: Publish to npm
PACKAGE_DIR="dist/packages/$SCOPE"
PACKAGE_NAME=$(node -p "require('./packages/$SCOPE/package.json').name")
VERSION=$(node -p "require('./packages/$SCOPE/package.json').version")

npm publish "$PACKAGE_DIR" --access public --otp="$OTP"

# Step 4: Git tag + push
TAG="$SCOPE@$VERSION"
git tag "$TAG"
git push origin "$TAG"

# Step 5: GitHub release using changelog as body
CHANGELOG_FILE=".changeset/$SCOPE.md"

if [ ! -f "$CHANGELOG_FILE" ]; then
  echo "⚠️ No changelog file found for $SCOPE"
  exit 1
fi

gh release create "$TAG" --title "$TAG" --notes-file "$CHANGELOG_FILE"

echo "✅ Release complete: $TAG"
