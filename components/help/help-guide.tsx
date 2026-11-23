'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import { GUIDE, type GuideRole } from '@/lib/guide'

const ROLES: GuideRole[] = ['Student', 'Professor']

export function HelpGuide({ open, onClose, defaultRole = 'Student' }: { open: boolean; onClose: () => void; defaultRole?: GuideRole }) {
  const [role, setRole] = useState<GuideRole>(defaultRole)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => { if (open) setRole(defaultRole) }, [open, defaultRole])

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
    <div className="help-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
        <header className="help-header">
          <h2 id="help-title">How to use SCRIBE</h2>
          <button type="button" className="help-close" aria-label="Close guide" onClick={onClose}><X /></button>
        </header>
        <div className="help-tabs" role="tablist" aria-label="Choose your role">
          {ROLES.map(r => <button key={r} type="button" role="tab" aria-selected={role === r} className={`help-tab ${role === r ? 'selected' : ''}`} onClick={() => setRole(r)}>{r}</button>)}
        </div>
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
      </section>
    </div>,
    document.body,
  )
}

export function HelpButton({ defaultRole = 'Student', labelled, className }: { defaultRole?: GuideRole; labelled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={`help-button ${labelled ? 'labelled' : ''} ${className ?? ''}`} aria-label="How to use SCRIBE" title="How to use SCRIBE" onClick={() => setOpen(true)}>
      <Info />{labelled && <span>How to use SCRIBE</span>}
    </button>
    <HelpGuide open={open} onClose={() => setOpen(false)} defaultRole={defaultRole} />
  </>
}
