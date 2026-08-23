/**
 * Aggregates the vendored omnivision suites (authored as dot-test files) so
 * they run inside the repository's collected test glob.
 */

import './bridge/message-rewriter.test.ts'
import './bridge/vision-bridge.test.ts'
import './integration/e2e-workflows.test.ts'
import './resilience/circuit.test.ts'
import './security/index.test.ts'
