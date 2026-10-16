/** Public section-7 discovery constants; deployment wiring stays internal. */
export const AGENTIC = Object.freeze({
  WALLET: 'agentic:wallet' as const,
  PRESETS: Object.freeze({
    CATEGORY: Object.freeze({
      DEXES: 'DEXES' as const,
      LENDING: 'LENDING' as const,
      STAKING: 'STAKING' as const,
      PREDICTION: 'PREDICTION' as const,
    }),
  }),
});
