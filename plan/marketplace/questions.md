# Marketplace multi-rule execution — questions for the contracts team

**SDK:** `@pushchain/core@6.0.27-alpha.9`

**Checkpoint:** November 1, 2026

**Blocking dependency:** UniversalHook support for every rule of a marketplace job.

Single-rule marketplace jobs work end to end on the deployed 2.1 stack, including
live PRE/POST evaluation and payout. The remaining blocker is multi-rule execution.
The questions below define the contract behavior and deployment evidence needed
to remove that SDK gate; they are not requests for another SDK compatibility layer.

## Owners

| Area | Owner / confirmation needed |
| --- | --- |
| UniversalHook ABI, validation and binding | Nilesh Gupta |
| Marketplace rule mapping, integration and deployment coordination | Zaryab |
| Revocation, settlement and terminal-permission policy | Harsh Rajat, with Nilesh and Zaryab |
| SDK integration after the contract interface is confirmed | Shoaib Mohammed |

These responsibilities follow the shared team discussion. Please correct them if
ownership has changed.

## Current behavior and impact

- Marketplace 2.1 is deployed at `0x940744d96b14Bc030163C6084d602d57CE42ba48`.
  Its `maxRulesPerCard` is **4**, and opening records/returns `rulesIds[]`.
- The current UniversalHook at `0xbee0B01773Dc742887f04bED58BD1B5Aa457ED96`
  accepts `(bytes32 rulesId, bytes32 expectedSpecHash, bytes newSpec)` at funding.
  It checks and binds **one** permission.
- For a Base + Sepolia card, checking only Base does not establish that Sepolia's
  permission is live. Funding can therefore proceed without all permissions
  needed for the provider's work.
- Binding every rule is necessary, but does not by itself prevent later owner
  revocation or revoke permissions when a job ends. Those behaviors need an
  explicit contract policy.
- Alpha.9 supports multi-rule authoring, registration and previews. It refuses
  multi-rule opening, funding and deposits until the hook supports the complete
  rule set. Cancellation handles every recorded marketplace permission when
  performed by the owner. Automatic completion does not imply automatic revocation.

The SDK gate protects SDK callers. It cannot protect a demo or direct contract
caller that submits only the first rule ID.

## 1. What is the final multi-rule funding and binding interface?

**Nilesh, with Zaryab: please confirm the fund payload, binding getters/events,
and how the hook proves that every permission belonging to the job is included.**

The proposed payload is:

```solidity
abi.encode(bytes32[] rulesIds, bytes32 expectedSpecHash, bytes newSpec)
```

This is a proposal, not an implemented SDK or confirmed contract ABI. Please confirm:

- The exact tuple, types and ordering; whether `expectedSpecHash` and `newSpec`
  retain their current meaning.
- Whether `rulesOfJob(jobId)` and binding events change to arrays, or use another
  interface. The marketplace getter already returns an array; the hook's getter
  currently represents one binding.
- The authoritative source for the job's complete rule set. Accepting an array
  alone is insufficient if a caller can omit Sepolia and submit only Base.
- How omissions, duplicates, unrelated permissions and permissions from another
  wallet/job are rejected, and whether ordering must match the marketplace.
- That every required permission is checked before escrow moves, and that
  wallet occupancy continues to apply to the whole job.

**Needed for SDK work:** the implementation commit and generated ABI, including
custom errors and events. The SDK will pass the complete recorded set and never
silently select `rulesIds[0]`.

## 2. What happens if the owner changes or revokes a bound permission after funding?

**Harsh and Nilesh: is post-funding revocation prevented, or permitted with an
explicit evaluation/settlement consequence? Please confirm that consequence.**

For example, both Base and Sepolia permissions are live when funding succeeds.
The owner then revokes Sepolia. The provider can do the Base work but cannot
complete the Sepolia work. A funding-time check cannot prevent this later change.

Please specify whether the intended behavior is to block the permission change,
record client interference and apply a defined settlement rule, or allow the job
to fail/refund under an explicitly accepted policy. Also confirm how the existing
`ownerCheck` mechanism applies to changes affecting any of the job's rules.

**Needed for SDK work:** the relevant contract status/events and the expected
payout/refund behavior. A frontend check or SDK polling cannot enforce this policy
against direct contract calls.

## 3. Who revokes the permissions when a job becomes terminal?

**Nilesh and Zaryab, with Harsh's policy confirmation: should all job permissions
be revoked automatically, or remain live until owner cleanup or expiry?**

Today, owner-authorized SDK cancellation revokes the recorded permissions.
After automatic evaluation/completion, our live test separately invoked owner
cleanup. A provider or evaluator does not automatically have authority to revoke
permissions from the client's AGW.

Please confirm:

- The intended behavior for Completed, Rejected, cancelled and expired jobs.
- If cleanup is automatic, the authorized caller and exact AGW/hook entrypoint
  that can revoke **every** job permission, including when the owner is offline.
- Whether cleanup is atomic with settlement. If it can fail independently,
  identify the retry path and whether the wallet becomes available before cleanup.
- That cleanup never revokes unrelated wallet permissions or those of a later job.

**Needed for SDK work:** the terminal behavior and any cleanup/retry ABI. Until
then, we will not describe terminal settlement as automatic permission revocation.

## 4. What is the rollout and verification handoff?

**Nilesh and Zaryab: please share the upgraded source/ABI, deployment record and
proof that two- and four-rule jobs bind every permission.**

The handoff should include:

- Hook source commit/PR, proxy and implementation addresses, upgrade transaction,
  network and activation block. Include changes to kernel/evaluator wiring, if any.
- The matching marketplace integration commit and confirmation that its recorded
  rule set is the set the hook validates.
- Passing cases for two and four rules, missing/revoked secondary rules, omitted
  or duplicate IDs, and permissions belonging to another wallet. Include the
  agreed post-funding change and terminal-cleanup behavior.
- The interim deployment decision: keep the live card cap at four while direct
  multi-rule funding remains unsafe, or constrain that path until the hook ships?
  The SDK gate alone does not constrain non-SDK callers.

**SDK acceptance before removing the gate:** verify live code/wiring and the
confirmed ABI; pass all recorded IDs; run multi-rule opening/funding and lifecycle
E2Es; prove that a missing secondary permission prevents funding. An unchanged
proxy address or a raised card cap is not sufficient evidence of the upgrade.

## Already resolved for alpha.9

No additional answers are needed for the deployed timing-free PRE/POST format,
`COMPARE` naming, duration-based card inputs, CEA deployment alignment, or the
current eUSD escrow / PC read-and-gas split. Single-rule execution has live
acceptance. PUSD redemption and arbitrary cross-chain principal routing are not
implemented in this release and are outside this hook handoff.

## Reference checkpoint

- [Current reviewed UniversalHook source](https://github.com/pushchain/push-chain-core-contracts/blob/a7a8547822904b62c9b9dc031822b14c972abbc8/src/agentic-commerce-8183/hooks/UniversalHook.sol)
- [Marketplace 2.1 contract reference](https://github.com/pushchain/push-chain-core-contracts/blob/5aad0392510b7b4dce807f7edba39054c8f95fc4/docs/universalmarketplace/reference.md)
- [Deployment record, including the cap increase and single-rule hook limitation](https://github.com/pushchain/push-chain-core-contracts/blob/5aad0392510b7b4dce807f7edba39054c8f95fc4/docs/addresses/push_donut_universal_marketplace.md)
- [SDK live acceptance and cleanup evidence](./research/sdk-2.1-2026-11-01/live/README.md)
