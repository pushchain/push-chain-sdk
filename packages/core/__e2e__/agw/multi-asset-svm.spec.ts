/** SVM public mapping/cluster acceptance remains pending; wire structs are delivered. */
const d = process.env['AGW_E2E'] === '1' ? describe : describe.skip;

d('agw pending svm', () => {
  it.todo(
    'svm: wallet CEA PDA / token accounts derived from the wallet and registry gateway'
  );
  it.todo(
    'svm: program/discriminator allow-list and account/data pins enforced on a real destination'
  );
  it.todo('svm: aggregator substitution and ratio floors rejected');
});
