#!/bin/bash

set -e

SCOPE=$1
BUMP=$2
ALPHA=$3  # "true" or "false"

echo "🤖 AUTOMATED RELEASE"
echo "SCOPE: ${SCOPE}"
echo "BUMP: ${BUMP}"
echo "ALPHA: ${ALPHA}"

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

# Determine semver bump type for alpha
if [[ "$ALPHA" == "true" ]]; then
  CURRENT_VERSION=$(node -p "require('./packages/$SCOPE/package.json').version")
  IS_ALREADY_ALPHA=$(echo "$CURRENT_VERSION" | grep -c "alpha" || true)

  if [[ "$IS_ALREADY_ALPHA" -eq 1 && "$BUMP" == "patch" ]]; then
    BUMP_TYPE="prerelease"
  else
    BUMP_TYPE="pre${BUMP}"
  fi
  PREID="alpha"
  echo "🚀 Releasing @$SCOPE with a $BUMP_TYPE (alpha) bump..."
  npx ts-node scripts/bumpAndGenerateChangelog.ts "$SCOPE" "$BUMP_TYPE" "$PREID"
else
  echo "🚀 Releasing @$SCOPE with a $BUMP bump..."
  npx ts-node scripts/bumpAndGenerateChangelog.ts "$SCOPE" "$BUMP"
fi

# Step 2: Build the package
npx nx run "$SCOPE:build"

# Step 3: Copy package.json to dist directory for publishing
PACKAGE_DIR="dist/packages/$SCOPE"
PACKAGE_NAME=$(node -p "require('./packages/$SCOPE/package.json').name")
VERSION=$(node -p "require('./packages/$SCOPE/package.json').version")

# Copy the updated package.json to the dist directory
cp "packages/$SCOPE/package.json" "$PACKAGE_DIR/package.json"

# Copy README if it exists
if [ -f "packages/$SCOPE/README.md" ]; then
  cp "packages/$SCOPE/README.md" "$PACKAGE_DIR/README.md"
fi

# Step 4: Publish to npm (using automation token, no OTP needed)
echo "📦 Publishing $PACKAGE_NAME@$VERSION to NPM..."
if [[ "$ALPHA" == "true" ]]; then
  npm publish "$PACKAGE_DIR" --access public --provenance --tag alpha
else
  npm publish "$PACKAGE_DIR" --access public --provenance
fi

# Step 5: Commit version + changelog
git add "packages/$SCOPE/package.json" "packages/$SCOPE/CHANGELOG.md"
git commit -m "release($SCOPE): bump to $VERSION [skip ci]"

# Step 6: Git tag + push
TAG="$SCOPE@$VERSION"
git tag "$TAG"
git push origin HEAD    # ✅ Push the actual commit
git push origin "$TAG"  # ✅ Push the tag

echo "✅ Automated release complete: $TAG"
echo "🎉 Package published to NPM: https://www.npmjs.com/package/$PACKAGE_NAME" 