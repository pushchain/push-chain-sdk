# Validation and limitations — October 20

Source pin `443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47`, source branch sdk-iteration-v1. Remote head was rechecked after the review and remained at that SHA. Full source was archived into an isolated temporary workspace, with all five dependencies at their actual submodule SHAs. No .env file exists in that workspace. SDK production files and sibling working-tree checkouts were not modified by this research.

## Results

| Check | Result / evidence |
| --- | --- |
| Fresh Notion download | 6/6 requested page bodies imported from a new stack-index export; ZIP, entries, SHA-256 and timestamp retained in [manifest](notion-source-manifest.json). Visible discussions reviewed separately. |
| Ordinary contract unit/fuzz suite | **248 passed, 0 failed, 2 fork tests skipped** without RPC env. [Summary](contract-test-summary.json), [command/exit](contract-test-command.json), [raw JSON log](contract-tests.log). Source fuzz setting 1,024 runs. Invariant functions excluded from this invocation. |
| Upstream fork suite | **2 passed, 0 skipped/failed**, separately with public Donut RPC. [Summary/commands](fork-tests-summary.json), [log](fork-tests.log). Real AGW v6; marketplace/kernel/hook created on fork. Hook test honors FORK_BLOCK=24447347. The marketplace test selects latest internally; its emitted block is not retained in this quiet JSON artifact, so no exact block is claimed for that case. |
| Kernel/marketplace invariants | **10 passed**, separately at **64 runs × depth 64**, 4,096 handler calls per invariant. [Summary and per-test metrics](invariant-tests-summary.json), [compressed raw log](invariant-tests.log.gz). This is a bounded review configuration, not the repository's full CI invariant budget. |
| Independent review cases | **4 passed**, two local real-kernel/mock-wallet cases and two real-AGW fork cases pinned to 24447347. [Source](ReviewGaps.t.sol), [summary](review-gaps-summary.json), [log](review-gaps.log). Findings below. |
| Live state/code/wiring | Block **24447347**, chain 42101, version 2.0.0, correct factory/kernel/hook/rules/engine/evaluator/token wiring, whitelist true, fees zero, EOA evaluator code empty, 0 cards / 0 jobs. [RPC observations](live-deployment.json). |
| CEA computation | **4/4** supported chain configurations match address book and independent EIP-1167/CREATE2 calculation for a predicted AGW. Checks registered derivation, not destination protocol execution. |
| Runtime/source parity | **5/5** stack component executable runtimes match pinned build after metadata exclusion and explicit library link/self-address resolution. [Profile-by-profile comparison](runtime-comparison.json). All matching artifacts use 1,000 optimizer runs. Full bytecode including metadata differs. |
| Wire comparison | Controlled old/new nonempty JobSpec vectors each roundtrip canonically in their own profile and fail the other decoder. [Vectors/results](wire-comparison.json). Also samples template/spec decoding separately. Does not prove every hostile/ambiguous payload is rejected. |
| ABI collection | Marketplace, kernel, hook, helper, library and complete 40-error library ABIs extracted from pinned build under [contracts/abi](../../contracts/abi). |

The passes above are separate invocations, not one single full-suite result. Research work did not rerun the SDK's full AGW unit suite; October 18 AGW counts in plan/agw remain earlier evidence.

## Independent review findings

1. A BOTH template can register/open/fund today, but arbitrary setBudget replacement bytes are ignored by the interim hook and kernel description stays unchanged. Stored flags are not implemented mutability.
2. Card providerFee is not a protocol-enforced fixed price: funding at three times that reference succeeds when the client accepts that exact budget.
3. Client reject of an Open job frees marketplace occupancy. Old permission remains enabled; opening another job for the same wallet/provider creates a second enabled permission.
4. One owner batch calling kernel.reject and wallet.revokeRules atomically cancels and disables that job's grant on existing real AGW v6. No new AGW stop role is required for this **owner-authorized SDK path**. It does not prove hook/provider-triggered cleanup or external UEA wallet UX.

The two local cases use the pinned suite's mock AGW signatures; they are not owner-signature proofs. The two cancellation fork cases use the actual factory/wallet/engine and signed OwnerIntent. All fork writes are ephemeral local EVM state, never public transactions.

## Commands

Workspace location is captured in review-workspace.txt; source dependencies are pinned in dependency-pins.json. Test records retain exact absolute invocation roots and exit codes. For a fresh run, archive the same Git SHA plus pinned dependencies first; contracts/ is a selected reference snapshot, not a standalone full build tree.

```sh
forge test --root "$review_root" --match-path 'test/8183-tests/*.t.sol' --no-match-test invariant_ --offline --json
PUSH_CHAIN_TESTNET_RPC_URL=https://evm.donut.rpc.push.org/ FORK_BLOCK=24447347 \
  forge test --root "$review_root" --match-path 'test/8183-tests/*.fork.t.sol' --offline --json
FOUNDRY_INVARIANT_RUNS=64 FOUNDRY_INVARIANT_DEPTH=64 \
  forge test --root "$review_root" --match-path 'test/8183-tests/*.t.sol' --match-test invariant_ --offline --json
# Copy ReviewGaps.t.sol into that workspace's test/8183-tests before this command:
forge test --root "$review_root" --match-path test/8183-tests/ReviewGaps.t.sol --match-test test_review_ --offline --json
node plan/marketplace/scripts/probe-live.cjs
node plan/marketplace/scripts/compare-runtime.cjs
node plan/marketplace/scripts/check-wire.cjs
```

RPC scripts use the existing installed viem package, load no keys and have no send/broadcast calls. Runtime comparison uses the saved block and generated artifacts. These scripts currently write this dated evidence directory; select another output directory before a later baseline refresh.

## Corrections made during verification

- Initial dependency extraction refused an archived outward symlink. Dependencies were re-extracted at the correct pins with links omitted; final tests use that corrected workspace.
- First standalone RPC probe used predictWallet's index as uint96 because IntentRequest.index is uint96. Factory ABI actually takes uint256; corrected against the pinned interface before the successful probe. Initial failure was a probe ABI mistake, not a contract failure.
- First runtime comparison selected the default 99,999-run dependency artifacts. The live deployments use the 1,000-run variants emitted by the marketplace build profile. Comparison now records both candidates and the matching profile; no unexplained runtime mismatch remains.

## Not established by this review

No funded live transaction, card registration, open/fund/execute/settle roundtrip, destination liquidity check, public deployment or publication occurred. No automatic evaluator, baseline, mutable agreement, recurring job or rating was exercised. There were no live registry cards/jobs at the observation to inspect. No full security audit, exhaustive mutation run, all-mainnet claim, complete explorer source verification or user-wallet signing-prompt count is implied.
