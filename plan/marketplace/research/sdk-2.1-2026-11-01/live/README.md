# Live Donut acceptance — November 1, 2026

Nine distinct scenarios passed across runs: three lifecycle/paid-preview/external-owner cases; three deposit/manual-settlement/origin-bridge cases; the isolated live PRE/POST evaluator payout case; and two read-only deployment checks. This is not a claim that the first complete funding suite was green: its fourth case failed before broadcast and cleanup hit HTTP429. Those failures are retained in the reports.

The fourth case reused an EOA that native atomic funding had delegated with EIP-7702 to the batch executor. Its later OwnerIntent signature recovered correctly off-chain, but the account's contract verifier rejected it (`InvalidOwnerSignature`). The fixture now uses a fresh owner for that independent scenario. No verifier was bypassed. The retry used PRE and POST balance reads with a nonnegative delta condition; it validates evaluator plumbing, not execution of an investment strategy.

Live reads also exposed two SDK read-path issues. Unsupported criteria now produce explicit unavailable evaluation facts without a legacy decoder, and listing does not scan submission history for each row. Status/watch remain the deliverable interfaces. Focused regression tests and the live read-only rerun pass; full unit acceptance is2312 passed,12 existing skips.

The demo eUSD is open-mint. Minted40000 raw units (0.04 eUSD), spending only testnet gas, instead of swapping PC. No additional user funds were required. Cleanup audit at block24871325: cards3/4/5 inactive; jobs17/18/19/22 Rejected,20/21/23 Completed; every recorded permission disabled; evaluator prepaid balance for23 zero. Master holds0.04 eUSD and0.06 pUSDT.bnb (the extra0.01 came from the BSC-origin test). Unused BSC gas was returned, leaving0.0000005BNB dust. PC gas buffers remain in controlled test accounts; private recovery keys stay only in ignored local cache files and are not included here.

No commits, pushes, package publication, contract upgrades or team messages. All public writes were bounded test activity authorized for this acceptance run.
