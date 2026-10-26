const fs = require('node:fs');
const CiReporter = require('../../../../__e2e__/ci/ci-reporter');
export {};
it('reports final counters without relying on the pre-final Jest success flag', () => {
  const write = jest
    .spyOn(fs, 'writeFileSync')
    .mockImplementation(() => undefined);
  const mkdir = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
  try {
    const report = (extra: object) => {
      new CiReporter().onRunComplete(null, {
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        success: false,
        testResults: [],
        ...extra,
      });
      return JSON.parse(
        write.mock.calls[write.mock.calls.length - 1][1] as string
      );
    };
    expect(report({})).toMatchObject({
      success: true,
      jestReportedSuccess: false,
    });
    expect(report({ numFailedTestSuites: 1 }).success).toBe(false);
    expect(report({ numRuntimeErrorTestSuites: 1 }).success).toBe(false);
    expect(report({ wasInterrupted: true }).success).toBe(false);
    expect(report({ numPassedTests: 0, numPendingTests: 1 }).success).toBe(
      false
    );
  } finally {
    write.mockRestore();
    mkdir.mockRestore();
  }
});
