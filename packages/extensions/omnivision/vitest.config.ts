/**
 * Standalone vitest lane for the vendored omnivision suites. The repository
 * root config only collects spec files under each package's own tests
 * directory, which never matched this package, so these suites were silently
 * uncollected; this config gives a rooted vitest invocation in this directory
 * a real project definition and collects the aggregated selftests suite.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['selftests/suite.spec.ts'],
  },
})
