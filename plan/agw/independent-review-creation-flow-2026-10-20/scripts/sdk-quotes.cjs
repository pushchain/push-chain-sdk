// Read-only: the SDK's own AGW quote path (runtime.quoteOutbound) for different signer origins.
// Uses the locally built dist of the reviewed working tree. No keys, no signing.
const fs = require('node:fs');
const path = require('node:path');
const built = '/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk/dist/packages/core/src';
const { PushChain } = require(built);
const { CHAIN, PUSH_NETWORK } = PushChain.CONSTANTS;
const { getNativePRC20ForChain } = require(path.join(built, 'lib/orchestrator/internals/helpers'));
const USDT_SOL = '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34';
const USDT_SOL_MINT = 'EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF';
const big = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
async function main() {
  const out = { at: new Date().toISOString(), readOnly: true, origins: {} };
  const origins = {
    pushNative: { address: '0x0000000000000000000000000000000000005678', chain: CHAIN.PUSH_TESTNET_DONUT },
    sepoliaUEA: { address: '0x0000000000000000000000000000000000005678', chain: CHAIN.ETHEREUM_SEPOLIA },
    solanaUEA: { address: '11111111111111111111111111111112', chain: CHAIN.SOLANA_DEVNET },
  };
  // Fresh wallet (no CEA/ATA anywhere) and the reviewed SPL wallet (CEA ATA exists).
  const freshWallet = '0x00000000000000000000000000000000000a6e01';
  const splWallet = '0xED6bFE825b8d84A1E6f4F7c9067398F8985CC372';
  for (const [name, signer] of Object.entries(origins)) {
    const client = await PushChain.initialize(signer, { network: PUSH_NETWORK.TESTNET_DONUT });
    const rt = client.agenticRuntime;
    if (!rt.isReadOnly) throw new Error('must be read-only');
    const cases = [];
    for (const chain of [CHAIN.ETHEREUM_SEPOLIA, CHAIN.BASE_SEPOLIA, CHAIN.ARBITRUM_SEPOLIA, CHAIN.BNB_TESTNET]) {
      for (const gl of [BigInt(2000000), BigInt(0)]) {
        const c = { chain, inputGasLimit: gl };
        try {
          const q = await rt.quoteOutbound(getNativePRC20ForChain(chain, rt.network), gl, chain);
          Object.assign(c, q, { attachedPC: Number(q.protocolFee + q.nativeValueForGas) / 1e18 });
        } catch (e) { c.error = (e.shortMessage || e.message).slice(0, 200); }
        cases.push(c);
      }
    }
    const sol = CHAIN.SOLANA_DEVNET;
    for (const [label, token, gl, svm] of [
      ['native-sol omitted', getNativePRC20ForChain(sol, rt.network), BigInt(0), { wallet: freshWallet, burnAmount: BigInt(10000) }],
      ['spl fresh CEA ATA omitted', USDT_SOL, BigInt(0), { wallet: freshWallet, splMintBase58: USDT_SOL_MINT, burnAmount: BigInt(1000) }],
      ['spl existing CEA ATA omitted', USDT_SOL, BigInt(0), { wallet: splWallet, splMintBase58: USDT_SOL_MINT, burnAmount: BigInt(1000) }],
      ['spl existing explicit 5000', USDT_SOL, BigInt(5000), { wallet: splWallet, splMintBase58: USDT_SOL_MINT, burnAmount: BigInt(1000) }],
      ['legacy 1,000,000', USDT_SOL, BigInt(1000000), { wallet: splWallet, splMintBase58: USDT_SOL_MINT, burnAmount: BigInt(1000) }],
      ['explicit 500 (< base 960)', USDT_SOL, BigInt(500), { wallet: splWallet, splMintBase58: USDT_SOL_MINT, burnAmount: BigInt(1000) }],
    ]) {
      const c = { chain: sol, label, inputGasLimit: gl };
      try {
        const q = await rt.quoteOutbound(token, gl, sol, svm);
        Object.assign(c, q, { attachedPC: Number(q.protocolFee + q.nativeValueForGas) / 1e18 });
      } catch (e) { c.error = (e.shortMessage || e.message).slice(0, 200); }
      cases.push(c);
    }
    out.origins[name] = { signerChain: signer.chain, pushBlock: String(await rt.reader.getBlockNumber()), cases };
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(out, big, 2));
  for (const [n, o] of Object.entries(out.origins)) {
    console.log('==', n, o.signerChain, 'block', o.pushBlock);
    for (const c of o.cases) console.log('  ', c.chain, c.label || '', 'in', String(c.inputGasLimit), 'used', String(c.gasLimitUsed), 'attachedPC', c.attachedPC, c.error || '');
  }
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
