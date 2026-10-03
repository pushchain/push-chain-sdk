import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticHex } from '../agentic.types';

/**
 * PROVISIONAL product-policy boundary (one place, both assumptions):
 *
 *  A01 (Harsh H1): known approval-granting selectors are rejected in agent
 *      rules, because the rule cannot pin an arbitrary approved spender. Owners
 *      set bounded approvals through the owner door instead. Filtering known
 *      selectors is one safeguard, not a complete target-safety boundary.
 *  A02 (Harsh H2): NativeRule stays one action, and a native agent send must be
 *      a single call — no transaction arrays through the agent door, and no
 *      sequential fallback. Owner batches and bounded EVM destination
 *      multicalls are unaffected.
 */
export const APPROVAL_SELECTORS: Readonly<Record<string, string>> = {
  '0x095ea7b3': 'approve(address,uint256)',
  '0x39509351': 'increaseAllowance(address,uint256)',
  '0xa22cb465': 'setApprovalForAll(address,bool)',
  '0xd505accf': 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  '0x2b67b570': 'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)',
  '0x87517c45': 'approve(address,address,uint160,uint48)',
};

export function assertNotApprovalSelector(selector: AgenticHex, where: string): void {
  const name = APPROVAL_SELECTORS[selector.toLowerCase()];
  if (name) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `${where}: ${name} grants token spending to an address the rule cannot pin`,
      {
        hint:
          'Set bounded approvals from the owner door (owner-mode sendTransaction) instead of granting them to an agent. Provisional policy A01.',
        details: { selector, assumption: 'A01' },
      }
    );
  }
}

export function assertSingleAgentCall(calls: number): void {
  if (calls !== 1) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE,
      `the agent door dispatches exactly one native call; got ${calls}`,
      {
        hint:
          'Send each native action separately, or use an owner client for batches. Provisional scope A02.',
        details: { assumption: 'A02' },
      }
    );
  }
}
