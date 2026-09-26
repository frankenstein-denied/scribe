'use client'

import { Moon, Sun } from 'lucide-react'
import { setDarkMode, useIsDark } from '@/lib/theme'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const dark = useIsDark()
  return <button className="theme-row" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={() => setDarkMode(!dark)}>
    {dark ? <Moon /> : <Sun />}{!compact && <> Dark mode <span className={`toggle ${dark ? 'on' : ''}`} aria-hidden="true" /></>}
  </button>
}
