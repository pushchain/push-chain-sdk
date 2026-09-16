import { CALLBACK_BUDGET_BUFFER } from '../constants/read-state';
import { InvalidReadQueryError } from './errors';

/**
 * Gas price assumed when the chain reports 0 (dev chains). Donut charges 1 gwei per
 * gas on module fulfil txs (verified: 118,289 gas → 118,289 × 10⁹ wei burned).
 */
export const MIN_CALLBACK_BUDGET_GAS_PRICE = 1_000_000_000n;

/**
 * Size the callback budget escrowed on top of the protocol fee.
 *
 *   msg.value = protocolFee + callbackBudget
 *
 * The node refuses to fulfil a read whose budget cannot cover its callback
 * ("callback budget too small") and lets it expire with the fee already spent, so a
 * zero or thin budget is a guaranteed loss. This errs high by `buffer`; whatever the
 * callback does not burn is pushed back to `refundTo` at settlement.
 */
export function sizeCallbackBudget(
  callbackGasLimit: bigint,
  pushGasPrice: bigint,
  buffer: number = CALLBACK_BUDGET_BUFFER,
): bigint {
  if (callbackGasLimit <= 0n) throw new InvalidReadQueryError('callbackGasLimit must be > 0');
  if (!Number.isInteger(buffer) || buffer < 1) throw new InvalidReadQueryError('budget buffer must be an integer ≥ 1');
  const price = pushGasPrice > 0n ? pushGasPrice : MIN_CALLBACK_BUDGET_GAS_PRICE;
  const budget = callbackGasLimit * price * BigInt(buffer);
  // cannot be zero by construction, but the invariant is worth stating
  return budget > 0n ? budget : 1n;
}
