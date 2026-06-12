import { useState } from 'react';
import { loginErrorMessage, useAuth } from '../auth';
import { navigate } from '../router';

export function LoginPage(): React.JSX.Element {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/app/kitchen', { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="loginWrap">
      <form className="loginCard" onSubmit={(e) => void submit(e)} aria-label="Sign in">
        <h1>Nutrezee</h1>
        <p className="loginHint">Sign in with your staff account</p>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
