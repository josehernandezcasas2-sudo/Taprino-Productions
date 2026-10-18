// "Did a creator send you?" on the account page's Membership card, above
// the plans, for anyone not yet on a paid plan. Prefilled from the
// creator link they followed (the tapa_via cookie, middleware.js); a
// handle typed here is checked at checkout (/api/create-checkout-session
// refuses one that isn't a creator). That creator earns the referral
// bonus; it never changes the member's price or share. The app has the
// same field (mobile/src/components/ReferredByField.js).
export default function ReferredByField({ value, onChange, fromLink }) {
  return (
    <div className="refby">
      <label htmlFor="refby-input" className="refby-label">Did a creator send you? <span>optional</span></label>
      <div className="refby-row">
        <span className="refby-at" aria-hidden="true">@</span>
        <input
          id="refby-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^@+/, ''))}
          placeholder="their handle"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
        />
      </div>
      <p className="refby-note">
        {fromLink && value === fromLink
          ? 'From the creator link you followed. '
          : ''}
        They earn a thank-you bonus from us while you’re a member. It never changes your price or where your share goes.
      </p>
    </div>
  );
}
