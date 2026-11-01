# Creation guidance after alpha.4 feedback

Implemented actionable missing-function validation (`INVALID_RULE`, reason `ALLOWED_FUNCTION_REQUIRED`), clearer empty-asset preset readiness, and exact-token/protocol compatibility guidance for unavailable routes. Assets and limits are never silently replaced or broadened.

All nine testnet preset/network combinations have regression coverage for unavailable route reporting and preserved assets. Missing/empty functions fail before signing. Empty universal assets retain zero Push token-export authority; existing local v6 contract coverage demonstrates the zero-cap gas-token representation. No fresh live transactions were run for this copy/validation change.

Remaining: route addresses/provisioning from the core/node/gateway team; verified protocol-compatible alternatives before changing preset defaults; product agreement on recipients/limits before any transfer-only helper. No unrestricted-token wildcard is introduced.

Validation: 402 AGW unit tests passed across 25 suites; core build, spec typecheck, package checks and seven guide example typechecks passed. SDK edits sync to v5 without this plan file. npm publication is user-managed.
