# Expanded preset live coverage — October 15, 2026

## Results

All five additional scenarios have passing live coverage: EigenLayer 1/1; the initial multi-chain run 2 passed / 2 failed (Base and Arbitrum ETH resolution); corrected Base/Arbitrum rerun 2/2 passed. This is coverage across focused runs, not one clean five-case invocation. Original failures remain in initial-live.log. No prerequisite was silently skipped as a pass.

Together with the earlier Sepolia Uniswap/Aave scenarios, all ten currently shipped testnet protocol/chain combinations have at least one positive live flow across seven scenarios: DEXes on all four testnets; Aave on Sepolia/Base/Arbitrum; Moonwell on Base; Venus on BNB; EigenLayer on Sepolia. This does not cover every function/market or mainnet.

Validation: 2,101 unit tests passed / 12 skipped; 16 local contract tests passed; build, library/spec typechecks, guide, package/import/declaration/API checks and scenario-selection verification passed. Runtime lint has no errors; E2E lint has only non-null-assertion warnings.

## Scope and checks

Five additional opt-in scenarios under `agw-presets-expanded`. All transactions originate on Donut and execute on supported testnets. No mainnet transactions or protocol deployments. Each new wallet receives at most 100 PC, plus its fresh agent's configured gas allocation. Wrapped-native cases use 10^12 raw native-token units each. `all` continues to exclude AGW groups.

Each destination receipt must succeed and contain CEA UniversalTxExecuted events matching the wallet, target and exact call bytes. Token balance changes and protocol shares are checked independently; a successful outer receipt alone is insufficient for Compound-style market calls that can return an error code.

| Scenario | Destination | Assertions |
| --- | --- | --- |
| EigenLayer | Sepolia | WETH deposit, CEA underlying debit, stakerDepositShares increase |
| Uniswap | Base Sepolia | Receiver and amount rejection, actual swap output, input debit |
| Uniswap + Aave | Arbitrum Sepolia | Swap then supply/withdraw received USDC; exact underlying round trip |
| PancakeSwap + Venus | BNB testnet | Swap then mint/redeem Venus vUSDT; positive shares then zero shares; underlying return within rounding tolerance |
| Aave + Moonwell | Base Sepolia | Faucet LINK/USDbC/mock WETH; Aave supply/withdraw, both Moonwell mint/redeem balances |

The protocol matrices use generated preset calls/pins unchanged, with bridge assets set to [] for destination-held assets. The owner funds CEAs separately. They do not establish arbitrary PRC20 bridge support, borrow/repay coverage, every market, or mainnet execution. EigenLayer withdrawal and Lido's Hoodi flows are outside current supported testnet routes/catalog scope.

## Prerequisite investigation

`probe.cjs` is read-only and records protocol state in `prerequisites.json`. Reads use latest state with an observed starting block, not an atomic snapshot. Initial pinned-block reads gave empty data on Base; fresh reads from publicnode and the Base public endpoint agreed on real V3 pools, so no deployment defect is claimed. Pancake's deployed router points to factory 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865 on BNB testnet; the older documented testnet factory address had no code. Tests read factory() from the included router. Underlying ERC20 mint probes are not proof of faucet effects; live tests assert actual received balances.

EigenLayer WETH strategy 0x424246eF71b01ee33aA33aC590fd9a0855F5eFbc is listed in the official README retained in ../preset-catalog-2026-10-15/README.md. Its live underlying is 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9, whitelist is enabled and deposits are unpaused (eigen-prerequisites.json).

## SDK defect found and corrected

Explicit Base/Arbitrum ETH token objects resolved globally by symbol/address and selected Sepolia's PRC20. Omitted native funds already used the correct chain. The real AgenticRuntime now resolves plain token objects against the destination chain, and rejects explicit Push PRC20 references with a different source chain. No public signature changed. Unit reproduction: three failures before the fix, all five cases pass after it. The full unit suite passes 2,101 tests / 12 skipped.

Initial Base/Arbitrum attempts and subsequent corrected live results are recorded separately. Failed attempts are not counted as passing coverage. Live results and hashes are retained in the evidence file when complete.

## Run

From packages/core:

- `npm run e2e:verify -- --group agw-presets-expanded` — five scenarios select five distinct tests.
- `npm run e2e:preflight -- --group agw-presets-expanded --dry-run` — master balance gate. Wrapped-native cases additionally check their chain's actual PRC20 balance before transfer.
- `npm run e2e:ci -- --group agw-presets-expanded` — serial funded run.

Focused acceptance runs use Jest's `--testNamePattern` to avoid rebroadcasting already-passing cases. Source test names were made explicit for compatibility with the existing static manifest verifier; the initial run used equivalent parameterized names.

## Additional redemption checks

`check-redemptions.cjs` independently replays the three successful market redemption receipts. It verifies that all minted shares were redeemed, no shares remain, and the protocol's emitted redeemAmount exactly equals the CEA's underlying balance. These stronger event checks were also added to the E2E assertions and typechecked; they were validated against the already-completed real receipts without funding duplicate redemptions. Venus uses a four-field Redeem event; Moonwell uses three fields, as confirmed in the retained protocol interfaces.

Observed raw returns: Venus USDT 3,360 (from 3,361 supplied), Moonwell USDbC 9,999 (from 10,000), Moonwell WETH 999,943,876,358 (from 1,000,000,000,000). The tests allow bounded share-rounding loss, and the replay proves full redemption of the position rather than merely an approximately restored balance. See redemptions.json.

Protocol interface sources:
- https://raw.githubusercontent.com/moonwell-fi/moonwell-contracts-v2/main/src/MTokenInterfaces.sol
- https://raw.githubusercontent.com/VenusProtocol/venus-protocol/develop/contracts/Tokens/VTokens/VTokenInterfaces.sol

Uniswap Base official source: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments. Fresh RPC checks, not just address listings, were used before swaps.
