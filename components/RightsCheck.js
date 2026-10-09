import { RIGHTS_QUESTIONS, rightsVerdict, rightsVerdictCopy } from '../lib/creatorRights';

// The five yes/no rights questions on /apply and the verdict card beside
// them. The verdict updates as answers change, so the applicant knows
// before applying whether their film would sit in review, and why.
// `answers` is { [questionId]: 'yes' | 'no' }; the page owns it.
export default function RightsCheck({ answers, onAnswer }) {
  const verdict = rightsVerdict(answers);
  const copy = rightsVerdictCopy(verdict);
  const showHolds = verdict.result === 'held' || (verdict.result === 'incomplete' && verdict.holds.length > 0);

  return (
    <div className="rights-check">
      <div className="account-card rights-list" role="group" aria-label="Rights check">
        {RIGHTS_QUESTIONS.map((q, i) => (
          <div key={q.id} className="rights-row">
            <div className="rights-row-text">
              <div className="rights-q"><span className="rights-num">{i + 1}</span>{q.text}</div>
              <div className="rights-hint">{q.hint}</div>
            </div>
            <div className="rights-choices" role="radiogroup" aria-label={q.text}>
              {['yes', 'no'].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.id] === v}
                  className={`rights-choice ${answers[q.id] === v ? 'on' : ''}`}
                  onClick={() => onAnswer(q.id, v)}
                >
                  {v === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={`rights-result level-${copy.level}`} aria-live="polite">
        <span className="rights-tag">{copy.tag}</span>
        <div className="rights-result-title">{copy.title}</div>
        <p>{copy.body}</p>
        {showHolds && (
          <>
            <div className="rights-result-label">What we&rsquo;d ask for</div>
            <ul>
              {verdict.holds.map((h) => <li key={h}>{h}</li>)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
