import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { clearTokens, getAccessToken, me, MeResponse } from './lib/admin-api';

interface AdminAuthCtx {
  user: MeResponse | null;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AdminAuthCtx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload(): Promise<void> {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function logout(): void {
    clearTokens();
    setUser(null);
    location.href = '/admin/login';
  }

  return <Ctx.Provider value={{ user, loading, reload, logout }}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdminAuth outside provider');
  return c;
}

const ROLE_LEVEL: Record<string, number> = {
  viewer: 0, support: 10, ops: 20, finance: 30, compliance: 40, admin: 100,
};

export function hasRole(have: string | undefined, need: string): boolean {
  if (!have) return false;
  return (ROLE_LEVEL[have] ?? -1) >= (ROLE_LEVEL[need] ?? 999);
}
