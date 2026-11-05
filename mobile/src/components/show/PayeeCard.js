import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { seriesSaleNote, titleWords } from '../../lib/showRules';
import { migrationRefusal } from '../../lib/showApi';
import { colors, fonts, inkTint, oliveTint } from '../../lib/theme';
import { WarningIcon } from '../WorkIcons';
import { Behind, CheckIcon, LinkText, Sheet, SmallButton, ss } from './ShowBits';
import { SwitchRow, useShowAuth } from './EditorBits';

// "Who gets paid" in the app (the series revamp, slice 3b:
// mockups/series-slice3b-contract.md §6.2 and §7; the website's
// components/show/PayeeCard.js). Everything comes from the server's
// PayeeBlock (GET /api/show/<id> → payee, GET /api/show/episode/<id> →
// payee, GET /api/payees?type=&id=): who runs the title, which account its
// earnings go to and since when, an invite waiting for an answer, and
// what this viewer may do (`can`). Every change goes through
// POST /api/payees (pick | self | default | step_down) or
// POST /api/payees/invites/<id> (cancel), and the screen hears about it
// through onChanged(nextBlock, words) (it toasts the words and reads the
// page again). Picking someone else sends them an invite: nothing about
// the money changes until they accept.
//
//   PaidLine  "RUNS IT Mara Reyes · PAID TO Pat Lee (its own)" and the
//             invite waiting, for the show card and the editors' heads.
//   PayeeCard mode 'card' (the show screen), 'section' (the episode
//             editor's More info), 'modal' (Your work's sheet for a
//             title of its own: the form opens in place, no sheet on a
//             sheet).

// The two keys and the names, as the show card's meta line.
export function PaidLine({ payee, withPending = true, style }) {
  if (!payee || !payee.line) return null;
  const line = payee.line;
  return (
    <View style={[pc.lineWrap, style]} accessibilityLabel={`${line.text}${withPending && line.pending ? `. ${line.pending}` : ''}`}>
      <Text style={pc.line}>
        <Text style={pc.key}>Runs it </Text>
        <Text style={pc.name}>{line.runsIt}</Text>
        <Text style={pc.dot}>{'  ·  '}</Text>
        <Text style={pc.key}>Paid to </Text>
        <Text style={pc.name}>{line.paidTo}</Text>
        {payee.sourceWords ? <Text style={pc.source}>{` ${payee.sourceWords}`}</Text> : null}
      </Text>
      {withPending && line.pending ? <Text style={pc.pendingLine}>{line.pending}</Text> : null}
    </View>
  );
}

function wordsFor(payee) {
  return titleWords({ titleType: payee.titleType, titleName: payee.titleName, showName: payee.showName, code: payee.code });
}

// The whole-series sale line for an episode in a show (§6.2): the server's
// note when it sent one, else the show's paid account by name.
function seriesNoteFor(payee) {
  if (!payee || payee.titleType !== 'episode' || !payee.showName) return null;
  const sent = (payee.notes || []).find((n) => typeof n === 'string' && n.startsWith('Whole-series sales of'));
  if (sent) return sent;
  const source = payee.paidTo ? payee.paidTo.source : null;
  if (source === 'show' || source === 'runner') return seriesSaleNote(payee.showName, payee.line && payee.line.paidTo === 'You' ? 'you' : payee.paidTo.name || 'whoever runs it');
  return null;
}

// One choice in the picker: a row with a check mark when it's picked.
function ChoiceRow({ on, title, sub = null, onPress, disabled }) {
  return (
    <Pressable
      style={({ pressed }) => [pc.choice, on && pc.choiceOn, pressed && ss.pressed, disabled && ss.disabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: Boolean(on), disabled: Boolean(disabled) }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={pc.choiceTitle}>{title}</Text>
        {sub ? <Text style={ss.small}>{sub}</Text> : null}
      </View>
      <View style={[pc.check, on && pc.checkOn]}>{on ? <CheckIcon size={14} color={colors.oliveShadow} /> : null}</View>
    </Pressable>
  );
}

// 409 codes that mean the block on screen is out of date.
const STALE_CODES = ['pending', 'changed', 'answered', 'cancelled', 'locked', 'not-yet'];

export default function PayeeCard({ payee, mode = 'card', onChanged }) {
  const { call } = useShowAuth();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(null); // self | default | other
  const [to, setTo] = useState('');
  const [grantOffered, setGrantOffered] = useState(false);
  const [grant, setGrant] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [cardError, setCardError] = useState(null);
  const [behind, setBehind] = useState(null);

  // A new block (after a change, or a read) closes nothing by itself, but
  // an error from the last one goes.
  useEffect(() => { setCardError(null); }, [payee]);

  if (!payee) return null;
  const can = payee.can || {};
  const paidName = payee.paidTo ? payee.paidTo.name || 'its paid account' : 'no one yet';
  const titleWord = wordsFor(payee);
  const viewerPaid = Boolean(payee.line && payee.line.paidTo === 'You');
  const defaultName = payee.defaultChoice ? (payee.defaultChoice.you ? 'you' : payee.defaultChoice.name || null) : null;
  const options = [
    can.self ? 'self' : null,
    can.default && payee.defaultChoice ? 'default' : null,
    can.pick ? 'other' : null
  ].filter(Boolean);

  function startForm() {
    setChoice(options.length === 1 ? options[0] : null);
    setTo('');
    setGrantOffered(false);
    setGrant(false);
    setError(null);
    setBehind(null);
    setOpen(true);
  }
  function closeForm() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  // The server's answer: a 503 greys the form with its own line; a 409
  // no-creator-role with canGrant offers the Creator Studio switch; a 409
  // that says the block moved on under us (an invite waiting or answered,
  // a change a moment ago, a lock) closes the sheet and reads the screen
  // again, as the website does — onChanged(null, null).
  function refused(r) {
    const m = migrationRefusal(r);
    if (m) {
      setBehind(m.line);
      return;
    }
    const code = r.data && r.data.code;
    if (r.status === 409 && code === 'no-creator-role' && r.data.canGrant) setGrantOffered(true);
    if (r.status === 409 && STALE_CODES.includes(code)) {
      setOpen(false);
      setCardError(r.error);
      if (onChanged) onChanged(null, null);
      return;
    }
    setError(r.error);
  }

  async function send() {
    if (!choice || busy) return;
    const body = { type: payee.titleType, id: payee.titleId };
    if (choice === 'self') body.action = 'self';
    else if (choice === 'default') body.action = 'default';
    else {
      body.action = 'pick';
      body.to = to.trim();
      if (grantOffered && grant) body.grantCreator = true;
    }
    setBusy('send');
    setError(null);
    const r = await call('POST', '/api/payees', body);
    setBusy(null);
    if (!r.ok) {
      refused(r);
      return;
    }
    setOpen(false);
    if (onChanged) onChanged(r.data.payee || null, r.data.words || 'Saved.');
  }

  // A direct change that moves the money away from someone else is said
  // out loud first (§6.2's words).
  function submit() {
    if (!choice) return;
    if (choice === 'other') {
      send();
      return;
    }
    const next = choice === 'self' ? 'you' : defaultName || 'the default account';
    if (viewerPaid || !payee.paidTo || (choice === 'default' && defaultName && defaultName === payee.paidTo.name)) {
      send();
      return;
    }
    Alert.alert('Change who gets paid?', `Its earnings go to ${next} from now on, and ${paidName} is told. What it earned before stays with ${paidName}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change it', onPress: () => send() }
    ]);
  }

  function withdraw() {
    const p = payee.pending;
    if (!p) return;
    Alert.alert(`Withdraw the invite to ${p.name}?`, 'Nothing about its earnings has changed.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: async () => {
        setBusy('withdraw');
        setCardError(null);
        const r = await call('POST', `/api/payees/invites/${encodeURIComponent(p.inviteId)}`, { action: 'cancel' });
        setBusy(null);
        if (!r.ok) {
          setCardError(r.error);
          if ((r.status === 409 || r.status === 404) && onChanged) onChanged(null, null);
          return;
        }
        if (onChanged) onChanged(r.data.payee || null, r.data.words && r.data.words !== 'Withdrawn.' ? r.data.words : `The invite to ${p.name} is withdrawn.`);
      } }
    ]);
  }

  function stepDown() {
    Alert.alert(`Stop getting the earnings of ${titleWord}?`, `They go back to ${defaultName || 'the default account'} from now on; what’s already credited to you stays yours.`, [
      { text: 'Keep them', style: 'cancel' },
      { text: 'Stop getting them', style: 'destructive', onPress: async () => {
        setBusy('step');
        setCardError(null);
        const r = await call('POST', '/api/payees', { action: 'step_down', type: payee.titleType, id: payee.titleId });
        setBusy(null);
        if (!r.ok) {
          setCardError(r.error);
          if (r.status === 409 && onChanged) onChanged(null, null);
          return;
        }
        if (onChanged) onChanged(r.data.payee || null, r.data.words || 'Done.');
      } }
    ]);
  }

  const sending = busy === 'send';
  const seriesNote = seriesNoteFor(payee);
  const fields = behind ? <Behind line={behind} /> : (
    <View style={{ gap: 12 }}>
      <Text style={ss.sheetLabel} accessibilityRole="header">Who should get its earnings?</Text>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {options.includes('self') ? <ChoiceRow on={choice === 'self'} title="You" disabled={sending} onPress={() => { setChoice('self'); setError(null); }} /> : null}
        {options.includes('default') ? (
          <ChoiceRow on={choice === 'default'} title={`${payee.defaultChoice.label}${defaultName ? ` (${defaultName})` : ''}`} disabled={sending} onPress={() => { setChoice('default'); setError(null); }} />
        ) : null}
        {options.includes('other') ? <ChoiceRow on={choice === 'other'} title="Someone else" disabled={sending} onPress={() => { setChoice('other'); setError(null); }} /> : null}
      </View>
      {choice === 'other' ? (
        <View style={{ gap: 6 }}>
          <Text style={ss.sheetLabel}>Their @handle or the email on their account</Text>
          <TextInput
            style={ss.input}
            value={to}
            onChangeText={(t) => { setTo(t); setError(null); if (grantOffered) { setGrantOffered(false); setGrant(false); } }}
            placeholder="@handle or name@example.com"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="email-address"
            returnKeyType="send"
            maxLength={320}
            editable={!sending}
            onSubmitEditing={() => { if (to.trim()) submit(); }}
            accessibilityLabel="Their @handle or the email on their account"
          />
          <Text style={ss.small}>They get an invite and decide. Until they accept, its earnings keep going to {paidName}.</Text>
          {seriesNote ? <Text style={ss.small}>{seriesNote}</Text> : null}
          {grantOffered ? (
            <SwitchRow title="Give them Creator Studio too" on={grant} onChange={setGrant} disabled={sending}>
              They need it to be paid for a title. It’s granted with the invite.
            </SwitchRow>
          ) : null}
        </View>
      ) : null}
    </View>
  );
  const buttons = behind ? (
    <View style={ss.sheetActions}><SmallButton label="Close" onPress={closeForm} /></View>
  ) : (
    <>
      {error ? <Text style={ss.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
      <View style={ss.sheetActions}>
        <SmallButton
          tone="primary"
          label={choice === 'other' ? (sending ? 'Sending…' : 'Send the invite') : sending ? 'Saving…' : 'Save'}
          busy={sending}
          disabled={!choice || (choice === 'other' && !to.trim()) || (choice === 'other' && grantOffered && !grant)}
          onPress={submit}
        />
        <SmallButton label="Cancel" disabled={sending} onPress={closeForm} />
      </View>
    </>
  );

  // Before migration 118: the server's line, nothing else.
  if (payee.available === false) {
    return (
      <View style={mode === 'modal' ? null : ss.card}>
        {mode !== 'modal' ? <Text style={ss.cardK} accessibilityRole="header">Who gets paid</Text> : null}
        <Behind line={payee.locked} />
      </View>
    );
  }

  const history = (payee.history || []).length >= 2 ? payee.history.slice(1) : [];
  const body = (
    <>
      <PaidLine payee={payee} withPending={false} />
      {payee.paidTo && payee.paidTo.sinceLabel ? <Text style={ss.mono}>since {payee.paidTo.sinceLabel}</Text> : null}
      {(payee.notes || []).map((n, i) => <Text key={`n${i}`} style={ss.small}>{n}</Text>)}
      {payee.houseNote ? <Text style={ss.small}>{payee.houseNote}</Text> : null}
      {payee.notReady ? (
        <View style={pc.warn}>
          <WarningIcon size={14} color={colors.brass} />
          <Text style={[ss.small, pc.warnText]}>{payee.notReady}</Text>
        </View>
      ) : null}
      {payee.pending ? (
        <View style={pc.pending} accessibilityLiveRegion="polite">
          <Text style={ss.p}>
            <Text style={ss.strong}>Waiting for {payee.pending.name} to accept</Text>
            {payee.pending.sentLabel ? ` · sent ${payee.pending.sentLabel}` : ''}
          </Text>
          <Text style={ss.small}>Until they accept, its earnings keep going to {paidName}.</Text>
          {payee.pending.canCancel && !payee.locked ? <LinkText disabled={Boolean(busy)} onPress={withdraw}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw invite'}</LinkText> : null}
        </View>
      ) : null}
      {payee.locked ? <Text style={pc.locked}>{payee.locked}</Text> : (
        <>
          {payee.lastAnswer ? <Text style={ss.small}>{payee.lastAnswer.name} said no on {payee.lastAnswer.atLabel}.</Text> : null}
          {history.map((h, i) => <Text key={`h${i}`} style={ss.mono}>Before: {h.name}{h.toLabel ? ` until ${h.toLabel}` : ''}</Text>)}
          {can.pick && !payee.pending && !(open && mode === 'modal') ? (
            <SmallButton label="Change who gets paid" disabled={Boolean(busy)} onPress={startForm} />
          ) : null}
          {can.stepDown ? (
            <Pressable onPress={stepDown} disabled={Boolean(busy)} accessibilityRole="button" style={[pc.quiet, busy && ss.disabled]}>
              <Text style={pc.quietText}>{busy === 'step' ? 'Stopping…' : 'Stop getting its earnings'}</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {cardError ? <Text style={ss.error} accessibilityLiveRegion="assertive">{cardError}</Text> : null}
    </>
  );

  if (mode === 'modal') {
    return (
      <View style={{ gap: 10 }}>
        {body}
        {open ? (
          <View style={pc.inlineForm}>
            {fields}
            {buttons}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={ss.card} accessibilityLabel="Who gets paid">
      <Text style={ss.cardK} accessibilityRole="header">Who gets paid</Text>
      {body}
      {mode === 'card' ? (
        <Text style={pc.help}>Its share of ad money and members’ support, its sales and its tips go to this account. What it already earned stays where it went.</Text>
      ) : null}
      <Sheet visible={open} title="Who gets paid" eyebrow={titleWord} onClose={closeForm} foot={buttons}>
        {fields}
      </Sheet>
    </View>
  );
}

const pc = StyleSheet.create({
  lineWrap: { gap: 3 },
  line: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: colors.ink },
  key: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8, color: colors.inkDim, textTransform: 'uppercase' },
  name: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink },
  source: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkDim },
  dot: { color: colors.inkFaint },
  pendingLine: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.olive },
  pending: { gap: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: oliveTint(0.4), backgroundColor: oliveTint(0.08) },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warnText: { flex: 1, color: colors.brass },
  locked: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim },
  quiet: { alignSelf: 'flex-start', paddingVertical: 6 },
  quietText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim, textDecorationLine: 'underline' },
  help: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkFaint, paddingTop: 8, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  inlineForm: { gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.15) },
  choiceOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.08) },
  choiceTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: inkTint(0.35), alignItems: 'center', justifyContent: 'center' },
  checkOn: { borderColor: colors.olive, backgroundColor: colors.olive }
});
