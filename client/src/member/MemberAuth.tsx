import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, TOKEN_KEY } from '../lib/api';
import type { Member } from '../lib/contract';

interface MemberAuthCtx {
  token: string | null;
  member: Member | null;
  ready: boolean;
  signIn: (token: string, member: Member) => void;
  signOut: () => void;
  setMember: (m: Member) => void;
}

const Ctx = createContext<MemberAuthCtx | null>(null);

export function MemberAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem(TOKEN_KEY),
  );
  const [member, setMemberState] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((m) => {
        if (!cancelled) setMemberState(m);
      })
      .catch(() => {
        if (!cancelled) {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signIn = useCallback((tk: string, m: Member) => {
    sessionStorage.setItem(TOKEN_KEY, tk);
    setToken(tk);
    setMemberState(m);
  }, []);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMemberState(null);
  }, []);

  const value = useMemo<MemberAuthCtx>(
    () => ({ token, member, ready, signIn, signOut, setMember: setMemberState }),
    [token, member, ready, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMemberAuth(): MemberAuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMemberAuth must be used within MemberAuthProvider');
  return ctx;
}
