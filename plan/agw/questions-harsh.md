# AGW SDK — questions for Harsh

Updated October 6, 2026. Please reply by question ID. These are the remaining product/API decisions.

<a id="h3"></a>

## H3. Native defaults and token model

**1. Should omitted native PC limits mean unlimited?**

| Field | Proposed default | Current SDK |
| --- | --- | --- |
| `maxValuePerCall` | `maxUint256` (unlimited) | `0`, provisional |
| `maxValueTotal` | `maxUint256` (unlimited) | `0`, provisional |

Explicit `0` would still forbid value movement. We retain `maxValueTotal`, which is still in the SDK spec.

**2. Does your “tokens independent” comment mean the current `assets[]` model should stay?**

The delivered model has independent limits per token; each listed token can be used with every allowed call. If you intended a different SDK input model, please provide one example.

<a id="h4-4"></a>

## H4.4. Public Solana rules — with Zaryab

**Should public Solana rules use IDL-based authoring, or explicit raw constraints?**

Our proposal is a Solana-specific `Rule` with instruction/account/field inputs compiled from an IDL. The SDK derives the gateway, wallet CEA and protected token accounts internally. Decoded records preserve the exact stored constraints.

The alternative is to let callers author explicit program, account-pin and data-pin constraints. Please agree on the input/read model together. [Proposed types and examples](public-api-proposals.md#h44-solana-rule-inputs-and-decoded-records).

<a id="h4-5"></a>

## H4.5. Argument indexes versus raw offsets

**May callers use both ABI argument indexes and raw byte offsets, or should authoring and decoded records have separate types?**

This covers native pins/amount limits and EVM `beneficiaryOffset`. Contracts store offsets without an ABI, so reads cannot reliably recover argument indexes.

**Recommendation:** keep the tested dual input form and exact raw-offset reads. If public authoring must be ABI-only, we will separate decoded records. [Options and examples](public-api-proposals.md#h45-nativeevm-raw-authoring-and-decoding).

<a id="h6"></a>

## H6. Selecting among multiple rules

**Can we add explicit per-send rule selection, or do you want an automatic strategy?**

**Proposal:** optional `rulesId` for one action/outbound; ordered `rulesIds` for a native batch using different rules. An EVM destination call array uses one rule for the entire outbound.

Today, multiple matching rules produce `AMBIGUOUS_RULE` before signing. If you prefer automatic selection, please define how overlapping rules are chosen. [Proposed options and examples](public-api-proposals.md#h6-rule-selection-for-sends).

[SDK spec](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) · [Questions for Zaryab](questions-zaryab.md)
