/**
 * The System page's environment masking against fixtures the reference
 * implementation's `_mask_env_value` (`plugins/studio/api/system.py`, at
 * fa43a58) generated: sensitive names, credentials in URLs, JWTs, long base64
 * strings, and Python's `$` matching before one trailing newline.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { maskStudioEnvValue } from '../src/studio-env-masking.ts'

const golden = JSON.parse(readFileSync(new URL('./fixtures/env-masking.json', import.meta.url), 'utf8')) as { name: string; value: string; masked: string }[]

describe('maskStudioEnvValue against the reference fixtures', () => {
  it.each(golden.map(entry => [entry.name, entry] as const))('%s is shown as the reference shows it', (_name, entry) => {
    expect(maskStudioEnvValue(entry.name, entry.value)).toBe(entry.masked)
  })
})
