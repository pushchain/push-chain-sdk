# Solana rejection terminalizes after the SDK timeout — operational follow-up

For the Push outbound executor/relay team; Harsh/Zaryab can help route this if timing clarification is useful. This is a read-only evidence note, not a message that has been sent. Terminal failure is now observed, so this is not an unresolved delivery blocker or an established relay defect.

## Observed behavior

On October 6, 2026 we sent two internal AGW SVM outbounds through the same verified Donut v4 generation and devnet gateway. The positive receive_sol call completed and its wallet CEA transfer/CPI were verified. The second intentionally calls decrement with a CEA that is not the counter's authority.

| Evidence | Value |
| --- | --- |
| Push hash | 0x51e2227e833e8090844f151c2d5d959225d3ec24828bf11a1c6467e2a74410fc |
| Push block/status | 23949885 / SUCCESS |
| Universal/subtransaction ID | f328cfa0af8a4e50afc3648205161759c02f1d0ddd27c40ba25f15990d084f36 |
| Outbound ID | d7e4da935abc97cbb68c0869dafa1e28038b89848c53650364250f60cd11e1ef |
| Destination | Solana devnet; gateway CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS |
| Program/instruction | 8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx / decrement(1) |
| Expected destination error | Actual read-only simulation returns Unauthorized, custom error 6002 |
| Node observation | PENDING (1), universal status UNSPECIFIED (0), no observedTx hash, no abortReason |
| SDK wait | Push status 1, externalStatus timeout after 600 seconds; source hash retained |
| Later node observation | REVERTED (3), observed success=false, error "tx not executed on destination chain", no Solana hash |
| Later read-only replay | Push status 1, externalStatus failed, same source identity/hash |
| Refund executions | Asset and gas refunds report SUCCESS at block 23950149; policy spent remains 20,000 |

[Initial node state](failure-observation.json), [terminal record](failure-observation-final.json), [simulation and error logs](destination-rejection-simulation.json), [source/SDK receipt evidence](live-evidence.json), [read-only replay](readonly-replay.json), [initial strict test output](logs/live-bootstrap-fixed.log).

The positive sibling source hash is 0x50a96ff863722ced3464e3e8e5e451621903396c9bc83fcc010756dc1aee73b8. It proves this wallet/gateway/program route delivers a permitted instruction; the negative route is not evidence of missing deployed SVM support.

## Optional operational clarification

1. What retry/expiry and terminalization window should the SDK documentation and negative live tests expect for a Solana program/preflight rejection? This case exceeded the initial ten-minute wait, then became terminal without another source submission.
2. Can the observed record preserve the actual program/preflight reason (Unauthorized/6002 here), instead of only "tx not executed on destination chain"? A destination hash may legitimately be absent.

The SDK follows the published state correctly: timeout while pending, failed after REVERTED. The test keeps that distinction and allows a bounded twenty-minute failure window for future funded runs. The successful read-only recovery does not erase the initial timeout result or establish a guaranteed terminalization SLA.

This is separate from creditRevert integration. Returning assets/gas does not lower policy spend; final accounting remains charged. No failed Solana transaction signature is claimed because the record says execution did not occur on the destination.
