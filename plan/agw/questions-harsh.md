# AGW preset limit semantics — remaining product clarification

Updated October 16, 2026. Local draft; nothing sent.

## What should the UI's spending limits mean?

Current contracts enforce two different scopes:

- An operation amount maximum applies to each allowed call. A batch can contain several calls, each within that maximum.
- Asset maxTotal counts tokens sent from Push. It does not count repeated swaps/lending/staking using assets already in the destination CEA.

Should the product require a combined limit across destination calls in one transaction, or a cumulative destination-spend limit? Either requires contract accounting beyond the current limits. Until then, the UI should label the implemented scopes explicitly and must not describe maxTotal as a lifetime trading budget.

## SDK delivery and documentation synchronization

The SDK now generates token/amount restrictions for supported lending/staking calls and returns readiness, disabled/excluded call reasons and known token choices. The wallet UI must collect inputs, call presets.get again when they change, and pass the regenerated rule to rules.update. Missing caps remain zero; the SDK supplies no 0.1 PC or 30-day defaults.

Share-based redeem uses the bounded redeemUnderlying alternative. Dynamic/position-derived withdrawals are excluded from bounded presets. No answer is required to continue the implemented scope; the question above determines whether a larger contract change is wanted.

[Implementation and evidence](research/preset-configuration-2026-10-16/README.md).
