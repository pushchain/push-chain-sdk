# Preset funding option removal — 20 October 2026

The user requested removal of the public `funding` extension, which is not in the target SDK specification. This supersedes the destination-mode advice in the earlier creation-error review.

## Behavior

- `presets.get` retains all selected assets and their caps. There is no mode that silently empties rule assets.
- The input option and readiness funding field are removed. JavaScript callers still passing the option receive `INVALID_RULE` with migration guidance rather than silently changing their permissions.
- Missing mappings remain `BRIDGE_ASSET_UNAVAILABLE` in readiness and `TOKEN_ROUTE_UNAVAILABLE` during preparation. Error guidance no longer recommends the removed option.
- Existing integrations omitting the option need no call-shape change. They must respect readiness; this change does not enable missing routes.
- Local and live protocol tests use explicitly labeled prefunded fixtures where bridge assets are cleared. They do not establish default-preset bridge acceptance.

## Route work required

For each unsupported exact chain/token address, the core/gateway team must confirm an existing compatible PRC20 route or deploy/register the missing route. Verify source chain, source address and decimals, along with the route configuration required for actual outbound delivery. The SDK can then register the verified mapping and test rule creation and bounded destination delivery. Existing supported assets are alternatives only if the target protocol actually supports those exact assets. A shared symbol is insufficient.

This change did not re-audit current deployments or perform transactions. Previously reported blockers include Aave faucet LINK, Circle testnet USDC variants, EigenLayer Sepolia WETH and Arbitrum WETH. Sepolia DEX WETH has a registry mapping already; not every WETH address is interchangeable.

## Validation

- 54 focused unit regressions passed.
- 21 real-contract local tests passed, with a stub gateway.
- Core build, spec and local-harness typechecks passed.
- Package imports/declarations/content checks and seven guide examples passed.
- No live transactions, publishing, commits or pushes performed for this change.
