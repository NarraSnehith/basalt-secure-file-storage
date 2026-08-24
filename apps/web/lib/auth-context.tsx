'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, onSessionLost } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  /** True until the first /auth/me answer — the app shows a skeleton, not a redirect. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  signOut: () => Promise<void>;
  patchUser: (patch: Partial<User>) => void;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children, initialUser = null }: { children: ReactNode; initialUser?: User | null }) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const { user: me } = await api.get<{ user: User }>('/auth/me');
      setUser(me);
    } catch (err) {
      // 401 here is the normal "not signed in" answer, not a failure.
      if (!(err instanceof ApiError) || !err.isAuth) console.error(err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The API client tells us when a refresh could not be salvaged.
  useEffect(() => onSessionLost(() => setUser(null)), []);

  /**
   * Keep the 15-minute access token fresh while the tab is open, so a long
   * editing session never bounces the user to the sign-in page.
   */
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      void api.post('/auth/refresh').catch(() => undefined);
    }, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: me } = await api.post<{ user: User }>('/auth/login', { email, password });
    setUser(me);
  }, []);

  const signUp = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    const { user: me } = await api.post<{ user: User }>('/auth/register', input);
    setUser(me);
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setUser(null);
    router.push('/login');
  }, [router]);

  const patchUser = useCallback((patch: Partial<User>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signUp, signOut, patchUser, reload: load }),
    [user, loading, signIn, signUp, signOut, patchUser, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
