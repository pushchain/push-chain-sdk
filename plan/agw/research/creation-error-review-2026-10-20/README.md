# Agentic creation error review — October 20, 2026

Scope: the three reported creation screenshots, the shared create/add/update rule preparation paths, and UI presentation of typed SDK and decoded contract failures. This report records validation of the v4 changes. Subsequent Git delivery is tracked in the [SDK development history](../../../SDK-CHANGELOG.md); package publication remains separate.

The npm alpha tag at inspection was 6.0.27-alpha.3. Its release commit changes version metadata over the reviewed preset implementation. The actual version installed in the UI and its create payload have not yet been supplied. No UI implementation was found in this SDK's UI packages or a matching sibling checkout.

## Findings

| Report | Confirmed behavior | Fix / remaining action |
| --- | --- | --- |
| Lending: Unable to infer origin chain or token symbol | The stock Sepolia Aave preset selects faucet LINK (0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5). It has no matching current SDK Push transfer route. Generic resolver Error escaped shared preparation. | TOKEN_ROUTE_UNAVAILABLE now explains the limitation and funding choice, preserves the original cause and includes ruleIndex, assetIndex, token, chainNamespace and field. It does not invent a mapping or silently remove authority. |
| Staking: same resolver error | The Sepolia EigenLayer preset selects WETH 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9. This differs from the DEX WETH 0xfff9976782d46cc05630d1f6ebab18b2324d6b14 whose Push mapping was fixed previously. | Same typed handling applies, including Solana source-token resolution. Existing typed mismatch errors keep their classification. |
| DEX: at most 32 pins | An untouched two-token, one-router preset has 6 allowed-call entries and 20 input conditions. The guard is per rule, not summed across independent chain rules. Duplicating its call list produces 12 entries / 40 conditions and reproduces the same failure class. | Error now reports full actual count, maximum 32, callCount, ruleIndex and chainNamespace. Actual UI trigger remains unconfirmed pending the exact payload. No deduplication, condition removal, auto-splitting or contract-limit change is applied. |
| Other vague validation/revert text | Technical ABI, capability and provider wording was also the only available display text in many typed failures. | Both AgenticError and AgenticRevertError now expose userMessage. All 26 SDK codes have safe copy. Common decoded contract failures are grouped; remaining names use a safe fallback while retaining decodedError/cause. |
| Destination lookup / malformed addresses | Destination lookup could leak raw RPC failures; invalid agent/app/token addresses could leak conversion details. | Destination lookup failures are typed read failures, not token-route failures. Unsupported destination factories remain capability failures. Address errors carry field context. |
| User cancellation / receipt ambiguity | A cancelled request and an unconfirmed submitted transaction need different next steps. | REQUEST_REJECTED is explicit. Receipt uncertainty keeps transaction hashes and tells the user to check status before retrying; no automatic resend is added. |

## UI handoff

1. Render error.userMessage for AgenticError/AgenticRevertError. Keep message, code, hint, details, decodedError and cause for diagnostics or translation. Unknown exceptions get neutral fallback text instead of raw RPC output. The consumer guide has a typechecked renderer.
2. Highlight details.ruleIndex (zero-based), and assetIndex/callIndex/field when supplied. UI copy uses one-based rule numbering.
3. For destination-funded execution, regenerate with funding: 'destination', check readiness.ready, then pass returned rules unchanged into create. selectedAssets is display metadata and must not be copied back to rule.assets. The wallet can be created before funding; balances are needed before execution.
4. For bridge-funded rules, choose genuinely supported source assets. Changing a symbol or substituting a same-symbol token does not establish a valid route.
5. For DEX edits, regenerate rather than append generated allowedCalls. Preserve separate rules for separate networks. Do not merge distinct permission alternatives merely because their function names match.
6. Show the actual network, including testnet name. In destination mode, maxTotal in selectedAssets is not an enforced destination lifetime cap; the rule grants no Push token-export budget. Label the PC field as a maximum gas budget, not an actual fee.

## Error inventory and compatibility

error-copy.json inventories 26 typed SDK codes and 181 ABI error names with their UI text. Common revert classes distinguish gas/spend limits, allowance versus balance, expired approval versus expired rule, authorization and oversized configurations. Infrastructure/unknown decoded names retain a neutral contract-rejection fallback. This is not a claim that every ABI error has a unique remediation or a security audit.

The public changes are additive userMessage properties and TOKEN_ROUTE_UNAVAILABLE / REQUEST_REJECTED codes. Existing diagnostic messages generally remain; the two reported error classes now have readable message text as well. INVALID_RULE remains the condition-limit code, with details.reason RULE_CONSTRAINT_LIMIT. Raw causes and decoded revert data remain available. Message-string matching should be replaced with codes/reasons in consumers.

## Validation

- Full unit suite: 2,181 passed, 12 skipped; no failures.
- 39 new regression cases cover route failure before sending, exact over-limit counts, independent stock chain rules, RPC failure classification, every typed code's UI text, uncertainty/hash preservation, cancellation and distinct contract failure categories.
- Actual local v6 suite: 21 passed, including assertions that an engine-wrapped amount-limit revert retains decoded data and has a readable userMessage.
- Build, spec/local typechecks, seven guide examples, compiled CJS/ESM/package checks and source/declaration comparison pass. Changed production files have no lint errors.
- No funded E2E, contract deployment, mainnet transaction or publish action was run.

## Required to finish the DEX diagnosis

Obtain the installed package version and exact { label, rules } passed to agentic.create, serializing bigint values as strings. Count conditions per rule after UI reconstruction, not only in the original preset. Compare with the stock six-entry/twenty-condition result. The screenshots alone cannot establish which calls were appended/merged or whether another transformation occurred.
