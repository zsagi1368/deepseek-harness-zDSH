/**
 * Shared minimal semver comparison for plugin governance.
 *
 * Single source of truth used by the registry's compatibility check and the
 * LoadGuard's version gate, so both can never disagree about whether a kernel
 * satisfies a manifest's declared window again.
 * @module @deepseek-ai/dsh-plugin-governance/semver
 */

type SemverParts = readonly [number, number, number, string]

/** Parse "major.minor.patch" plus optional "-prerelease" tag and "+build" metadata (ignored per semver spec). */
function parseSemver(version: string): SemverParts {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?(?:\+(.+))?$/u)
  if (match === null) return [0, 0, 0, version]
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? '']
}

/**
 * Compare dot-separated prerelease identifiers per semver precedence:
 * numeric identifiers compare numerically (`10` > `9`, not `'10' < '9'`),
 * numeric sorts below alphanumeric, and a shorter identifier set sorts lower.
 */
function comparePrerelease(a: string, b: string): number {
  const aParts = a.split('.')
  const bParts = b.split('.')
  const length = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < length; index++) {
    const left = aParts[index]
    const right = bParts[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumeric = /^\d+$/u.test(left)
    const rightNumeric = /^\d+$/u.test(right)
    if (leftNumeric && rightNumeric) {
      const delta = Number(left) - Number(right)
      if (delta !== 0) return delta
    } else if (leftNumeric !== rightNumeric) {
      // Numeric identifiers have lower precedence than alphanumeric ones.
      return leftNumeric ? -1 : 1
    } else if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

/**
 * Minimal semver comparison: parses "major.minor.patch" and optional
 * prerelease tags. The SIGN of the result carries the precedence order; the
 * MAGNITUDE is the raw difference of the first differing component — for
 * example `semverCompare('0.1.1-rc.2', '0.1.5-rc.2')` returns `-4`, not `-1`.
 * Unparseable input degrades to the zero-version parse, whose prerelease slot
 * then holds the raw string, so the comparison falls back to a plain string
 * order on the raw value.
 *
 * Callers must compare against 0 (`> 0` / `>= 0` / `< 0`) and never against
 * `-1` / `1` exactly.
 * @param a - the first version string.
 * @param b - the second version string.
 * @returns the signed difference per semver precedence of `a` relative to `b`:
 * negative when `a < b`, `0` when equal, positive when `a > b`. The value is
 * NOT normalized to -1/0/1.
 */
export function semverCompare(a: string, b: string): number {
  const [aMaj, aMin, aPat, aPre] = parseSemver(a)
  const [bMaj, bMin, bPat, bPre] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj - bMaj
  if (aMin !== bMin) return aMin - bMin
  if (aPat !== bPat) return aPat - bPat
  // prerelease has lower precedence than release
  if (aPre !== '' && bPre === '') return -1
  if (aPre === '' && bPre !== '') return 1
  if (aPre === '' && bPre === '') return 0
  return comparePrerelease(aPre, bPre)
}
