/**
 * The light / dark switch. The theme is kept in `localStorage` and follows
 * the system's preference until someone picks one; it is applied as soon as
 * this module loads, so the first paint already has it.
 * @module @lyteboat/studio-web/client/studio-theme-toggle
 */

import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from './studio-icons.tsx'

type StudioTheme = 'light' | 'dark'

const STUDIO_THEME_KEY = 'lyteboat-studio-theme'

function initialStudioTheme(): StudioTheme {
  try {
    const stored = localStorage.getItem(STUDIO_THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage is off: fall back to the system's preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

document.documentElement.dataset['theme'] = initialStudioTheme()

/** The toggle button in the top bar and on the login page. */
export function StudioThemeToggle() {
  const [theme, setTheme] = useState<StudioTheme>(initialStudioTheme)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    try {
      localStorage.setItem(STUDIO_THEME_KEY, theme)
    } catch {
      // Storage is off: the choice lasts until the page closes.
    }
  }, [theme])

  const next: StudioTheme = theme === 'light' ? 'dark' : 'light'
  return (
    <button aria-label={`Switch to ${next} theme`} className="theme-toggle-button" onClick={() => setTheme(next)} title={`Switch to ${next} theme`} type="button">
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
