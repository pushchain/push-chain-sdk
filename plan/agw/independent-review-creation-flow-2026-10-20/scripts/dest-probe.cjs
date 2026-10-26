// Independent read-only destination probe (EVM testnets). No keys, no signing.
const fs = require('node:fs');
const SDK = '/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk';
const { createPublicClient, http, parseAbi, getAddress, zeroAddress } = require(SDK + '/node_modules/viem');
const err = (e) => (e && (e.shortMessage || e.message) || String(e)).slice(0, 200);
const big = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
const abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function factory() view returns (address)',
  'function getPool(address,address,uint24) view returns (address)',
  'function liquidity() view returns (uint128)',
  'function getReservesList() view returns (address[])',
  'function underlyingToken() view returns (address)',
  'function getEthUsdPrice() view returns (uint256,uint8)',
  'function isSupportedToken(address) view returns (bool)',
]);
const C = {
  'eip155:11155111': {
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com', vault: '0xD019Eb12D0d6eF8D299661f22B4B7d262eD4b965',
    gateway: '0x05bD7a3D18324c1F7e216f7fBF2b15985aE5281A', router: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
    aave: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', eigenStrategy: '0x424246eF71b01ee33aA33aC590fd9a0855F5eFbc',
    tokens: {
      'WETH(dex)': '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', 'USDC(circle,dex)': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      'LINK(aave,lending)': '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5', 'WETH(eigen,staking)': '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
      'USDT(routed mock)': '0xC4230aEaFcF6b8B49a7b4e53886420f00ff71876', 'USDC(routed mock)': '0x97F477B7f970D47a87B42869ceeace218106152a',
      'stETH(routed)': '0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af',
    },
    pairs: [['WETH(dex)', 'USDC(circle,dex)'], ['WETH(dex)', 'USDC(routed mock)'], ['WETH(dex)', 'USDT(routed mock)']],
  },
  'eip155:84532': {
    rpc: 'https://base-sepolia-rpc.publicnode.com', vault: '0xb4Ba4D5542D1dD48BD3589543660B265B41f16CB',
    gateway: '0xFD4fef1F43aFEc8b5bcdEEc47f35a1431479aC16', router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    aave: '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27',
    tokens: {
      'WETH(dex,canonical)': '0x4200000000000000000000000000000000000006', 'USDC(circle,dex)': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      'LINK(aave,lending)': '0x810D46F9a9027E28F9B01F75E2bdde839dA61115', 'USDbC(moonwell)': '0x4616975f7E6045FD9737e95bC527e9e14c727BD2',
      'WETH(moonwell)': '0x663A6F02d547dFd639BF689FED298712f2FB69Fb', 'USDT(routed mock)': '0x4D7646B9eE3D68F4b0F135B5cbc66B00819F6b61',
      'USDC(routed mock)': '0x5c3504F0E3bA28FDc1F74234fE936518276AaBB8', 'SDK BASE WETH entry (Sepolia addr)': '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    },
    pairs: [['WETH(dex,canonical)', 'USDC(circle,dex)'], ['WETH(dex,canonical)', 'USDC(routed mock)'], ['WETH(dex,canonical)', 'USDT(routed mock)']],
  },
  'eip155:421614': {
    rpc: 'https://arbitrum-sepolia-rpc.publicnode.com', vault: '0x233B1B1B378eb0Aa723097634025A47C4b73A8F7',
    gateway: '0x2cd870e0166Ba458dEC615168Fd659AacD795f34', router: '0x101F443B4d1b059569D643917553c771E1b9663E',
    aave: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    tokens: {
      'WETH(dex)': '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', 'USDC(circle,dex,lending)': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      'USDT(routed mock)': '0xE30928528f52CAEeB75fB07837e22d77D47e9c07', 'USDC(routed mock)': '0x5dd39b0b3610F666F631a6506b7713EF83e1Ac5C',
    },
    pairs: [['WETH(dex)', 'USDC(circle,dex,lending)'], ['WETH(dex)', 'USDC(routed mock)'], ['WETH(dex)', 'USDT(routed mock)']],
  },
  'eip155:97': {
    rpc: 'https://bsc-testnet-rpc.publicnode.com', vault: '0xE52AC4f8DD3e0263bDF748F3390cdFA1f02be881',
    gateway: '0x44aFFC61983F4348DdddB886349eb992C061EaC0', router: '0x9a489505a00cE272eAa5e07Dba6491314CaE3796',
    tokens: {
      'WBNB(dex)': '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', 'USDT(venus,dex,lending)': '0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c',
      'USDC(venus,lending)': '0x16227D60f7a0e586C66B005219dfc887D13C9531', 'USDT(routed mock)': '0xE935d9c9C24D02E61186c640cc01d713C876d40F',
      'USDC(routed mock)': '0xA8802F96cAd0d45343d9bc660B6f7d80050A660b',
    },
    pairs: [['WBNB(dex)', 'USDT(venus,dex,lending)'], ['WBNB(dex)', 'USDT(routed mock)'], ['WBNB(dex)', 'USDC(routed mock)']],
  },
};
async function main() {
  const out = { at: new Date().toISOString(), readOnly: true, chains: {} };
  for (const [ns, cfg] of Object.entries(C)) {
    const c = createPublicClient({ transport: http(cfg.rpc, { timeout: 15000, retryCount: 2 }) });
    const e = { rpc: cfg.rpc };
    out.chains[ns] = e;
    try {
      e.chainId = await c.getChainId();
      if (e.chainId !== Number(ns.split(':')[1])) throw new Error('chain mismatch');
      const bn = await c.getBlockNumber(); e.block = bn;
      const read = (address, functionName, args = []) => c.readContract({ address, abi, functionName, args, blockNumber: bn });
      e.vaultNativeBalance = await c.getBalance({ address: cfg.vault, blockNumber: bn });
      e.tokens = {};
      for (const [label, t] of Object.entries(cfg.tokens)) {
        const r = { address: getAddress(t) };
        try {
          const code = await c.getCode({ address: t, blockNumber: bn });
          r.hasCode = !!code && code !== '0x';
          r.codeBytes = code ? (code.length - 2) / 2 : 0;
          r.hasDepositSelector = !!code && code.toLowerCase().includes('d0e30db0');
          r.hasWithdrawSelector = !!code && code.toLowerCase().includes('2e1a7d4d');
        } catch (x) { r.codeError = err(x); }
        if (r.hasCode) {
          try { r.symbol = await read(t, 'symbol'); } catch (x) { r.symbolError = err(x); }
          try { r.decimals = await read(t, 'decimals'); } catch (x) { r.decimalsError = err(x); }
          try { r.vaultBalance = await read(t, 'balanceOf', [cfg.vault]); } catch (x) { r.vaultBalanceError = err(x); }
          try { r.gatewayInboundSupported = await read(cfg.gateway, 'isSupportedToken', [t]); } catch (x) { r.gatewayError = err(x); }
        }
        e.tokens[label] = r;
      }
      try {
        e.factory = await read(cfg.router, 'factory');
        e.pools = [];
        for (const [a, b] of cfg.pairs) {
          for (const fee of [100, 500, 2500, 3000, 10000]) {
            try {
              const pool = await read(e.factory, 'getPool', [cfg.tokens[a], cfg.tokens[b], fee]);
              if (pool === zeroAddress) continue;
              e.pools.push({ pair: [a, b], fee, pool, liquidity: await read(pool, 'liquidity') });
            } catch (x) { e.pools.push({ pair: [a, b], fee, error: err(x) }); }
          }
        }
      } catch (x) { e.factoryError = err(x); }
      if (cfg.aave) {
        try {
          const reserves = await read(cfg.aave, 'getReservesList');
          e.aaveReserves = [];
          for (const r of reserves) {
            let symbol, decimals, dep;
            try { symbol = await read(r, 'symbol'); } catch { symbol = '?'; }
            try { decimals = await read(r, 'decimals'); } catch { decimals = '?'; }
            try { const code = await c.getCode({ address: r, blockNumber: bn }); dep = code.toLowerCase().includes('d0e30db0'); } catch { dep = '?'; }
            e.aaveReserves.push({ reserve: r, symbol, decimals, hasDepositSelector: dep });
          }
        } catch (x) { e.aaveError = err(x); }
      }
      if (cfg.eigenStrategy) {
        try { e.eigenUnderlying = await read(cfg.eigenStrategy, 'underlyingToken'); } catch (x) { e.eigenError = err(x); }
      }
      if (ns === 'eip155:11155111') {
        try { const [p, d] = await read(cfg.gateway, 'getEthUsdPrice'); e.ethUsd1e18 = p; e.ethUsdFeedDecimals = d; } catch (x) { e.ethUsdError = err(x); }
      }
    } catch (x) { e.error = err(x); }
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(out, big, 2));
  console.log('ok');
}
main().catch((e) => { console.error(err(e)); process.exitCode = 1; });
