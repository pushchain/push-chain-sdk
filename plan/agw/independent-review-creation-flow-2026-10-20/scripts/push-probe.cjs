// Independent read-only Donut probe. No keys, no signing, no transactions.
// Usage: node push-probe.cjs <out.json>
const fs = require('node:fs');
const SDK = '/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk';
const {
  createPublicClient, http, parseAbi, decodeEventLog, encodeFunctionData,
  decodeFunctionResult, getAddress, hexToString,
} = require(SDK + '/node_modules/viem');

const RPC = 'https://evm.donut.rpc.push.org/';
const CORE = '0x00000000000000000000000000000000000000C0';
const UGPC = '0x00000000000000000000000000000000000000C1';
const QUOTER = '0x83316275f7C2F79BC4E26f089333e88E89093037';
const PRC20 = {
  pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
  pETH_ARB: '0xc0a821a1AfEd1322c5e15f1F4586C0B8cE65400e',
  pETH_BASE: '0xc7007af2B24D4eb963fc9633B0c66e1d2D90Fc21',
  pBNB: '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36',
  pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
  USDT_ETH: '0x0f97A213207703923F5f0C613C9827f7C9A0f96B',
  USDC_ETH: '0x7A58048036206bB898008b5bBDA85697DB1e5d66',
  USDT_ARB: '0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891',
  USDC_ARB: '0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C',
  USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
  USDC_SOL: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F',
  USDT_BSC: '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2',
  USDC_BSC: '0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639',
  USDT_BASE: '0x148823809B853e1db187BC09A9ac909BC42F971a',
  USDC_BASE: '0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1',
  WETH_ETH: '0x0d0dF7E8807430A81104EA84d926139816eC7586',
  stETH_ETH: '0xaf89E805949c628ebde3262e91dc4ab9eA12668E',
  DAI_SOL: '0x5861f56A556c990358cc9cccd8B5baa3767982A8',
};
const GAS = {
  'eip155:11155111': PRC20.pETH, 'eip155:84532': PRC20.pETH_BASE,
  'eip155:421614': PRC20.pETH_ARB, 'eip155:97': PRC20.pBNB,
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': PRC20.pSOL,
};
const STABLE_FOR_ORIGIN = {
  'eip155:11155111': PRC20.USDT_ETH, 'eip155:421614': PRC20.USDT_ARB,
  'eip155:84532': PRC20.USDT_BASE, 'eip155:97': PRC20.USDT_BSC,
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': PRC20.USDT_SOL,
};
const PUSH_TXS = {
  'spl:first-use': '0x119c89e9ff7c7cccdfc8c071fade2488aa28b0eff7d9b71f7f0cf247c958bbf5',
  'spl:subsequent': '0x7980032bb748889f44d9a58e4030dc1338575d03fa78da23531dcf96d6c23e57',
  'sepolia:first-use': '0xb968f71a2f8deb17a194632744e0e256b7703e229e0a0d35461751e580debce6',
  'sepolia:subsequent': '0xc3b021815bcfd26269ddcdbaed813aa91fb0c03a36dbf2cbc5678f84b157c7cf',
  'base:first-use': '0xb9fd4a64a2fd9b68193ac3aef1177f054dc591cfc3917968d3cfc9ee1fc35153',
  'base:subsequent': '0xc0aa504633d7e0fe66e4aa2abaf994e4b8ff09c992b8712e3a8879fe33c9026d',
  'arb:first-use': '0x21ce19a3780fee8cbcc006b3197163166402da30557ef1eff8556c97d793846c',
  'arb:subsequent': '0xba1c063ab2e261f0d1af0833975fd1344daa390ae80336c45a45d49759ebecad',
  'bnb:first-use': '0x6e4bf8a92eb569fb4aa34a5d5eab4799ab86f6aa40fe405d59cba6498c669f7d',
  'bnb:subsequent': '0x82f343dcd100715d5693d68fbdcccdaf1467c3c5626391501d1f7b579d279047',
};
const coreAbi = parseAbi([
  'function getOutboundTxGasAndFees(address,uint256) view returns (address gasToken,uint256 gasFee,uint256 protocolFee,uint256 gasPrice,string chainNamespace,uint256 gasLimitUsed)',
  'function baseGasLimitByChainNamespace(string) view returns (uint256)',
  'function gasPriceByChainNamespace(string) view returns (uint256)',
  'function gasTokenPRC20ByChainNamespace(string) view returns (address)',
  'function defaultFeeTier(address) view returns (uint24)',
  'function WPC() view returns (address)',
  'function isSupportedToken(address) view returns (bool)',
  'function protocolFeeByToken(address) view returns (uint256)',
]);
const evAbi = parseAbi([
  'event SwapAndBurnGas(address indexed gasToken, uint256 pcIn, uint256 gasFee, uint24 fee, address indexed caller)',
  'event UniversalTxOutbound(bytes32 indexed subTxId, address indexed sender, string chainNamespace, address indexed token, bytes recipient, uint256 amount, address gasToken, uint256 gasFee, uint256 gasLimit, bytes payload, uint256 protocolFee, address revertRecipient, uint8 txType, uint256 gasPrice)',
  'event OutboundMetered(bytes32 indexed id, address indexed engine, address indexed account, address token, uint256 amount)',
  'event SetSupportedToken(address indexed prc20, bool supported)',
  'event SetGasToken(string chainNamespace, address prc20)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const quoterAbi = parseAbi([
  'function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);
const prcAbi = parseAbi([
  'function SOURCE_CHAIN_NAMESPACE() view returns (string)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
]);
const big = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
const err = (e) => (e && (e.shortMessage || e.message) || String(e)).slice(0, 300);

async function main() {
  const c = createPublicClient({ transport: http(RPC, { timeout: 20000, retryCount: 2 }) });
  const out = { at: new Date().toISOString(), rpc: RPC, readOnly: true };
  out.chainId = await c.getChainId();
  const block = await c.getBlock();
  out.block = block.number; out.blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString();
  const bn = block.number;
  const read = (address, abi, functionName, args = []) =>
    c.readContract({ address, abi, functionName, args, blockNumber: bn });

  // 1. Live sends: receipts + gas swap evidence.
  out.sends = {};
  for (const [k, h] of Object.entries(PUSH_TXS)) {
    const r = { hash: h };
    try {
      const [tx, rc] = await Promise.all([c.getTransaction({ hash: h }), c.getTransactionReceipt({ hash: h })]);
      Object.assign(r, { status: rc.status, block: rc.blockNumber, from: rc.from, to: rc.to, txValue: tx.value,
        gasUsed: rc.gasUsed, effectiveGasPrice: rc.effectiveGasPrice, pushFeePaid: rc.gasUsed * rc.effectiveGasPrice });
      r.events = [];
      for (const l of rc.logs) {
        try {
          const d = decodeEventLog({ abi: evAbi, data: l.data, topics: l.topics });
          if (d.eventName === 'Transfer') continue;
          const a = d.args;
          if (d.eventName === 'UniversalTxOutbound')
            r.events.push({ ev: d.eventName, emitter: l.address, sender: a.sender, chain: a.chainNamespace, token: a.token,
              amount: a.amount, gasToken: a.gasToken, gasFee: a.gasFee, gasLimit: a.gasLimit, protocolFee: a.protocolFee,
              gasPrice: a.gasPrice, txType: a.txType, revertRecipient: a.revertRecipient, recipientLen: (a.recipient.length - 2) / 2,
              payloadLen: (a.payload.length - 2) / 2 });
          else r.events.push({ ev: d.eventName, emitter: l.address, ...a });
        } catch { /* not one of ours */ }
      }
    } catch (e) { r.error = err(e); }
    out.sends[k] = r;
  }

  // 2. Fee model inputs per chain and raw quotes.
  out.wpc = await read(CORE, coreAbi, 'WPC');
  out.chains = {};
  for (const [ns, gas] of Object.entries(GAS)) {
    const e = { gasPrc20: gas };
    try {
      e.registeredGasToken = await read(CORE, coreAbi, 'gasTokenPRC20ByChainNamespace', [ns]);
      e.baseGasLimit = await read(CORE, coreAbi, 'baseGasLimitByChainNamespace', [ns]);
      e.gasPrice = await read(CORE, coreAbi, 'gasPriceByChainNamespace', [ns]);
      e.defaultFeeTier = await read(CORE, coreAbi, 'defaultFeeTier', [gas]);
      e.protocolFee = await read(CORE, coreAbi, 'protocolFeeByToken', [gas]);
    } catch (x) { e.error = err(x); }
    const limits = ns.startsWith('solana') ? [0n, 960n, 1052n, 2285n, 1000000n] : [0n, 500000n, 2000000n];
    e.quotes = [];
    for (const gl of limits) {
      const q = { inputGasLimit: gl };
      try {
        const res = await read(CORE, coreAbi, 'getOutboundTxGasAndFees', [gas, gl]);
        Object.assign(q, { gasFee: res[1], protocolFee: res[2], gasPrice: res[3], gasLimitUsed: res[5] });
        // Exact PC the gas swap needs at this block (WPC -> gas token exact output).
        try {
          const data = encodeFunctionData({ abi: quoterAbi, functionName: 'quoteExactOutputSingle',
            args: [{ tokenIn: out.wpc, tokenOut: gas, amount: res[1], fee: e.defaultFeeTier, sqrtPriceLimitX96: 0n }] });
          const raw = await c.call({ to: QUOTER, data, blockNumber: bn });
          q.swapPcInRequired = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactOutputSingle', data: raw.data })[0];
        } catch (x) { q.swapQuoteError = err(x); }
      } catch (x) { q.error = err(x); }
      e.quotes.push(q);
    }
    out.chains[ns] = e;
  }

  // 3. PC/USD as the SDK oracle would see it for UEA signers from each origin.
  out.pcUsd = {};
  for (const [origin, stable] of Object.entries(STABLE_FOR_ORIGIN)) {
    const p = { stable };
    for (const fee of [500, 3000, 100, 10000]) {
      try {
        const data = encodeFunctionData({ abi: quoterAbi, functionName: 'quoteExactInputSingle',
          args: [{ tokenIn: out.wpc, tokenOut: stable, amountIn: 10n ** 18n, fee, sqrtPriceLimitX96: 0n }] });
        const raw = await c.call({ to: QUOTER, data, blockNumber: bn });
        p.fee = fee;
        p.oneWpcInStableRaw = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data: raw.data })[0];
        break;
      } catch (x) { p['err' + fee] = err(x); }
    }
    out.pcUsd[origin] = p;
  }

  // 4. PRC20 metadata (raw SOURCE_TOKEN_ADDRESS return bytes; type-agnostic).
  out.prc20 = {};
  const sel = '0x' + require(SDK + '/node_modules/viem').keccak256(require(SDK + '/node_modules/viem').toHex('SOURCE_TOKEN_ADDRESS()')).slice(2, 10);
  for (const [name, address] of Object.entries(PRC20)) {
    const m = { address };
    try { m.namespace = await read(address, prcAbi, 'SOURCE_CHAIN_NAMESPACE'); } catch (x) { m.namespaceError = err(x); }
    try { m.decimals = await read(address, prcAbi, 'decimals'); } catch (x) { m.decimalsError = err(x); }
    try { m.symbol = await read(address, prcAbi, 'symbol'); } catch (x) { m.symbolError = err(x); }
    try { m.totalSupply = await read(address, prcAbi, 'totalSupply'); } catch (x) { m.totalSupplyError = err(x); }
    try { m.isSupportedToken = await read(CORE, coreAbi, 'isSupportedToken', [address]); } catch (x) { m.isSupportedError = err(x); }
    try {
      const raw = (await c.call({ to: address, data: sel, blockNumber: bn })).data;
      m.sourceTokenRawLen = raw ? (raw.length - 2) / 2 : 0;
      if (raw && raw.length === 66) m.sourceTokenWord = raw;
      else if (raw && raw.length > 130) {
        const len = Number(BigInt('0x' + raw.slice(66, 130)));
        m.sourceTokenString = hexToString('0x' + raw.slice(130, 130 + len * 2));
      }
    } catch (x) { m.sourceTokenError = err(x); }
    out.prc20[name] = m;
  }

  // 5. Enumerate PRC20s announced by UniversalCore events (incomplete by construction).
  out.coreEvents = { supported: [], gasTokens: [] };
  const topicSupported = '0x' + require(SDK + '/node_modules/viem').keccak256(require(SDK + '/node_modules/viem').toHex('SetSupportedToken(address,bool)')).slice(2);
  const topicGas = '0x' + require(SDK + '/node_modules/viem').keccak256(require(SDK + '/node_modules/viem').toHex('SetGasToken(string,address)')).slice(2);
  try {
    for (const [kind, topic] of [['supported', topicSupported], ['gasTokens', topicGas]]) {
      const logs = await c.request({ method: 'eth_getLogs', params: [{ address: CORE, fromBlock: '0x0', toBlock: '0x' + bn.toString(16), topics: [topic] }] });
      for (const l of logs) {
        const d = decodeEventLog({ abi: evAbi, data: l.data, topics: l.topics });
        out.coreEvents[kind].push({ block: BigInt(l.blockNumber), ...d.args });
      }
    }
  } catch (x) { out.coreEvents.error = err(x); }
  // Metadata for every announced PRC20 not already in the SDK registry.
  const known = new Set(Object.values(PRC20).map((a) => a.toLowerCase()));
  out.unregistered = [];
  const seen = new Set();
  for (const e of [...out.coreEvents.supported, ...out.coreEvents.gasTokens]) {
    const a = (e.prc20 || '').toLowerCase();
    if (!a || known.has(a) || seen.has(a)) continue;
    seen.add(a);
    const m = { address: getAddress(a), lastEvent: e };
    try { m.namespace = await read(a, prcAbi, 'SOURCE_CHAIN_NAMESPACE'); } catch (x) { m.namespaceError = err(x); }
    try { m.symbol = await read(a, prcAbi, 'symbol'); } catch (x) { m.symbolError = err(x); }
    try { m.decimals = await read(a, prcAbi, 'decimals'); } catch (x) { m.decimalsError = err(x); }
    try {
      const raw = (await c.call({ to: a, data: sel, blockNumber: bn })).data;
      if (raw && raw.length === 66) m.sourceTokenWord = raw;
      else if (raw && raw.length > 130) {
        const len = Number(BigInt('0x' + raw.slice(66, 130)));
        m.sourceTokenString = hexToString('0x' + raw.slice(130, 130 + len * 2));
      }
    } catch (x) { m.sourceTokenError = err(x); }
    try { m.isSupportedToken = await read(CORE, coreAbi, 'isSupportedToken', [a]); } catch (x) { m.isSupportedError = err(x); }
    out.unregistered.push(m);
  }
  out.blockAfter = await c.getBlockNumber();
  fs.writeFileSync(process.argv[2], JSON.stringify(out, big, 2));
  console.log('ok', out.block, out.blockTimestamp);
}
main().catch((e) => { console.error(err(e)); process.exitCode = 1; });
