/**
 * Login throttling: after `limit` failed logins for one username from one
 * address, further attempts are refused for `lockMs`, whatever the password.
 * A success clears the count. In memory: a restart clears it, which an
 * attacker cannot trigger from outside.
 * @module @lyteboat/studio-auth/studio-login-throttle
 */

interface StudioLoginFailures {
  count: number
  lockedUntil: number
}

/** Failed-login counts by `<username> NUL <address>`. */
export class StudioLoginThrottle {
  private readonly failures = new Map<string, StudioLoginFailures>()

  constructor(private readonly limit: number, private readonly lockMs: number) {}

  /** Whether a login for this username from this address is refused now. */
  locked(username: string, from: string, now: number): boolean {
    return (this.failures.get(`${username}\0${from}`)?.lockedUntil ?? 0) > now
  }

  /** Count a failed login; the `limit`-th locks the pair for `lockMs`. */
  fail(username: string, from: string, now: number): void {
    const key = `${username}\0${from}`
    const count = (this.failures.get(key)?.count ?? 0) + 1
    this.failures.set(key, count >= this.limit ? { count: 0, lockedUntil: now + this.lockMs } : { count, lockedUntil: 0 })
  }

  /** Forget the pair's failures after a success. */
  succeed(username: string, from: string): void {
    this.failures.delete(`${username}\0${from}`)
  }
}
