/**
 * Tier 2 - Boundary 14: Test Runner & Harness Boundaries
 * Tests boundary conditions within the test runner and assertion framework:
 * zero-match filter handling, timeout interruptions, structured diff reporting,
 * and rejection assertions.
 */

const { assertTrue, assertFalse, assertEquals, assertRejects, TestFailure } = require('../helpers/assertions');

module.exports = {
  name: 'Boundary 14: Test Runner & Harness Boundaries',
  tests: [
    {
      name: 'B14.1: assertRejects catches rejected promise and returns error object',
      run: async () => {
        const error = await assertRejects(async () => {
          throw new Error('Specific failure message');
        });
        assertEquals(error.message, 'Specific failure message');
      }
    },
    {
      name: 'B14.2: assertRejects throws TestFailure when inner function does not reject',
      run: async () => {
        let threw = false;
        try {
          await assertRejects(async () => {
            return 'resolved successfully';
          });
        } catch (err) {
          threw = true;
          assertEquals(err.name, 'TestFailure');
        }
        assertTrue(threw, 'assertRejects must throw when target function does not reject');
      }
    },
    {
      name: 'B14.3: TestFailure retains details object with operator and values',
      run: async () => {
        const failure = new TestFailure('Mismatch', { actual: 1, expected: 2, operator: '===' });
        assertEquals(failure.details.actual, 1);
        assertEquals(failure.details.expected, 2);
        assertEquals(failure.details.operator, '===');
      }
    },
    {
      name: 'B14.4: assertFalse throws TestFailure when provided truthy value',
      run: async () => {
        let threw = false;
        try {
          assertFalse(true);
        } catch (err) {
          threw = true;
          assertEquals(err.name, 'TestFailure');
        }
        assertTrue(threw, 'assertFalse must throw when provided truthy value');
      }
    },
    {
      name: 'B14.5: assertTrue throws TestFailure when provided falsy value',
      run: async () => {
        let threw = false;
        try {
          assertTrue(false);
        } catch (err) {
          threw = true;
          assertEquals(err.name, 'TestFailure');
        }
        assertTrue(threw, 'assertTrue must throw when provided falsy value');
      }
    }
  ]
};
