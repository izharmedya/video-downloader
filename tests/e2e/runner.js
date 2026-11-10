#!/usr/bin/env node

/**
 * Master E2E Test Suite Runner
 * Video Downloader 4-Tier Automated Test Infrastructure
 *
 * Usage:
 *   node tests/e2e/runner.js                  # Run all tiers (Tiers 1-4)
 *   node tests/e2e/runner.js --tier=1         # Run Tier 1 Feature Coverage
 *   node tests/e2e/runner.js --tier=2         # Run Tier 2 Boundary Cases
 *   node tests/e2e/runner.js --tier=3         # Run Tier 3 Pairwise Combinations
 *   node tests/e2e/runner.js --tier=4         # Run Tier 4 Real-World Scenarios
 *   node tests/e2e/runner.js --filter="4K"    # Filter tests matching regex
 *   node tests/e2e/runner.js --bail           # Abort on first test failure
 */

const fs = require('fs');
const path = require('path');

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    tiers: null,
    filter: null,
    bail: false,
    tap: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--bail' || arg === '-b') {
      options.bail = true;
    } else if (arg === '--tap') {
      options.tap = true;
    } else if (arg.startsWith('--tier=')) {
      const val = arg.split('=')[1].trim();
      options.tiers = val.split(',').map(t => parseInt(t.replace(/\D/g, ''), 10)).filter(Boolean);
    } else if (arg.startsWith('--filter=')) {
      options.filter = new RegExp(arg.split('=')[1].trim(), 'i');
    } else if (/^[1-4]$/.test(arg)) {
      options.tiers = [parseInt(arg, 10)];
    }
  }

  return options;
}

function printUsage() {
  console.log(`
${colors.bold}Video Downloader E2E Test Suite Runner${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node tests/e2e/runner.js [options]

${colors.cyan}Options:${colors.reset}
  --tier=N         Run specific tier (1, 2, 3, 4, or comma-separated list like 1,3)
  --filter=REGEX   Only run test cases whose names match the given regex
  --bail           Exit immediately upon the first encountered test failure
  --tap            Produce Test Anything Protocol (TAP) formatted output
  --help, -h       Show this help dialog

${colors.cyan}Tiers:${colors.reset}
  Tier 1: Feature Coverage (Features 1-14, >=5 tests per feature)
  Tier 2: Boundary & Corner Cases (Features 1-14, >=5 tests per feature)
  Tier 3: Pairwise Combinations (Cross-feature interactions, 20+ tests)
  Tier 4: Real-World Scenarios (End-user application workflows, >=7 tests)
`);
}

function findTestFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.js') && !f.startsWith('.'))
    .sort()
    .map(f => path.join(dirPath, f));
}

async function runTestWithTimeout(testFn, timeoutMs = 75000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Test timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    Promise.resolve()
      .then(() => testFn())
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const baseDir = __dirname;
  const tierConfigs = [
    { tier: 1, name: 'Tier 1: Feature Coverage', dir: path.join(baseDir, 'tier1-features') },
    { tier: 2, name: 'Tier 2: Boundary & Corner Cases', dir: path.join(baseDir, 'tier2-boundaries') },
    { tier: 3, name: 'Tier 3: Pairwise Combinations', dir: path.join(baseDir, 'tier3-pairwise') },
    { tier: 4, name: 'Tier 4: Real-World Scenarios', dir: path.join(baseDir, 'tier4-scenarios') },
  ];

  const selectedConfigs = options.tiers
    ? tierConfigs.filter(tc => options.tiers.includes(tc.tier))
    : tierConfigs;

  console.log(`\n${colors.bold}${colors.cyan}====================================================${colors.reset}`);
  console.log(`${colors.bold}  Video Downloader — Opaque-Box E2E Test Suite${colors.reset}`);
  console.log(`${colors.cyan}====================================================${colors.reset}`);
  console.log(`${colors.gray}Active Tiers: ${selectedConfigs.map(c => `Tier ${c.tier}`).join(', ')}${colors.reset}`);
  if (options.filter) console.log(`${colors.gray}Filter Pattern: ${options.filter}${colors.reset}`);
  console.log('');

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  const failures = [];
  const overallStart = Date.now();

  for (const config of selectedConfigs) {
    const files = findTestFiles(config.dir);
    if (files.length === 0) continue;

    console.log(`\n${colors.bold}${colors.blue}▶ ${config.name}${colors.reset} (${files.length} test files)`);

    for (const file of files) {
      let suite;
      try {
        suite = require(file);
      } catch (err) {
        console.log(`  ${colors.red}✖ Failed to load suite file: ${path.basename(file)}${colors.reset}`);
        console.error(err);
        failedTests++;
        continue;
      }

      console.log(`  ${colors.bold}${suite.name || path.basename(file)}${colors.reset}`);

      for (const test of (suite.tests || [])) {
        if (options.filter && !options.filter.test(test.name)) {
          skippedTests++;
          continue;
        }

        totalTests++;
        const testStart = Date.now();

        try {
          await runTestWithTimeout(test.run, 90000);
          const duration = Date.now() - testStart;
          passedTests++;
          console.log(`    ${colors.green}✔${colors.reset} ${test.name} ${colors.gray}(${duration}ms)${colors.reset}`);
        } catch (err) {
          const duration = Date.now() - testStart;
          failedTests++;
          console.log(`    ${colors.red}✖${colors.reset} ${test.name} ${colors.gray}(${duration}ms)${colors.reset}`);
          failures.push({
            suite: suite.name,
            test: test.name,
            file: path.relative(process.cwd(), file),
            error: err,
          });

          if (options.bail) {
            console.log(`\n${colors.red}Bailing after first failure...${colors.reset}`);
            break;
          }
        }
      }

      if (options.bail && failedTests > 0) break;
    }

    if (options.bail && failedTests > 0) break;
  }

  const overallDuration = ((Date.now() - overallStart) / 1000).toFixed(2);

  // Summary Report
  console.log(`\n${colors.bold}${colors.cyan}====================================================${colors.reset}`);
  console.log(`${colors.bold}  Test Execution Summary${colors.reset}`);
  console.log(`${colors.cyan}====================================================${colors.reset}`);
  console.log(`  Total Tests:    ${colors.bold}${totalTests}${colors.reset}`);
  console.log(`  Passed Tests:   ${colors.green}${colors.bold}${passedTests}${colors.reset}`);
  console.log(`  Failed Tests:   ${failedTests > 0 ? colors.red : colors.gray}${colors.bold}${failedTests}${colors.reset}`);
  if (skippedTests > 0) {
    console.log(`  Skipped Tests:  ${colors.yellow}${skippedTests}${colors.reset}`);
  }
  console.log(`  Duration:       ${overallDuration}s`);
  console.log(`${colors.cyan}====================================================${colors.reset}\n`);

  if (failures.length > 0) {
    console.log(`${colors.bold}${colors.red}Failures & Discrepancies Detected (${failures.length}):${colors.reset}\n`);
    failures.forEach((f, idx) => {
      console.log(`${colors.bold}${idx + 1}) [${f.suite}] ${f.test}${colors.reset}`);
      console.log(`   ${colors.gray}Location:${colors.reset} ${f.file}`);
      console.log(`   ${colors.red}Error:${colors.reset} ${f.error.message || f.error}`);
      if (f.error.details) {
        console.log(`   ${colors.gray}Details:${colors.reset} ${JSON.stringify(f.error.details)}`);
      }
      if (f.error.stack) {
        const stackLines = f.error.stack.split('\n').slice(1, 4).join('\n');
        console.log(`   ${colors.gray}${stackLines}${colors.reset}`);
      }
      console.log('');
    });

    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}✔ ALL TESTS PASSED SUCCESSFULLY${colors.reset}\n`);
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled fatal error in test runner:', err);
    process.exit(1);
  });
}

module.exports = { main };
