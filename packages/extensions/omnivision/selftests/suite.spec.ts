/**
 * Aggregates the vendored omnivision suites (authored as dot-test files) so
 * they run inside the repository's collected test glob.
 */

import './tests/bridge/message-rewriter.test.ts'
import './tests/bridge/vision-bridge.test.ts'
import './tests/integration/e2e-workflows.test.ts'
import './tests/resilience/circuit.test.ts'
import './tests/security/index.test.ts'
