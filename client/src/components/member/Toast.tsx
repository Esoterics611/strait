import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastTone = 'info' | 'success' | 'warn' | 'danger';
interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastCtx {
  show: (text: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const TONE: Record<ToastTone, string> = {
  info: 'bg-slate-900 text-white',
  success: 'bg-emerald-600 text-white',
  warn: 'bg-amber-500 text-white',
  danger: 'bg-rose-600 text-white',
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = idRef.current++;
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              `pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm ` +
              `font-medium shadow-lg motion-safe:animate-[fade-in_.2s_ease-out] ${TONE[t.tone]}`
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
