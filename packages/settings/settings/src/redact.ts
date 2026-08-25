/**
 * Structural secret redaction for settings values. `role('secret')` fields are
 * removed from a value before it crosses a wire boundary; a sidecar records
 * each schema-declared secret position and whether it currently holds a value,
 * so a configuration surface can render a write-only input without ever
 * receiving the secret itself.
 * @module @deepseek-ai/dsh-settings/redact
 */

import type z from '@deepseek-ai/schemastery'

/**
 * Minimal structural view of a live schemastery node. Only the relations the
 * redactor walks are named; everything else on the instance is ignored.
 */
interface SchemaNode {
  type?: string
  meta?: { role?: unknown }
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SchemaNode>
  /** `dict`/`array` element schema, or `transform` wrapped schema. */
  inner?: SchemaNode
  /** `union`/`intersect` member schemas. */
  list?: readonly SchemaNode[]
}

/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root to the removed field (concrete dict keys and array indexes included). */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** A value with every `role('secret')` field removed, plus the removal record. */
export interface RedactedValue {
  /** Detached copy of the input with secret fields absent. */
  value: unknown
  /**
   * Every reachable secret position: object properties always (even unset, so
   * a form knows the slot exists), dict entries and array items only where the
   * value has them.
   */
  secrets: RedactedSecret[]
}

/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Internal join key so multi-segment paths can be compared inside one walk. */
function pathKey(path: readonly string[]): string {
  return path.join('\u0000')
}

/**
 * Copy `value` omitting every path recorded in `removed` (joined relative to
 * the same base the sets were built from). Objects prune per key; arrays drop
 * the whole element whose index was stripped (element-level secrets strip the
 * element, matching the walker's own array semantics).
 */
function omitPaths(value: unknown, prefix: string[], removed: Set<string>): unknown {
  if (removed.size === 0) return value
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const joined = pathKey([...prefix, key])
      if (removed.has(joined)) continue
      out[key] = omitPaths(entry, [...prefix, key], removed)
    }
    return out
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const joined = pathKey([...prefix, String(index)])
      if (removed.has(joined)) continue
      out.push(omitPaths(value[index], [...prefix, String(index)], removed))
    }
    return out
  }
  return value
}

/**
 * Fail-closed traversal for `union` and `intersect`: the redactor cannot know
 * which union branch a runtime value resolved to, so it walks EVERY member
 * against the same value and strips a field when any member declares it a
 * secret at that path. For an intersect this is exactly the composed schema's
 * own semantics; for a union it deliberately over-strips rather than leak.
 */
function walkAlternation(
  node: SchemaNode,
  value: unknown,
  path: string[],
  secrets: RedactedSecret[],
  seen: Set<string>,
): unknown {
  const removed = new Set<string>()
  for (const member of node.list ?? []) {
    const local: RedactedSecret[] = []
    walk(member, value, path, local)
    for (const entry of local) {
      const key = pathKey(entry.path)
      removed.add(pathKey(entry.path.slice(path.length)))
      if (!seen.has(key)) {
        seen.add(key)
        secrets.push(entry)
      }
    }
  }
  return omitPaths(value, path, removed)
}

function walk(node: SchemaNode | undefined, value: unknown, path: string[], secrets: RedactedSecret[]): unknown {
  if (node === undefined) return value
  if (node.meta?.role === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {}
      const source = isRecord(value) ? value : undefined
      const rebuilt: Record<string, unknown> = {}
      if (source !== undefined) {
        for (const [key, entry] of Object.entries(source)) {
          if (key in properties) continue
          rebuilt[key] = entry
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walk(child, source?.[key], [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt
    }
    case 'dict': {
      if (!isRecord(value)) return value
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) return value
      return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets))
    }
    case 'intersect':
    case 'union':
      return walkAlternation(node, value, path, secrets, new Set())
    case 'transform':
      // The inner schema describes what the transform consumes; redaction runs
      // against that shape so a secret wrapped in a transform still strips.
      return walk(node.inner, value, path, secrets)
    default:
      // Leaf types (string, number, boolean, any, ...) hold no nested schema.
      return value
  }
}

/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker follows `object`, `dict`, and `array` containers, descends through
 * `transform` wrappers, and treats `union`/`intersect` fail-closed: every
 * member branch is walked against the same value and a field declared secret
 * by any branch is stripped at that path. The input is never mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value and the ordered secret positions.
 */
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const secrets: RedactedSecret[] = []
  const stripped = walk(schema, value, [], secrets)
  return { value: stripped, secrets }
}
