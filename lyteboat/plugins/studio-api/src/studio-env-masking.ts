/**
 * How the System page shows an environment variable: its value, unless the
 * name or the value says it is a secret. A name holding one of the sensitive
 * fragments (any case) masks the whole value; a URL carrying credentials keeps
 * everything but them; a JWT or a long base64 string is masked whole. Ported
 * from the reference implementation (`plugins/studio/api/system.py`,
 * `_mask_env_value`) and checked against fixtures its code generated.
 * @module @lyteboat/studio-api/studio-env-masking
 */

const MASKED = '***'

const SENSITIVE_NAME_FRAGMENTS = [
  'password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'private_key', 'privatekey',
  'access_key', 'credential', 'signing', 'encryption',
]

// Python's `re.match(...$)` also matches before one trailing newline; `\n?$` keeps that for fidelity.
const CREDENTIALS_URL = /^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)([^@/\s]+)(@\S+)\n?$/u
const LONG_BASE64 = /^[A-Za-z0-9+/=]{100,}\n?$/u
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\n?$/u

/**
 * The value the System page shows for a variable.
 * @param name - the variable's name.
 * @param value - its value.
 */
export function maskStudioEnvValue(name: string, value: string): string {
  const lower = name.toLowerCase()
  if (SENSITIVE_NAME_FRAGMENTS.some(fragment => lower.includes(fragment))) return MASKED
  const url = CREDENTIALS_URL.exec(value)
  if (url !== null) return `${url[1] ?? ''}${MASKED}@${(url[3] ?? '').replace(/^@+/u, '')}`
  if (JWT.test(value) || LONG_BASE64.test(value)) return MASKED
  return value
}
