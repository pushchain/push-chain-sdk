# Publish dependency-install correction — October 15, 2026

Failed job: https://github.com/pushchain/push-chain-sdk/actions/runs/38673825795/job/116222785501, at feat/agw-sdk-v5@574a4002.

The install failed with YN0028. Release commit 6eafa004 changed core 6.0.26 to 6.0.27-alpha.0 without refreshing yarn.lock. UI kit's ^6.0.26 no longer matches the local prerelease. Yarn needs a separate npm 6.0.26 resolution alongside the workspace entry; immutable installation correctly rejected the stale combined entry.

## Changes

- Regenerated v5 yarn.lock using pinned Yarn 4.2.2, install --mode=update-lockfile. Exactly one entry split; existing workspace/package versions preserved.
- Both release scripts now deliberately refresh the lockfile after version bumps, before building/publishing, and stage yarn.lock in their release commit.
- The workflow's initial immutable check stays enabled. No workflow dispatch or real package publication was performed.
- V4 stays on core 6.0.26, so its existing lockfile remains correct. The lockfiles intentionally differ between branches, just like the existing release version/changelog.

## Validation

- Bash syntax checks passed for both scripts.
- A copy of v5's root and workspace manifests, lockfile and Yarn configuration passed install --immutable --mode=skip-build in a temporary node-modules workspace. Lifecycle scripts were disabled and no existing workspace node_modules was changed. Local Node 20.19.2/Yarn 4.2.2; CI uses Node 24.18.0/Yarn 4.2.2.
- An isolated miniature workspace reproduced YN0028 with the original automated release script on stable-to-alpha transition.
- The corrected automated script passed stable-to-alpha and alpha-to-alpha transitions. The fixture used real Yarn/semver and verified immutable consistency at the simulated publish boundary and yarn.lock staging. npm publish and every git operation were intercepted; no real package, tag or push was produced by the test.
- The scripts' real publish commands were not executed. The user will trigger the action.
