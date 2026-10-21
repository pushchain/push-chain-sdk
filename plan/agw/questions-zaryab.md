# Contract questions for Zaryab: agentic wallet (AGW) v6

Updated October 21, 2026. Question 1 is final and ready to send. Question 2 is held until Harsh answers. What we verified ourselves is in [pre-question findings](research/pre-question-findings-2026-10-21/README.md).

These questions cover only the deployed AGW contracts (source `ffd567d`).

---

## 1. SvmRulebook: `fromEnd` data pins can be shifted by appending bytes. Is a fix planned?

- `AllowedProgram` has no instruction-data length field. The only length checks are the global 1024-byte cap, the exact outer-payload length, and `ixLen >= discriminatorLen` for rule matching.
- `_resolveOffset` returns `ixLen - offset` once the data is long enough (`SvmRulebook.sol:666-677`). So an agent can append N bytes inside the instruction data and raise the length field to match. The payload is still well-formed, and every `fromEnd` pin then reads the appended bytes.
- Example: on a Jupiter-style layout, the appended bytes could satisfy the fee, slippage and ratio pins while the real arguments earlier in the data say something else. Account pins still hold.
- No test appends bytes inside the instruction data. `test_svm_S17_fromEndDataTooShortByOne` shows the read position moving with the length.
- It's only exploitable where the target program ignores trailing instruction data.

**Possible fixes:** a per-rule exact (or maximum) instruction-data length for fixed-layout instructions, or refusing `fromEnd` pins unless such a length is set.

The SDK never creates `fromEnd` pins, so SDK-built rules aren't affected.

---

## 2. Held: send only the items Harsh picks

Each item below is a contract option in [questions-harsh.md](questions-harsh.md). Ask Zaryab about an item only if Harsh chooses it. No change is requested yet.

| If Harsh picks | Ask Zaryab: feasible, and roughly how much work? |
|---|---|
| Q1 with Solana | Token transfers on Solana without an app program. `SvmRulebook` forbids the System and SPL Token programs, so an agent can move SOL or SPL only through an allow-listed program's CPI. Could a constrained transfer (fixed recipient, capped amount) be allowed? |
| Q2 option C | "Any token" assets. Today a rule holds 1–8 explicit PRC20s and there is no wildcard. |
| Q3.2a | A total limit on activity on the destination chain. Today pins and `maxValue` limit each call, and nothing adds them up across calls or transactions. |
| Q3.2b | A combined limit within one transaction: the sum of a pinned amount across up to 10 calls in one request. |
| Q4 option B | More than 8 actions for Push-chain rules. The source calls 8 a deliberate sanity bound, and raising it a design change. |

---

## Already answered from source; no longer asked

- **Why 8 native actions.** It is a deliberate sanity bound for readability, the duplicate scan and revoke cost, not a gas bound (`AGW.sol:73-86`, `docs/1_AGW.md:532,573`). The session engine has no cap.
- **`creditRevert`.** No node code calls it on any branch, so a failed send still counts against `maxTotal`. Wiring it is node work; that question is held in [questions-core-gateway.md](questions-core-gateway.md).
- **Solana token-account ownership.** The policy cannot check it (`Types.sol:585-587`). The owner pins positions, and the SDK pins the wallet's token account. Pins compare exact keys; writable and signer flags are not checked.
