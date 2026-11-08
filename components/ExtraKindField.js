import { useEffect, useRef } from 'react';
import { EXTRA_KINDS, EXTRA_KIND_MAX, EXTRA_KIND_OTHER, EXTRA_KIND_OTHER_LABEL, EXTRA_KIND_WORDS } from '../lib/extraKinds';

// "What kind of extra?" (migration 121; Jose, 2026-11-08, the "Extras ·
// RECOMMENDED" board): the preset chips — one at a time, real buttons with
// aria-pressed; pressing the one that's on takes it off — and Other, which
// opens "Your category" (40 characters). Only a label: the extra stays
// under Extras wherever it is. The extra's editors (components/show/
// EpisodeEditor.js, DraftEditor.js) and the three-step submit
// (pages/creator/submit.js) use it; the app has its own copy
// (mobile/src/components/ExtraKindField.js).
//
// Controlled: { choice: '' | a preset's id | 'other', other: the typed
// words }. The parent saves lib/extraKinds.js extraKindFromChoice(choice,
// other) — Other left empty saves no kind ("Extra"). `variant` 'editor'
// (the show-ed look) or 'apply' (the submit page's apl look) only picks the
// label, input and help classes; the chips look the same everywhere.
// `children` goes under the help line (the editor's FieldNote).
const CLASSES = {
  editor: { label: 'show-ed-label', input: 'show-ed-input', help: 'show-ed-hint', count: 'show-ed-count' },
  apply: { label: 'apl-label', input: 'xk-input', help: 'apl-help', count: 'show-ed-count' }
};

const CHOICES = [...EXTRA_KINDS, { id: EXTRA_KIND_OTHER, label: EXTRA_KIND_OTHER_LABEL }];

export default function ExtraKindField({ idPrefix = 'xk', choice = '', other = '', onChange, disabled = false, variant = 'editor', children = null }) {
  const cls = CLASSES[variant] || CLASSES.editor;
  const labelId = `${idPrefix}-label`;
  const helpId = `${idPrefix}-help`;
  const otherId = `${idPrefix}-other`;
  const inputRef = useRef(null);
  const focusOther = useRef(false);
  const otherOpen = choice === EXTRA_KIND_OTHER;
  const typed = typeof other === 'string' ? other : '';
  const count = Array.from(typed).length;

  // Pressing Other puts the cursor in its box.
  useEffect(() => {
    if (otherOpen && focusOther.current && inputRef.current) inputRef.current.focus();
    focusOther.current = false;
  }, [otherOpen]);

  const pick = (id) => {
    if (disabled || !onChange) return;
    const next = choice === id ? '' : id;
    if (next === EXTRA_KIND_OTHER) focusOther.current = true;
    onChange({ choice: next, other: typed });
  };

  return (
    <div className="xk-field">
      <span className={cls.label} id={labelId}>{EXTRA_KIND_WORDS.label}</span>
      <div className="show-ed-chips xk-chips" role="group" aria-labelledby={labelId} aria-describedby={helpId}>
        {CHOICES.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={choice === k.id ? 'true' : 'false'}
            className={`show-ed-chip ${choice === k.id ? 'on' : ''}`}
            disabled={disabled}
            onClick={() => pick(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      {otherOpen && (
        <div className="xk-other">
          <div className="xk-other-row">
            <label className={cls.label} htmlFor={otherId}>{EXTRA_KIND_WORDS.otherLabel}</label>
            <span className={`${cls.count} ${count > EXTRA_KIND_MAX ? 'over' : ''}`} aria-hidden="true">{count} / {EXTRA_KIND_MAX}</span>
          </div>
          <input
            ref={inputRef}
            id={otherId}
            type="text"
            className={cls.input}
            value={typed}
            maxLength={EXTRA_KIND_MAX * 2}
            disabled={disabled}
            placeholder={EXTRA_KIND_WORDS.otherPlaceholder}
            autoComplete="off"
            aria-describedby={helpId}
            onChange={(e) => onChange && onChange({ choice: EXTRA_KIND_OTHER, other: Array.from(e.target.value).slice(0, EXTRA_KIND_MAX).join('') })}
          />
        </div>
      )}
      <p className={cls.help} id={helpId}>{EXTRA_KIND_WORDS.help}</p>
      {children}
    </div>
  );
}
