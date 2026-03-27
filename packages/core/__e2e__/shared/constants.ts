import { MOVEABLE_TOKENS } from '../../src/lib/constants/tokens';
import { CHAIN } from '../../src/lib/constants/enums';

// Common test target addresses
export const TEST_TARGET_ADDRESS =
  '0x35B84d6848D16415177c64D64504663b998A6ab4' as `0x${string}`;
export const DIFFERENT_ADDRESS =
  '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;
export const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as `0x${string}`;
export const TEST_TARGET_1 =
  '0x1234567890123456789012345678901234567890' as `0x${string}`;
export const TEST_TARGET_2 =
  '0x0987654321098765432109876543210987654321' as `0x${string}`;

// Reliable Sepolia RPC (default publicnode can be flaky)
export const SEPOLIA_RPC = 'https://1rpc.io/sepolia';

// Token helpers
export function getToken(chain: CHAIN, symbol: string) {
  const tokens = MOVEABLE_TOKENS[chain] || [];
  const token = tokens.find((t) => t.symbol === symbol);
  if (!token) throw new Error(`${symbol} token not found for chain ${chain}`);
  return token;
}
