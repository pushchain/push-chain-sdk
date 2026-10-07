import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import { MOVEABLE_TOKENS, type MoveableToken } from '../constants/tokens';
import { SYNTHETIC_PUSH_ERC20 } from '../constants/chain';

/** Shared pure origin-to-PRC20 mapping; no signer or network reads. */
export function getPRC20Address(
  token: MoveableToken | { chain: string; address: string },
  options?: { network?: PUSH_NETWORK }
): {
  address: `0x${string}`;
  chain: CHAIN;
  symbol: string;
  decimals: number;
  network: PUSH_NETWORK;
} {
  const network = options?.network ?? PUSH_NETWORK.TESTNET_DONUT;

  const assertDeployed = (
    addr: string | undefined,
    ctx: string
  ): `0x${string}` => {
    if (!addr || addr === '0xTBD') {
      throw new Error(
        `PRC20 address not available for ${ctx} on network ${network}`
      );
    }
    return addr as `0x${string}`;
  };

  // PushChainMoveableToken (pETH, pSOL, pUSDT(BNB), …) carries its PRC-20 address
  // and origin `sourceChain` directly — no registry lookup needed.
  const pcToken = token as Partial<{
    prc20Address: `0x${string}`;
    sourceChain: CHAIN;
    symbol: string;
    decimals: number;
  }>;
  if (pcToken.prc20Address) {
    return {
      address: assertDeployed(
        pcToken.prc20Address,
        `${pcToken.symbol ?? 'token'} (${pcToken.sourceChain ?? 'unknown'})`
      ),
      chain: pcToken.sourceChain as CHAIN,
      symbol: pcToken.symbol as string,
      decimals: pcToken.decimals as number,
      network,
    };
  }

  // Infer origin chain, symbol, decimals by matching against MOVEABLE_TOKENS
  let originChain: CHAIN | undefined;
  let tokenSymbol: string | undefined;
  let tokenDecimals: number | undefined;

  if ('symbol' in token) {
    // MoveableToken path: infer chain by symbol + address
    for (const [key, list] of Object.entries(MOVEABLE_TOKENS)) {
      const k = key as CHAIN;
      const match = (list ?? []).find(
        (t) => t.symbol === token.symbol && t.address === token.address
      );
      if (match) {
        originChain = k;
        tokenSymbol = match.symbol;
        tokenDecimals = match.decimals;
        break;
      }
    }
  } else {
    // { chain, address } path: trust the provided chain and resolve symbol via registry
    originChain = token.chain as CHAIN;
    const list = MOVEABLE_TOKENS[originChain] ?? [];
    const match = list.find((t) => t.address === token.address);
    if (match) {
      tokenSymbol = match.symbol;
      tokenDecimals = match.decimals;
    }
  }

  if (!originChain || !tokenSymbol || tokenDecimals === undefined) {
    throw new Error('Unable to infer origin chain or token symbol for token');
  }

  const map = SYNTHETIC_PUSH_ERC20[network];
  if (!map) {
    throw new Error(`No PRC20 address map configured for network: ${network}`);
  }

  // Map token → synthetic key by origin chain family
  const isEthFamily =
    originChain === CHAIN.ETHEREUM_MAINNET ||
    originChain === CHAIN.ETHEREUM_SEPOLIA;
  const isArbFamily = originChain === CHAIN.ARBITRUM_SEPOLIA;
  const isBaseFamily = originChain === CHAIN.BASE_SEPOLIA;
  const isBnbFamily = originChain === CHAIN.BNB_TESTNET;
  const isSolFamily = originChain === CHAIN.SOLANA_DEVNET;

  let key:
    | 'pETH'
    | 'pETH_ARB'
    | 'pETH_BASE'
    | 'pBNB'
    | 'pSOL'
    | 'USDT_ETH'
    | 'USDT_ARB'
    | 'USDT_SOL'
    | 'USDT_BSC'
    | 'USDT_BASE'
    | 'USDC_ETH'
    | 'USDC_ARB'
    | 'USDC_SOL'
    | 'USDC_BSC'
    | 'USDC_BASE';

  switch (tokenSymbol) {
    case 'ETH': {
      if (isEthFamily) key = 'pETH';
      else if (isArbFamily) key = 'pETH_ARB';
      else if (isBaseFamily) key = 'pETH_BASE';
      else
        throw new Error('Unsupported ETH origin chain for synthetic mapping');
      break;
    }
    case 'SOL': {
      if (!isSolFamily)
        throw new Error('SOL token provided but origin is not Solana');
      key = 'pSOL';
      break;
    }
    case 'BNB': {
      if (!isBnbFamily)
        throw new Error('BNB token provided but origin is not BNB Testnet');
      key = 'pBNB';
      break;
    }
    case 'USDT': {
      if (isEthFamily) key = 'USDT_ETH';
      else if (isArbFamily) key = 'USDT_ARB';
      else if (isBaseFamily) key = 'USDT_BASE';
      else if (isBnbFamily) key = 'USDT_BSC';
      else if (isSolFamily) key = 'USDT_SOL';
      else
        throw new Error('Unsupported USDT origin chain for synthetic mapping');
      break;
    }
    case 'USDC': {
      if (isEthFamily) key = 'USDC_ETH';
      else if (isArbFamily) key = 'USDC_ARB';
      else if (isBaseFamily) key = 'USDC_BASE';
      else if (isBnbFamily) key = 'USDC_BSC';
      else if (isSolFamily) key = 'USDC_SOL';
      else
        throw new Error('Unsupported USDC origin chain for synthetic mapping');
      break;
    }
    default:
      throw new Error(`Unsupported token symbol: ${tokenSymbol}`);
  }

  return {
    address: assertDeployed(map[key], `${tokenSymbol} on ${originChain}`),
    chain: originChain,
    symbol: tokenSymbol,
    decimals: tokenDecimals,
    network,
  };
}
