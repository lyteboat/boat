/**
 * The login page, laid out as the original Studio's: the pitch on the left,
 * the form on the right. It signs in with an account's username and password
 * and returns to the page that sent the visitor here (`?next=`, same-origin
 * paths only). Behind a gateway there is no form: people arrive signed in.
 * @module @lyteboat/studio-web/client/studio-login-page
 */

import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { studioApi, studioErrorMessage } from './studio-api-client.ts'
import { useStudioAuth } from './studio-auth-context.tsx'
import { SparkIcon } from './studio-icons.tsx'
import { StudioThemeToggle } from './studio-theme-toggle.tsx'

/** A `?next=` target inside the Studio, never another origin or the login page itself. */
function studioNextPath(value: string | null): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (value === '/login' || value.startsWith('/login?')) return '/'
  return value
}

function StudioLoginHero() {
  return (
    <div className="login-hero">
      <div className="login-hero-inner">
        <div className="login-brand">
          <div className="studio-brand-mark"><SparkIcon /></div>
          <span>轻舟 Studio</span>
        </div>
        <div className="login-headline">
          <div className="login-eyebrow">Agent Operations Platform</div>
          <h1 className="login-h1">Build, run, and govern <em>autonomous agents</em>.</h1>
          <p className="login-lede">从 Skill 设计、Tool 注册，到生产会话回放与审计 —— 把 LLM agent 的整个生命周期收敛到一个工作台。</p>
        </div>
        <div className="login-foot"><span>轻舟 · lyteboat</span></div>
      </div>
    </div>
  )
}

function StudioLoginForm() {
  const { signIn } = useStudioAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      signIn(await studioApi.login({ username, password }))
      void navigate(studioNextPath(searchParams.get('next')), { replace: true })
    } catch (nextError: unknown) {
      setError(studioErrorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="login-panel" onSubmit={event => void submit(event)}>
      <div className="login-panel-header">
        <strong>Welcome back</strong>
        <span>Sign in to your 轻舟 Studio workspace.</span>
      </div>
      {error !== '' && <div className="login-error-banner">{error}</div>}
      <label className="form-field">
        <span>用户名</span>
        <input autoComplete="username" autoFocus onChange={event => setUsername(event.target.value)} placeholder="请输入用户名" required value={username} />
      </label>
      <label className="form-field">
        <span>密码</span>
        <input autoComplete="current-password" onChange={event => setPassword(event.target.value)} placeholder="请输入密码" required type="password" value={password} />
      </label>
      <button className="action-button action-button-primary login-submit" disabled={username.trim() === '' || password.trim() === '' || loading} type="submit">
        {loading ? '登录中...' : '登录'}
      </button>
    </form>
  )
}

/** The page at `/login`. */
export function StudioLoginPage() {
  const { user, anonymous, loginRequired, initializing } = useStudioAuth()
  const [searchParams] = useSearchParams()
  if (initializing) return null
  if (user !== null && !anonymous) return <Navigate replace to={studioNextPath(searchParams.get('next'))} />
  return (
    <div className="login-shell">
      <div className="login-theme-toggle"><StudioThemeToggle /></div>
      <div className="login-container">
        <StudioLoginHero />
        {loginRequired ? <StudioLoginForm /> : (
          <div className="login-panel">
            <div className="login-panel-header">
              <strong>访问受限</strong>
              <span>请通过授权网关访问本服务。</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
