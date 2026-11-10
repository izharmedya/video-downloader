#!/usr/bin/env node

/**
 * Adversarial Test Harness Runner
 * Video Downloader Tier 5 Adversarial Stress & Vulnerability Suite
 */

const path = require('path');
const fs = require('fs');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const suites = [
  require('./test-adv1-binary-resolution'),
  require('./test-adv2-shell-injection'),
  require('./test-adv3-subprocess-env'),
  require('./test-adv4-nonyoutube-urls')
];

async function run() {
  console.log(`\n${colors.bold}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bold}  Video Downloader — Empirical Adversarial Verification Suite${colors.reset}`);
  console.log(`${colors.cyan}================================================================${colors.reset}\n`);

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const failures = [];
  const startTime = Date.now();

  for (const suite of suites) {
    console.log(`${colors.bold}${colors.blue}▶ ${suite.name}${colors.reset}`);

    for (const test of (suite.tests || [])) {
      totalTests++;
      const tStart = Date.now();
      try {
        await Promise.race([
          test.run(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Test timed out after 45000ms')), 45000)
          )
        ]);
        const dur = Date.now() - tStart;
        passedTests++;
        console.log(`  ${colors.green}✔ PASS${colors.reset} ${test.name} ${colors.gray}(${dur}ms)${colors.reset}`);
      } catch (err) {
        const dur = Date.now() - tStart;
        failedTests++;
        console.log(`  ${colors.red}✖ FAIL${colors.reset} ${test.name} ${colors.gray}(${dur}ms)${colors.reset}`);
        console.log(`    ${colors.red}Error: ${err.message}${colors.reset}`);
        if (err.stack) {
          const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
          console.log(`    ${colors.gray}${stackLines}${colors.reset}`);
        }
        failures.push({
          suite: suite.name,
          test: test.name,
          error: err.message
        });
      }
    }
    console.log('');
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`${colors.bold}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bold}  Adversarial Execution Summary${colors.reset}`);
  console.log(`${colors.cyan}================================================================${colors.reset}`);
  console.log(`  Total Tests:    ${totalTests}`);
  console.log(`  Passed Tests:   ${colors.green}${passedTests}${colors.reset}`);
  console.log(`  Failed Tests:   ${failedTests > 0 ? colors.red : colors.gray}${failedTests}${colors.reset}`);
  console.log(`  Duration:       ${durationSec}s`);
  console.log(`${colors.cyan}================================================================${colors.reset}\n`);

  if (failedTests > 0) {
    console.log(`${colors.bold}${colors.red}FAILURES DETECTED:${colors.reset}`);
    for (const f of failures) {
      console.log(`- [${f.suite}] ${f.test}: ${f.error}`);
    }
    console.log('');
    process.exit(1);
  } else {
    console.log(`${colors.bold}${colors.green}✔ ALL ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY${colors.reset}\n`);
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
