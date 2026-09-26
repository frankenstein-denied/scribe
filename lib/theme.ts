'use client'

import { useEffect, useState } from 'react'
import { THEME_KEY } from '@/lib/theme-boot'

// Dark mode is the `dark` class on <html>. The choice is remembered per browser; until someone picks,
// the device's own light/dark setting is followed (see THEME_BOOT_SCRIPT).

const isDarkNow = () => document.documentElement.classList.contains('dark')

/** Whether dark mode is on, kept in sync when any toggle on the page changes it. */
export function useIsDark() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(isDarkNow())
    const observer = new MutationObserver(() => setDark(isDarkNow()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function setDarkMode(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light') } catch {}
}
