import { CHAIN, NETWORK } from './enums';
import { pushTestnet } from '../pushChain';

// NOTE - Only include enums & constants which need to be exported to end user.
export const CONSTANTS = {
  NETWORK,
  CHAIN,
  VIEM_PUSH_TESTNET: pushTestnet,
};
