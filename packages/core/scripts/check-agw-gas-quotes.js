/** Read-only current outbound quotes. These are observations, not validated gas
 * defaults or measured destination execution fees. No signer/keys are loaded.
 * The attached budget depends on the agent's origin: Push-native signers use
 * the fixed PC/USD fallback, UEA signers the Donut WPC/stable pool for their
 * origin. poolPcIn is the PC the gateway's gas swap needs at quote time.
 * Build core, then: node packages/core/scripts/check-agw-gas-quotes.js [report.json]
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseEther } = require('viem');
const built = path.resolve(__dirname, '../../../dist/packages/core/src');
const { PushChain } = require(built);
const { CHAIN, PUSH_NETWORK } = PushChain.CONSTANTS;
const { getNativePRC20ForChain } = require(path.join(
  built,
  'lib/orchestrator/internals/helpers'
));
const { MOVEABLE_TOKEN_CONSTANTS } = require(path.join(
  built,
  'lib/constants/tokens'
));
const { getPRC20Address } = require(path.join(
  built,
  'lib/universal/prc20-address'
));
async function main() {
  const wallet = '0x0000000000000000000000000000000000005678';
  // A wallet with no CEA token account, so SPL quotes include first-use rent.
  const freshWallet = '0x00000000000000000000000000000000000a6e01';
  const usdtSol = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;
  const report = {
    at: new Date().toISOString(),
    readOnly: true,
    network: PUSH_NETWORK.TESTNET_DONUT,
    note: 'Current quotes only; first-use and subsequent labels describe gas-limit inputs, not executed transactions.',
    origins: [],
  };
  for (const origin of [CHAIN.PUSH_TESTNET_DONUT, CHAIN.ETHEREUM_SEPOLIA]) {
    const client = await PushChain.initialize(
      { address: wallet, chain: origin },
      { network: PUSH_NETWORK.TESTNET_DONUT }
    );
    const rt = client.agenticRuntime;
    if (!rt.isReadOnly) throw new Error('Quote audit must be read-only');
    const entry = {
      signerOrigin: origin,
      pushBlockBefore: String(await rt.reader.getBlockNumber()),
      cases: [],
    };
    report.origins.push(entry);
    const cases = [];
    for (const chain of [
      CHAIN.ETHEREUM_SEPOLIA,
      CHAIN.BASE_SEPOLIA,
      CHAIN.ARBITRUM_SEPOLIA,
      CHAIN.BNB_TESTNET,
    ])
      cases.push(
        [chain, 'default-new-account', BigInt(2000000)],
        [chain, 'route-default-zero-input', BigInt(0)]
      );
    const sol = CHAIN.SOLANA_DEVNET;
    cases.push(
      [
        sol,
        'legacy-million-unit-fallback',
        BigInt(1000000),
        { wallet, burnAmount: BigInt(10000) },
      ],
      [
        sol,
        'sdk-default-route-sizing',
        BigInt(0),
        { wallet, burnAmount: BigInt(10000) },
      ],
      [
        sol,
        'spl-first-use-route-sizing',
        BigInt(0),
        {
          wallet: freshWallet,
          splMintBase58: usdtSol.address,
          burnAmount: BigInt(1000),
        },
        getPRC20Address(usdtSol).address,
      ]
    );
    for (const [chain, stage, gasLimit, svm, token] of cases) {
      const c = { chain, stage, inputGasLimit: gasLimit };
      entry.cases.push(c);
      try {
        const quote = await rt.quoteOutbound(
          token ?? getNativePRC20ForChain(chain, rt.network),
          gasLimit,
          chain,
          svm
        );
        Object.assign(c, quote, {
          attachedPCWei: quote.protocolFee + quote.nativeValueForGas,
          fits20PCCeiling:
            quote.protocolFee + quote.nativeValueForGas <= parseEther('20'),
        });
      } catch (e) {
        c.error = e.shortMessage || e.message;
      }
    }
    entry.pushBlockAfter = String(await rt.reader.getBlockNumber());
  }
  const json = JSON.stringify(
    report,
    (_k, v) => (typeof v === 'bigint' ? String(v) : v),
    2
  );
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json);
  console.log(json);
  if (report.origins.some((o) => o.cases.some((c) => c.error)))
    process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
