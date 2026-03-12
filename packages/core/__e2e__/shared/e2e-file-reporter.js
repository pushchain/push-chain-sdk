const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../../e2e-logs');

class E2EFileReporter {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this.logFile = process.env['E2E_LOG_FILE'] || this._resolveLogFile();
  }

  _resolveLogFile() {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    return path.join(
      LOG_DIR,
      `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    );
  }

  _append(text) {
    fs.appendFileSync(this.logFile, text + '\n');
  }

  onRunStart(results) {
    this._append('\n' + '='.repeat(80));
    this._append('E2E TEST RUN STARTED');
    this._append(`Timestamp: ${new Date().toISOString()}`);
    this._append(`Total test suites: ${results.numTotalTestSuites}`);
    this._append('='.repeat(80) + '\n');
  }

  onTestResult(_test, testResult) {
    const suiteName =
      testResult.testFilePath.split('__e2e__/')[1] ||
      testResult.testFilePath;
    const duration = (
      (testResult.perfStats.end - testResult.perfStats.start) /
      1000
    ).toFixed(2);
    const status = testResult.numFailingTests > 0 ? 'FAIL' : 'PASS';

    this._append(
      `\n--- Suite: ${suiteName} [${status}] (${duration}s) ---`
    );

    for (const tc of testResult.testResults) {
      const tcDuration = tc.duration
        ? (tc.duration / 1000).toFixed(2)
        : 'N/A';
      const icon =
        tc.status === 'passed'
          ? 'PASS'
          : tc.status === 'failed'
            ? 'FAIL'
            : 'SKIP';
      this._append(`  [${icon}] ${tc.fullName} (${tcDuration}s)`);

      if (tc.status === 'failed' && tc.failureMessages.length > 0) {
        for (const msg of tc.failureMessages) {
          this._append(`    ERROR: ${msg.split('\n')[0]}`);
        }
      }
    }
  }

  onRunComplete(_testContexts, results) {
    const totalTime = (
      results.testResults.reduce(
        (sum, r) => sum + (r.perfStats.end - r.perfStats.start),
        0
      ) / 1000
    ).toFixed(2);

    this._append('\n' + '='.repeat(80));
    this._append('E2E TEST RUN SUMMARY');
    this._append('='.repeat(80));
    this._append(`Total Suites:  ${results.numTotalTestSuites}`);
    this._append(`Passed Suites: ${results.numPassedTestSuites}`);
    this._append(`Failed Suites: ${results.numFailedTestSuites}`);
    this._append(`Total Tests:   ${results.numTotalTests}`);
    this._append(`Passed Tests:  ${results.numPassedTests}`);
    this._append(`Failed Tests:  ${results.numFailedTests}`);
    this._append(`Skipped Tests: ${results.numPendingTests}`);
    this._append(`Total Time:    ${totalTime}s`);
    this._append(`Completed at:  ${new Date().toISOString()}`);
    this._append('='.repeat(80) + '\n');
  }
}

module.exports = E2EFileReporter;
