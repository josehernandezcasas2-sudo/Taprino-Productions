import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect, usePathname } from 'expo-router';
import { useAuth } from './stableAuth';
import { markStale, resumeDue, taskMark } from './resumeTaskRules';

// The app's half of lib/resumeTaskRules.js (Jose, 2026-11-14: "i want them
// to be able to sign up and sign in but maintain within what they were
// doing"; the website's lib/resumeTask.js keeps its mark in sessionStorage).
//
// In the app a signed-out person who presses Tip or Own is sent to the
// sign-in card on the Account screen, and comes back to the screen they
// were on once they have signed in or created an account there
// (components/account/AccountBits.js). The mark says what they had
// pressed, so that screen carries on by itself: the Tip sheet opens,
// Checkout starts, the plans open.
//
// The mark is one module variable: memory only. It never outlives the app
// and never reaches the phone's storage; a mark older than the rules'
// fifteen minutes is thrown away the next time anything looks at it.
let mark = null;

// Before the sign-in card opens for something the person pressed. `path`
// is the screen they are on (usePathname), where the mark belongs.
export function rememberTask(task, path) {
  mark = taskMark(task, path, Date.now());
}

// → the task to carry on with, once; null when there is none for `want` on
// this screen. A stale mark is dropped on the way; one for another screen
// or another task is left for whoever it belongs to.
export function takeTask(want, path) {
  if (!mark) return null;
  const now = Date.now();
  if (markStale(mark, now)) {
    mark = null;
    return null;
  }
  if (!resumeDue(mark, { want, path, now })) return null;
  const task = mark.task;
  mark = null;
  return task;
}

// The sign-in card was left without signing in (AccountBits.js): what the
// person was about to do is not picked up by a later sign-in.
export function forgetTask() {
  mark = null;
}

// The screen may still be sliding back into place when it comes into focus
// (the sign-in card is on its way out). A sheet presented or a screen
// pushed in that moment can be dropped on an iPhone, so carrying on waits
// this long after the mark is taken.
const CARRY_ON_AFTER_MS = 500;

// Runs `carryOn(task)` once when this screen is the one showing, the
// screen knows the person (`isSignedIn`: its own read says so, not just
// Clerk) and a mark for `want` waits on this screen's path. `want` is a
// whole task ('plans', 'tip:user_1'), a family ending in ':' ('buy:'), or
// null for nothing. The newest `carryOn` is the one called, so it sees the
// screen as it is after the re-read. A person who has already left the
// screen again by then is not followed: the mark is used up either way.
export function useResumeTask(want, isSignedIn, carryOn) {
  const pathname = usePathname();
  const carry = useRef(carryOn);
  carry.current = carryOn;
  const showing = useRef(false);
  const timer = useRef(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useFocusEffect(useCallback(() => {
    showing.current = true;
    return () => { showing.current = false; };
  }, []));
  useFocusEffect(useCallback(() => {
    if (!want || !isSignedIn) return;
    const task = takeTask(want, pathname);
    if (!task) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (showing.current) carry.current(task);
    }, CARRY_ON_AFTER_MS);
  }, [want, isSignedIn, pathname]));
}

// The server may not see a new session for a moment after Clerk says the
// sign-in is done, so a screen asks again a few times before leaving
// itself as it is.
const REREAD_TRIES = 3;
const REREAD_WAIT_MS = 1500;

// A screen that read its page signed out says so (the answer's
// isSignedIn). Back on it from the sign-in card that answer is stale: the
// Tip button would ask to sign in again and nothing would be carried on.
// While the screen is showing, Clerk says signed in and the page still
// says signed out, `reread` asks for the page again: at once, then up to
// twice more a little apart. `page` is the screen's answer (null while
// there is none): each new answer is looked at once.
export function useRereadWhenSignedIn(page, pageSignedIn, reread) {
  const { isLoaded, isSignedIn } = useAuth();
  const tries = useRef(0);
  const ask = useRef(reread);
  ask.current = reread;
  // Signed out again: the next sign-in starts from the first try.
  useEffect(() => {
    if (isLoaded && !isSignedIn) tries.current = 0;
  }, [isLoaded, isSignedIn]);
  useFocusEffect(useCallback(() => {
    if (!isLoaded || !isSignedIn || !page || pageSignedIn || tries.current >= REREAD_TRIES) return undefined;
    const timer = setTimeout(() => {
      tries.current += 1;
      ask.current();
    }, tries.current === 0 ? 0 : REREAD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn, page, pageSignedIn]));
}
