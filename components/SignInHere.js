import { SignInButton, SignUpButton } from '@clerk/nextjs';
import { useRouter } from 'next/router';
import { stayHereProps, stayHereSignUpProps } from '../lib/resumeTaskRules';

// A button on a page that opens Clerk's sign-in box (Jose, 2026-11-14:
// "i want them to be able to sign up and sign in but maintain within what
// they were doing"). Signing in, or creating an account from that same
// box, both end on the page the person is on — named outright
// (lib/resumeTaskRules.js stayHereProps) rather than left to Clerk's
// default or to a redirect set in its dashboard. `children` is the button.
//
// Not for the general ways in (the account page's card, the beta door):
// those say where a sign-in lands themselves (/signed-in).
export default function SignInHere({ children }) {
  const { asPath } = useRouter();
  return <SignInButton mode="modal" {...stayHereProps(asPath)}>{children}</SignInButton>;
}

// The same for a button that opens the sign-up box.
export function SignUpHere({ children }) {
  const { asPath } = useRouter();
  return <SignUpButton mode="modal" {...stayHereSignUpProps(asPath)}>{children}</SignUpButton>;
}
