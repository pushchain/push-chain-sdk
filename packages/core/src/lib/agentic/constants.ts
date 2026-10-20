import { JOB_VOCABULARY, PRINCIPAL } from '../job-spec/constants';
import { DONUT_MARKETPLACE } from '../market/deployment';
/** Public vocabulary. JOB.ADDRESS is the explicit per-chain job integration surface. */
export const AGENTIC = Object.freeze({
  WALLET: 'agentic:wallet' as const,
  PRINCIPAL,
  JOB: Object.freeze({
    ...JOB_VOCABULARY,
    ADDRESS: Object.freeze({
      'eip155:42101': Object.freeze({
        KERNEL: DONUT_MARKETPLACE.kernel,
        HOOK: DONUT_MARKETPLACE.hook,
        EVALUATOR: DONUT_MARKETPLACE.evaluator,
      }),
    }),
  }),
  PRESETS: Object.freeze({
    CATEGORY: Object.freeze({
      DEXES: 'DEXES' as const,
      LENDING: 'LENDING' as const,
      STAKING: 'STAKING' as const,
      PREDICTION: 'PREDICTION' as const,
    }),
  }),
});
