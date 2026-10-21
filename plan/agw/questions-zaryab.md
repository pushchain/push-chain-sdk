# Contract questions for Zaryab: agentic wallet (AGW) v6

Updated October 21, 2026. Draft; nothing sent.

These questions cover only the deployed AGW contracts (source `ffd567d`). What we verified ourselves is in [pre-question findings](research/pre-question-findings-2026-10-21/README.md).

---

## 1. Solana `fromEnd` data pins can be shifted by appending bytes. Is a fix planned?

From the source (`SvmRulebook.sol`):

- **No length rule per program.** `AllowedProgram` has no instruction-data length field. The only length checks are:
  - the global 1024-byte cap;
  - the exact outer-payload length;
  - for rule matching, `ixLen >= discriminatorLen`.
- **How `fromEnd` reads.** `_resolveOffset` returns `ixLen - offset` once the data is long enough (`:666-677`). So an agent can append N bytes inside the instruction data and raise the length field to match. The payload is still well-formed, and every `fromEnd` pin then reads the appended bytes.
- **Example.** On a Jupiter-style layout, the agent could append bytes that satisfy the fee, slippage and ratio pins while the real arguments earlier in the data say something else. Account pins still hold.
- **Test coverage.** There is no test that appends bytes inside the instruction data. `test_svm_S17_fromEndDataTooShortByOne` shows the read position moving with the length.
- **When it matters.** Exploitability depends on whether the target program ignores trailing instruction data.

**Possible fixes:**
- a per-rule exact (or maximum) instruction-data length for fixed-layout instructions; or
- refusing `fromEnd` pins unless such a length is set.

**Question:** is a fix planned? The SDK never creates `fromEnd` pins, so SDK-authored rules aren't affected.

## 2. Only if Harsh asks for them: are these feasible, and roughly how much work?

Harsh is deciding product options that would need contract changes. No change is requested yet.

1. **A total limit on activity on the destination chain.** Today pins and `maxValue` limit each call, and nothing adds them up across calls or transactions.
2. **A combined limit within one transaction.** The sum of a pinned amount across up to 10 calls in one request.
3. **"Any token" assets.** Today a rule holds 1–8 explicit PRC20s and there is no wildcard.
4. **Token transfers on Solana without an app program.** `SvmRulebook` forbids the System and SPL Token programs, so an agent can move SOL or SPL only through an allow-listed program's CPI. Could a constrained transfer (fixed recipient, capped amount) be allowed?
5. **More than 8 actions for Push-chain rules.** The source calls 8 a deliberate sanity bound, and raising it a design change.

---

## Already answered from source; no longer asked

- **Why 8 native actions.** It is a deliberate sanity bound for readability, the duplicate scan and revoke cost, not a gas bound (`AGW.sol:73-86`, `docs/1_AGW.md:532,573`). The session engine has no cap.
- **`creditRevert`.** No node code calls it on any branch, so a failed send still counts against `maxTotal`. Wiring it is node work; that question is in [questions-core-gateway.md](questions-core-gateway.md).
- **Solana token-account ownership.** The policy cannot check it (`Types.sol:585-587`). The owner pins positions, and the SDK pins the wallet's token account. Pins compare exact keys; writable and signer flags are not checked.
