import { createContext, useContext, useEffect, useState } from 'react';
import { api, ApiError, setUnauthorizedHandler, type Me } from './api';

interface AuthState {
  me: Me | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: 'Invalid email or password.',
  account_locked: 'Account locked after repeated failures — contact an administrator.',
  locked: 'Account locked after repeated failures — contact an administrator.',
  inactive: 'This account is deactivated.',
};

export function loginErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return LOGIN_ERRORS[e.errorCode] ?? `Login failed (${e.errorCode}).`;
  return 'Login failed — network error.';
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Any 401 from any screen means the server session is gone — drop local
    // auth state so the route guard falls back to the login screen.
    setUnauthorizedHandler(() => setMe(null));
    void (async () => {
      try {
        setMe(await api<Me>('/auth/me'));
      } catch {
        setMe(null);
      } finally {
        setReady(true);
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(email: string, password: string): Promise<void> {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setMe(await api<Me>('/auth/me'));
  }

  async function logout(): Promise<void> {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        // Real failure (network/5xx): the httpOnly cookie and server session
        // survive, so do NOT pretend the sign-out worked — the caller surfaces
        // the error and local state stays signed-in.
        throw e;
      }
      // 401 = session already ended server-side; sign-out is effectively done.
    }
    setMe(null);
  }

  return <AuthContext.Provider value={{ me, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
