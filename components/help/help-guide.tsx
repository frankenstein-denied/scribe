'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import { GUIDE, type GuideRole } from '@/lib/guide'

const ROLES: GuideRole[] = ['Student', 'Professor']

/** `only` shows just `defaultRole`'s guide, with no role tabs (for signed-in users). */
export function HelpGuide({ open, onClose, defaultRole = 'Student', only }: { open: boolean; onClose: () => void; defaultRole?: GuideRole; only?: boolean }) {
  const [role, setRole] = useState<GuideRole>(defaultRole)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) { setPrevOpen(open); if (open) setRole(defaultRole) }
  const downOnBackdrop = useRef(false)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % ROLES.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + ROLES.length) % ROLES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ROLES.length - 1
    if (next < 0) return
    e.preventDefault()
    setRole(ROLES[next])
    tabRefs.current[ROLES[next]]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'))
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1], active = document.activeElement
      if (!dialog.contains(active) || active === dialog) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null
  const guide = GUIDE[role]

  return createPortal(
    <div className="help-backdrop" onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }} onClick={e => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); downOnBackdrop.current = false }}>
      <section ref={dialogRef} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
        <header className="help-header">
          <h2 id="help-title">{only ? `How to use SCRIBE as a ${defaultRole === 'Professor' ? 'professor' : 'student'}` : 'How to use SCRIBE'}</h2>
          <button type="button" className="help-close" aria-label="Close guide" onClick={onClose}><X /></button>
        </header>
        {!only && <div className="help-tabs" role="tablist" aria-label="Choose your role">
          {ROLES.map((r, i) => <button key={r} ref={el => { tabRefs.current[r] = el }} id={`help-tab-${r}`} type="button" role="tab" aria-selected={role === r} aria-controls="help-panel" tabIndex={role === r ? 0 : -1} onKeyDown={e => onTabKey(e, i)} className={`help-tab ${role === r ? 'selected' : ''}`} onClick={() => setRole(r)}>{r}</button>)}
        </div>}
        <div id="help-panel" {...(only ? {} : { role: 'tabpanel', 'aria-labelledby': `help-tab-${role}` })}>
        <p className="help-intro">{guide.intro}</p>
        <ol className="help-steps">
          {guide.steps.map((step, i) => <li key={step.image} className="help-step">
            <span className="help-step-num" aria-hidden="true">{i + 1}</span>
            <div className="help-step-body">
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <figure>
                {failed[step.image]
                  ? <div className="help-shot-missing">Screenshot coming soon</div>
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={step.image} alt={step.alt} loading="lazy" onError={() => setFailed(f => ({ ...f, [step.image]: true }))} />}
              </figure>
            </div>
          </li>)}
        </ol>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export function HelpButton({ defaultRole = 'Student', only, labelled, className }: { defaultRole?: GuideRole; only?: boolean; labelled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={`help-button ${labelled ? 'labelled' : ''} ${className ?? ''}`} aria-label="How to use SCRIBE" title="How to use SCRIBE" onClick={() => setOpen(true)}>
      <Info />{labelled && <span>How to use SCRIBE</span>}
    </button>
    <HelpGuide open={open} onClose={() => setOpen(false)} defaultRole={defaultRole} only={only} />
  </>
}
