# Checkpoint revision validation at e704d5b

October 3, 2026. GitHub API confirmed `pushAgenticWallet_v3` at `e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9`; `nomenclature-changes` is no longer an advertised branch. Local Git objects include the checkpoint commit `6b7dbf4`. An isolated source archive was built under `/private/tmp`, using the pinned dependency trees and the seven independent review tests. No sibling working checkout or production source was changed.

| Check | Result | Evidence |
| --- | --- | --- |
| Build and sizes | Passed | [build.log](build.log) |
| Revised execute source pin | Passed, B2 checkpoint revision | [check-execute.log](check-execute.log) |
| Default suite, offline | 563 passed, 0 failed, 6 skipped; 27 suites | [tests-offline.log](tests-offline.log) |
| Seven review tests, offline | 7 passed, 0 failed, 0 skipped | [review-tests-offline.log](review-tests-offline.log) |

The first normal test attempts crashed before test execution in Foundry's macOS proxy-discovery code (`system-configuration`, NULL object). Those failed-attempt logs were archived locally during package cleanup; the successful offline logs are retained here. Retrying with the supported `--offline` option succeeded without changing assertions. The initial crash is not a contract failure or a successful test run.

Six skips are the RPC-dependent PRC20 checks and deployment-record checks; this pass did not run live forks or verify a new deployment. The seven tests use the existing recording gateway, so they do not prove real allowance consumption, token burn or destination settlement.

| Contract | Runtime bytes | EIP-170 remaining bytes |
| --- | ---: | ---: |
| AGW | 16,549 | 8,027 |
| AgentValidator | 806 | 23,770 |
| SmartSession | 22,581 | 1,995 |
| UniversalRulesPolicy | 23,673 | 903 |

These results reproduce the independent follow-up. Generated [ABIs](abi/) reflect this source revision only. See [offline command results](offline-results.json). The isolated copy includes only the [review test](review-tests/IndependentReviewHead.t.sol) as extra source; no deployment was broadcast.

Reproduction after initializing dependencies:

```sh
forge build --sizes
make check-execute
forge test --offline --no-match-path 'test/review/*' -vv
forge test --offline --match-contract IndependentReviewHeadTest --match-test test_ReviewHead_ -vv
```

Forge 1.5.1-stable, solc 0.8.26, optimizer 833, via IR, Cancun. Full results and checksums are retained beside this report.
