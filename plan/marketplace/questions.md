# Marketplace — remaining contract question

## Bind every rule before enabling multi-chain job execution

Marketplace 2.1 allows four rules per card. The current UniversalHook still accepts `(bytes32 rulesId, bytes32 expectedSpecHash, bytes newSpec)` and binds only one permission.

**Please share the upgraded hook ABI, source commit and deployment that checks and binds every job rule. Confirm how rule revocation and terminal-job cleanup are intended to work.**

The SDK allows multi-rule card authoring, registration and previews, but gates multi-rule job opening and funding until this is supported. Raising `maxRulesPerCard` does not satisfy this requirement.

Resolved by the October 30 deployment: timing-free PRE/POST format, COMPARE leaf naming, duration-based cards, eUSD kernel payment token and compatible marketplace/evaluator addresses. No PUSD redemption exception is implemented.
