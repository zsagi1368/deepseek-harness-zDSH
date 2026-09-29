import { defineConfig } from 'tsdown'

/**
 * Build each published entry as a self-contained file admitted by the package
 * whitelist. Both index.ts and invariant.ts import vocabulary.ts; without
 * per-entry `codeSplitting: false` rolldown hoists it into a hashed shared
 * chunk (vocabulary-*.js) that the published `files` whitelist cannot ship and
 * the python-sdk pkg snapshot cannot resolve (ERR_MODULE_NOT_FOUND in the
 * release-shaped build).
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])
