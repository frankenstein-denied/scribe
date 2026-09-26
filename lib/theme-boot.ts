// Shared by the server layout and the client toggle, so it lives outside the 'use client' theme module.
export const THEME_KEY = 'scribe-theme'

/** Runs before the page paints (inlined in app/layout.tsx), so there's no white flash in dark mode. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`
