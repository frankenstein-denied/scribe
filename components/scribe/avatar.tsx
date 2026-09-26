/* eslint-disable @next/next/no-img-element */

// SCRIBE's face: the cut-out CICT student from /public/scribe-avatar.png.
// `badge` sits it in a round frame (chat rows, buttons); without it the full figure is shown (greetings, login).
export function ScribeAvatar({ size = 36, badge = false, className = '' }: { size?: number; badge?: boolean; className?: string }) {
  return badge
    ? <span className={`scribe-badge ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src="/scribe-avatar.png" alt="" draggable={false} />
    </span>
    : <img className={`scribe-figure ${className}`} src="/scribe-avatar.png" alt="SCRIBE, your study assistant" style={{ height: size }} draggable={false} />
}

export const SCRIBE_GREETING = 'Hello, I’m SCRIBE! What can I do for you today?'
