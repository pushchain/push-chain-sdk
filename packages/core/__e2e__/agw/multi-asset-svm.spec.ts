/**
 * Scenario 11 — PENDING SPECIFICATION, not tests. These need artifacts that
 * do not exist yet; they are recorded as `it.todo` (reported as todo, never as
 * passes) and are not registered in the CI manifest.
 *
 *  - Multi-asset universal rules: A05 (Harsh H4.2, Zaryab Z1.1/Z1.2) — wire
 *    format, per-token counters and expected-spend assertion ABI + vectors.
 *  - SVM destinations: A05/A07 + Harsh H4.4 — public rule shape, terms and
 *    payload fixtures, deployed capability; integrator obligations 19–23.
 */
const d = process.env['AGW_E2E'] === '1' ? describe : describe.skip;

d('agw pending multi-asset and svm', () => {
  it.todo('multi-asset: per-token maxPerCall/maxTotal enforced independently, in each token’s units');
  it.todo('multi-asset: omitted maxTotal is unlimited, explicit zero is zero');
  it.todo('multi-asset: duplicate assets rejected; empty assets[] routes call-only outbounds');
  it.todo('multi-asset: rules.update asserts every old-rule asset total atomically');
  it.todo('svm: wallet CEA PDA / token accounts derived from the wallet and registry gateway');
  it.todo('svm: program/discriminator allow-list and account/data pins enforced on a real destination');
  it.todo('svm: aggregator substitution and ratio floors rejected');
});
