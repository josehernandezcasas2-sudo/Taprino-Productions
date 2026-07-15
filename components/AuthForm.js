import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { authClient } from '../lib/auth-client';

export default function AuthForm({ mode }) {
  const router = useRouter();
  const isSignUp = mode === 'sign-up';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: authError } = isSignUp
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });

      if (authError) {
        setError(authError.message || 'Something went wrong. Try again.');
        setLoading(false);
        return;
      }

      router.push('/');
      router.refresh?.();
    } catch (err) {
      setError('Something went wrong. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-eyebrow">
          <span className="dot" aria-hidden="true" />
          <span>CIPHER CIRCLE</span>
        </div>
        <h1 className="auth-title">{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-sub">
          {isSignUp
            ? 'Join the transmission. Your membership follows you across devices.'
            : 'Sign in to pick up where the signal left off.'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          {isSignUp && (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                placeholder="Your name"
              />
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading
              ? isSignUp
                ? 'Creating account…'
                : 'Signing in…'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          {isSignUp ? (
            <>
              Already a member? <Link href="/sign-in">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/sign-up">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
