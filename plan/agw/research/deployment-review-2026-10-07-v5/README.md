# Donut v5 deployment check — 7 October 2026

The label contract dependency is delivered. SDK migration and label implementation remain to be done. This check changes no production SDK code and broadcasts no transactions.

## Sources

- [Current address book](https://github.com/pushchain/push-agentic-wallets/blob/bd230d20dbf778d9994b1f1082f79b1a8829a10f/docs/addresses/donut.md).
- [Owner integration guide](https://github.com/pushchain/push-agentic-wallets/blob/bd230d20dbf778d9994b1f1082f79b1a8829a10f/docs/5_SDK_Owner_Integration.md).
- Fetched `origin/deploy-agw`: `bd230d20dbf778d9994b1f1082f79b1a8829a10f` (PR #17).
- Address book identifies deployed contract source as `2e61e133e641b4e0e1ddbdc9306b0903b60e4dbb`. Later commits deploy the suite, update docs and remove earlier deployment books.
- Exact inspected files are copied under [source/](source/).

## Read-only network verification

Donut RPC `https://evm.donut.rpc.push.org/`, chain ID 42101, pinned block **23991912**. See [donut-probe.json](donut-probe.json) and [label-readonly-check.json](label-readonly-check.json).

| Component | Address | Result |
| --- | --- | --- |
| New factory proxy | `0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5` | Code exists; unpaused; implementation slot points to the new factory logic |
| New factory logic | `0xe549d3D4e85cB16F687448D7acA21D9d13A7cD0f` | 10,013 runtime bytes |
| New wallet implementation | `0x4D459Da499C14548aa16c46c57fD92880A88EBb4` | 17,584 runtime bytes; factory getter agrees; label/init selectors present |
| URP proxy | `0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af` | Same bytecode, implementation/admin slots and version 3.1.0 as the prior probe |
| Engine / validator / gateway | See probe | Bytecode and inspected wiring unchanged |

The wallet implementation's `accountId()` is still `push.agw.1.0.0`; it cannot identify label capability by itself.

The SDK's existing clone derivation formula, supplied with the new factory and implementation, matches live `predictWallet(owner, 0)`. Immutable clone arguments and salt formula are unchanged. Addresses change because the factory and implementation change, not because the label is part of the address.

`eth_call` simulations of the live factory's `deployWallet` succeed for an empty label, 64 ASCII bytes, and 16 four-byte emoji. Labels of 65 ASCII bytes and 17 emoji revert with `LabelTooLong(65)` and `LabelTooLong(68)` respectively. No wallets were actually created.

There were no `WalletDeployed` events from this factory between its deployment and the pinned block. Therefore successful rename/reset transactions, actual clone label reads and their checkpoint effects have **not** been exercised on a live wallet. Source and the contract team's label tests establish the intended semantics; this check is not a full source-bytecode equivalence proof or security audit.

Probe `unchanged` fields compare against the older v4 probe: a false value for new factory logic, wallet implementation or factory wiring is expected. The proxy runtime itself is identical despite the changed address. Initial log scan exceeded the RPC's 1,000-block range limit; the completed scan uses bounded pages.

## Label behavior in exact source

- `label()` returns the stored custom label, otherwise `AGW <owner's wallet index + 1>`.
- Owner or wallet-self may call `setLabel(string)`; wallet-self enables signed owner-door execution. Agent dispatch cannot target the wallet.
- Empty string resets the default. Maximum length is **64 UTF-8 bytes**, not 64 characters.
- `LabelSet(string)` emits the supplied string, including empty on reset.
- Direct setter adds no checkpoint. A rename through `execute` or `executeWithSig` adds the normal owner-action checkpoint.
- Initialization changed from `initializeAccount()` to `initializeAccount(string)`; factory stores the supplied label through initialization.
- Signed deployment still does **not** bind the label in OwnerIntent. The relayer can choose this cosmetic value; the owner can rename afterward. This is documented and deliberately tested upstream.
- v4 wallets stay at their existing addresses and do not gain label methods.

## SDK changes needed

1. Replace the v4-only deployment binding with v5, including addresses, source pin, start block, EIP-712 factory domain and verification fixtures. Preserve the unchanged rule encoding and selection behavior.
2. Refresh durable ABI/artifact snapshots and local real-contract harness for the new initializer, label views/setter/event and `LabelTooLong` error.
3. Implement the existing public `wallet.setLabel()` method using the owner authorization path. Validate the UTF-8 byte cap consistently for create and rename; permit empty reset.
4. Read current labels through `label()` in wallet `info()` and `list()`, replacing deploy-event label lookup.
5. Add unit/local/live E2Es for default numbering, custom deployment labels, rename/reset, boundaries and Unicode, owner authorization, agent refusal, signed owner execution, checkpoints and v5 address/domain derivation.

No new caller-facing method is needed: `setLabel` is already exposed but currently throws capability unavailable. Following the user's existing no-legacy-baggage direction, migration should target the current v5 suite rather than add a second v4 adapter. Existing uncommitted SVM alignment work was preserved.
