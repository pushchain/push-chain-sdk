# 8. SDK: Evaluation (retired, placeholder)

<aside>
⚖️

**Where we are going.** No evaluation namespace in the SDK for v1. Everything a developer touches about evaluation already has a home: the job-side reads (status, baseline, verdict, watch) are `client.job` on [7. SDK: 8183 Job](7%20SDK%208183%20Job%203ea188aea7f481e0a137f5a896723376.md), and the authoring helpers that write what the evaluator judges (`PushChain.utils.job.buildJobSpec`, `buildJobSpecTemplate`, `encodeJobSpec`, `decodeJobSpec`, `describeJobSpec`, `previewJobSpec`) are on [6. SDK: Universal Marketplace](6%20SDK%20Universal%20Marketplace%203ea188aea7f481e2961ed97129f3a4e6.md), section 3, next to the card they are first used for. The evaluator itself is a contract ([4. Universal Evaluation](4%20Universal%20Evaluation%203e9188aea7f4817bb03ef4c78c883f8b.md)) that the hook drives; nobody calls it from an app.

**What this page is.** A placeholder that keeps the numbering and says where things went. If an evaluator-side SDK is ever needed (operator tooling for validators running reads, a verdict explorer, a committee client for the probabilistic lane), it is designed here as its own thing.

**Status.** RETIRED as an SDK surface (2026-10-12). Helpers moved to page 6 in the twelfth pass; the earlier drafts of this page (`client.evaluation`, criteria helpers, JobSpec helpers) are superseded.

</aside>

# What moved where

- `client.evaluation.status / verdict / waitForStart / watch` are `client.job.status` and `client.job.watch` (page 7)
- `client.evaluation.refireStart` is `client.job.verify` (page 7)
- `PushChain.utils.job.buildJobSpec`, `buildJobSpecTemplate`, `encodeJobSpec`, `decodeJobSpec`, `describeJobSpec`, `previewJobSpec`, `PushChain.CONSTANTS.JOB_SPEC`, `JobSpecError` (page 6, 3.a to 3.f and 4.f)
- `PushChain.utils.market.validateAgentCardRules`, `encodeAgentCardRules`, `decodeAgentCardRules` (page 6, 3.g to 3.i)

# If an evaluation SDK is needed later

Candidates, none committed: a read-only `client.evaluator` for validators and operators (pending rounds, read receipts, verdict history), a verdict explorer over `Settled` and `VerifyRound` events, and a committee client for the probabilistic lane once that lane exists. Each would be designed against a shipped contract, not ahead of it.