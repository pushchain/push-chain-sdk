import { getAddress } from 'viem';
import type { PreparedRule } from '../codec/rules';
import { chainHash } from '../codec/rules';
import type { ActiveRule } from '../reads/rules';
import { AgenticError, AGENTIC_ERROR_CODE } from '../errors';

/** SDK creation policy; existing contract overlaps still use AMBIGUOUS_RULE at send. */
export function assertNoDuplicateRules(
  prepared: readonly PreparedRule[],
  existing: readonly ActiveRule[] = []
): void {
  const keys = new Set(
    existing.map((r) => `${getAddress(r.agent)}:${r.chainHash}`)
  );
  for (const rule of prepared) {
    const key = `${getAddress(rule.agent)}:${chainHash(rule.chainNamespace)}`;
    if (keys.has(key))
      throw new AgenticError(
        AGENTIC_ERROR_CODE.DUPLICATE_RULE,
        `an enabled rule already names ${rule.agent} for ${rule.chainNamespace}`,
        {
          hint: 'Put multiple allowed calls in one rule or update the existing rule.',
          details: { agent: rule.agent, chainNamespace: rule.chainNamespace },
        }
      );
    keys.add(key);
  }
}
