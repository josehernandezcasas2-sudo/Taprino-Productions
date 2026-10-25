import { useId } from 'react';
import Link from 'next/link';
import { AI_POLICY_PATH, SEAL_LABEL, SEAL_TITLE } from '../lib/aiPolicyRules';

// The "Not for AI training" seal (Jose, 2026-10-25; canvas
// https://claude.ai/artifact/68Gq3NnvmRGaAYYinZ1KX5). One glyph, the AI
// sparkle struck through, in three forms: the chip next to a title or a
// name, the stamp with the words round the ring for the policy page and
// the profile, and a text-only line. Always the dim ink colour, never
// brass or gold, so it never competes with a button. Every form links to
// the policy page, so the mark explains itself. The app mirrors it in
// mobile/src/components/AiSeal.js.
export function AiSealGlyph({ size = 13, strokeWidth = 2 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c.6 3.9 3.1 6.4 7 7-3.9.6-6.4 3.1-7 7-.6-3.9-3.1-6.4-7-7 3.9-.6 6.4-3.1 7-7z" />
      <path d="M4 20 20 4" />
    </svg>
  );
}

export function AiSealChip({ className = '' }) {
  return (
    <Link href={AI_POLICY_PATH} className={`ai-seal-chip ${className}`.trim()} title={SEAL_TITLE}>
      <AiSealGlyph /> {SEAL_LABEL}
    </Link>
  );
}

// `size` in px; the words run round the ring, the glyph sits in the middle.
export function AiSealStamp({ size = 96, className = '' }) {
  const ringId = `ai-seal-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={`ai-seal-stamp ${className}`.trim()} role="img" aria-label={`${SEAL_LABEL}, Studio Tapa TV`}>
      <defs><path id={ringId} d="M50,50 m-36,0 a36,36 0 1,1 72,0 a36,36 0 1,1 -72,0" /></defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth={size < 80 ? 2.4 : 2} />
      <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeWidth={size < 80 ? 1.2 : 1} opacity="0.55" />
      <text fontFamily="'Space Grotesk', sans-serif" fontSize="8.4" fontWeight="700" letterSpacing="1.3" fill="currentColor" textLength="222" lengthAdjust="spacing">
        <textPath href={`#${ringId}`}>NOT FOR AI TRAINING · STUDIO TAPA TV ·</textPath>
      </text>
      <g transform="translate(50 50) scale(1.25) translate(-12 -12)" fill="none" stroke="currentColor" strokeWidth={size < 80 ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3c.6 3.9 3.1 6.4 7 7-3.9.6-6.4 3.1-7 7-.6-3.9-3.1-6.4-7-7 3.9-.6 6.4-3.1 7-7z" />
        <path d="M4 20 20 4" />
      </g>
    </svg>
  );
}

export function AiSealLine({ className = '' }) {
  return (
    <Link href={AI_POLICY_PATH} className={`ai-seal-line ${className}`.trim()} title={SEAL_TITLE}>
      <AiSealGlyph /> {SEAL_LABEL}
    </Link>
  );
}

// The profile's card: the stamp plus one line in the person's name.
export function AiSealCard({ name }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'This';
  const possessive = /s$/i.test(first) ? `${first}’` : `${first}’s`;
  return (
    <div className="ai-seal-card">
      <AiSealStamp size={64} />
      <div>
        <strong>{possessive} work is not for AI training</strong>
        <p>Nothing on Studio Tapa TV is licensed for training or data mining. <Link href={AI_POLICY_PATH}>Read the policy</Link></p>
      </div>
    </div>
  );
}
