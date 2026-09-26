/**
 * The Host header allowlist that keeps DNS rebinding out: a page on another
 * site can make a browser send requests to the Studio's address under that
 * site's name, and only the Host header tells them apart. The loopback names
 * are accepted on any port; a trusted entry `name` accepts that name on any
 * port, `name:port` only that port. Names compare case-insensitively.
 * @module @lyteboat/studio-api/studio-host-allowlist
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Whether a request's Host header names this Studio.
 * @param host - the Host header; a request without one is refused.
 * @param trusted - the `--trusted-host` entries.
 */
export function studioHostAllowed(host: string | undefined, trusted: readonly string[]): boolean {
  if (host === undefined || host === '') return false
  const authority = host.toLowerCase()
  const hostname = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.split(':')[0] ?? ''
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true
  return trusted.some(entry => {
    const allowed = entry.toLowerCase()
    return allowed === authority || allowed === hostname
  })
}
