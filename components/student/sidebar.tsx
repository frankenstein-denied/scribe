'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Brain, ChevronLeft, FileText, LogOut, Menu, MoreHorizontal, Plus, Search, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import type { RecentChat } from '@/lib/recents'
import type { User } from '@/types'

export function StudentSidebar({ user, active, collapsed, setCollapsed, onNew, onLogout, recents, activeChatId, onOpenRecent, onDeleteRecent }: {
  user: User; active: 'ask' | 'sets' | 'brain'; collapsed: boolean; setCollapsed: (v: boolean) => void; onNew?: () => void; onLogout: () => void
  recents: RecentChat[]; activeChatId?: string | null; onOpenRecent: (id: string) => void; onDeleteRecent: (id: string) => void
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const initials = user.name.split(' ').map(w => w[0]).slice(0, 2).join('')

  // Close the "…" menu on any outside click or Escape.
  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey) }
  }, [menuFor])

  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
    <div className="brand-row"><span className="brand">SCRIBE</span><button className="icon-button" onClick={() => setCollapsed(!collapsed)} aria-label="Collapse sidebar">{collapsed ? <Menu /> : <ChevronLeft />}</button></div>
    {!collapsed && <>
      {onNew ? <button className="new-chat" onClick={onNew}><Plus /> New chat</button> : <Link className="new-chat" href="/"><Plus /> New chat</Link>}
      <nav className="nav-list" aria-label="Main navigation">
        <Link className={`nav-item ${active === 'ask' ? 'active' : ''}`} href="/"><Sparkles /> Ask SCRIBE</Link>
        <Link className={`nav-item ${active === 'sets' ? 'active' : ''}`} href="/study-sets"><BookOpen /> Study sets</Link>
        <Link className={`nav-item ${active === 'brain' ? 'active' : ''}`} href="/brain"><Brain /> My 2nd brain</Link>
        {user.role === 'Admin' && <><p className="nav-label">Admin</p><Link className="nav-item" href="/admin"><ShieldCheck /> Verified instructors</Link></>}
        {user.role === 'Professor' && <><p className="nav-label">For professors</p><Link className="nav-item" href="/instructor"><FileText /> My materials</Link><button className="nav-item"><Search /> Coverage</button></>}
      </nav>
      <div className="recent">
        <p className="nav-label">Recent</p>
        {recents.length === 0
          ? <p className="recent-empty">Chats you finish show up here when you start a new one.</p>
          : <ul className="recent-list">{recents.map(r => <li key={r.id} className={`recent-row ${r.id === activeChatId ? 'active' : ''} ${menuFor === r.id ? 'menu-open' : ''}`}>
            <button className="recent-item" onClick={() => onOpenRecent(r.id)} title={r.title} aria-current={r.id === activeChatId ? 'page' : undefined}>{r.title}</button>
            <button className="recent-more" aria-label={`Options for ${r.title}`} aria-haspopup="menu" aria-expanded={menuFor === r.id} onClick={e => { e.stopPropagation(); setMenuFor(menuFor === r.id ? null : r.id) }}><MoreHorizontal /></button>
            {menuFor === r.id && <div className="recent-menu" role="menu" onClick={e => e.stopPropagation()}>
              <button role="menuitem" onClick={() => { onDeleteRecent(r.id); setMenuFor(null) }}><Trash2 /> Delete chat</button>
            </div>}
          </li>)}</ul>}
      </div>
    </>}
    <div className="sidebar-bottom">
      <div className="profile"><div className="avatar">{initials}</div>{!collapsed && <div><strong>{user.name}</strong><span>{user.program} · {user.role}</span></div>}</div>
      {!collapsed && <><button className="logout-button" onClick={onLogout}><LogOut /> Log out</button><ThemeToggle /></>}
    </div>
  </aside>
}
