/**
 * Test Assertion & Harness Utilities
 * Opaque-box E2E test framework for Video Downloader
 */

const assert = require('assert');

class TestFailure extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TestFailure';
    this.details = details;
  }
}

function assertEquals(actual, expected, message = '') {
  try {
    assert.strictEqual(actual, expected, message);
  } catch (err) {
    throw new TestFailure(
      message || `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      { actual, expected, operator: '===' }
    );
  }
}

function assertNotEquals(actual, expected, message = '') {
  try {
    assert.notStrictEqual(actual, expected, message);
  } catch (err) {
    throw new TestFailure(
      message || `Expected actual not to strictly equal ${JSON.stringify(expected)}`,
      { actual, expected, operator: '!==' }
    );
  }
}

function assertTrue(value, message = 'Expected value to be true') {
  if (!value) {
    throw new TestFailure(message, { actual: value, expected: true });
  }
}

function assertFalse(value, message = 'Expected value to be false') {
  if (value) {
    throw new TestFailure(message, { actual: value, expected: false });
  }
}

function assertContains(haystack, needle, message = '') {
  const contains = typeof haystack === 'string'
    ? haystack.includes(needle)
    : Array.isArray(haystack)
      ? haystack.includes(needle)
      : false;
  if (!contains) {
    throw new TestFailure(
      message || `Expected target to contain ${JSON.stringify(needle)}`,
      { haystack: typeof haystack === 'string' ? haystack.slice(0, 300) : haystack, needle }
    );
  }
}

function assertMatch(value, regex, message = '') {
  if (!regex.test(String(value))) {
    throw new TestFailure(
      message || `Expected ${JSON.stringify(value)} to match ${regex}`,
      { actual: value, pattern: regex.toString() }
    );
  }
}

function assertGreaterThan(actual, threshold, message = '') {
  if (!(actual > threshold)) {
    throw new TestFailure(
      message || `Expected ${actual} > ${threshold}`,
      { actual, threshold }
    );
  }
}

function assertGreaterThanOrEqual(actual, threshold, message = '') {
  if (!(actual >= threshold)) {
    throw new TestFailure(
      message || `Expected ${actual} >= ${threshold}`,
      { actual, threshold }
    );
  }
}

function assertLessThanOrEqual(actual, threshold, message = '') {
  if (!(actual <= threshold)) {
    throw new TestFailure(
      message || `Expected ${actual} <= ${threshold}`,
      { actual, threshold }
    );
  }
}

async function assertRejects(fn, message = 'Expected function to reject') {
  let threw = false;
  let caught = null;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  if (!threw) {
    throw new TestFailure(message);
  }
  return caught;
}

module.exports = {
  TestFailure,
  assertEquals,
  assertNotEquals,
  assertTrue,
  assertFalse,
  assertContains,
  assertMatch,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertRejects,
};
