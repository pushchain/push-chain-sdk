# Automated Publishing Setup

This document explains how to set up automated publishing of the `@pushchain/core` SDK package to NPM whenever code is pushed to the main branch.

## 🚀 How It Works

The GitHub Action workflow (`.github/workflows/auto-publish-core.yml`) automatically:

1. **Detects changes** to the core package (`packages/core/**`)
2. **Determines version bump type** from conventional commit messages
3. **Builds and publishes** the package to NPM
4. **Creates GitHub releases** with changelog notes
5. **Commits and tags** the new version

## 📋 Setup Requirements

### 1. NPM Automation Token

You need to create an NPM automation token that bypasses 2FA:

1. Go to [npmjs.com](https://www.npmjs.com) and log in
2. Click on your profile → "Access Tokens"
3. Click "Generate New Token" → "Automation"
4. Copy the token (starts with `npm_`)

### 2. GitHub Repository Secrets

Add the following secrets to your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

- **Name**: `NPM_TOKEN`
- **Value**: Your NPM automation token from step 1

The `GITHUB_TOKEN` is automatically provided by GitHub Actions.

### 3. NPM Package Permissions

Ensure your NPM account has publish permissions for the `@pushchain` organization/scope.

## 🔄 Version Bump Logic

The automation uses conventional commit messages to determine the version bump:

| Commit Message Pattern | Version Bump | Example |
|------------------------|-------------|---------|
| `feat!:` or `BREAKING CHANGE:` | **major** | `feat!: new API breaking changes` |
| `feat:` or `feature:` | **minor** | `feat: add new authentication method` |
| `fix:`, `patch:`, `chore:`, etc. | **patch** | `fix: resolve memory leak issue` |
| Any other format | **patch** | `update documentation` |

## 🎯 Triggering the Automation

The workflow triggers automatically when:

- ✅ Code is pushed to the `main` branch
- ✅ Changes are detected in `packages/core/src/**`, `packages/core/package.json`, etc.
- ❌ Only changes to `CHANGELOG.md` or `README.md` won't trigger

### Manual Trigger Examples

To manually trigger different version bumps, use conventional commits:

```bash
# Patch release (0.1.41 → 0.1.42)
git commit -m "fix: resolve authentication timeout issue"

# Minor release (0.1.41 → 0.2.0)  
git commit -m "feat: add support for new blockchain networks"

# Major release (0.1.41 → 1.0.0)
git commit -m "feat!: redesign API with breaking changes"
```

## 🔍 Monitoring Releases

### GitHub Actions
- Go to your repository → "Actions" tab
- Look for "Auto Publish Core SDK" workflows
- Check logs for any failures

### NPM Releases
- Visit: https://www.npmjs.com/package/@pushchain/core
- Check the "Versions" tab for latest releases

### GitHub Releases
- Go to your repository → "Releases" tab
- Each automated release creates a GitHub release with changelog

## 🛠️ Manual Publishing (Fallback)

If you need to publish manually:

```bash
# Using the original script (requires 2FA)
nx run core:nx-release-publish --bump=patch --otp=123456

# Using the automated script (no 2FA)
bash scripts/release-automated.sh core patch
```

## 🚫 Skipping Automation

To push changes without triggering a release, include `[skip ci]` in your commit message:

```bash
git commit -m "docs: update README [skip ci]"
```

## 🔧 Troubleshooting

### Common Issues

1. **NPM Token Expired**: Regenerate the automation token in NPM
2. **Permission Denied**: Ensure your NPM account has publish rights
3. **Build Failures**: Check the Nx build configuration in `packages/core/project.json`
4. **Git Push Failures**: Ensure the GitHub token has write permissions

### Workflow Logs

Check the GitHub Actions logs for detailed error messages:
1. Go to repository → Actions
2. Click on the failed workflow
3. Expand the failing step to see logs

## 📝 Customization

### Changing the Version Bump Logic

Edit the "Determine version bump type" step in `.github/workflows/auto-publish-core.yml` to modify the conventional commit patterns.

### Adding More Packages

To add automated publishing for other packages:
1. Update `ALLOWED_SCOPES` in `scripts/release-automated.sh`
2. Modify the workflow paths filter
3. Add the package mapping in `scripts/bumpAndGenerateChangelog.ts`

### Disabling Automation

To temporarily disable automated publishing:
1. Comment out or delete the workflow file
2. Or add a condition like `if: false` to the publish job 