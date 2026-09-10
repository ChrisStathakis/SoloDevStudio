import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: 'success' | 'error' | 'info';
  durationMs?: number;
  action?: ToastAction;
}

interface Toast extends Required<Pick<ToastOptions, 'title' | 'tone'>> {
  id: number;
  description?: string;
  action?: ToastAction;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ToastContextType {
  toast: (opts: ToastOptions) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = idRef.current++;
    const duration = opts.durationMs ?? (opts.action ? 8000 : 4000);
    setToasts(prev => [...prev.slice(-3), { id, title: opts.title, description: opts.description, tone: opts.tone || 'info', action: opts.action }]);
    const timer = window.setTimeout(() => dismiss(id), duration);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPendingConfirm({ ...opts, resolve });
    });
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    setPendingConfirm(prev => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast region */}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2 md:bottom-6 md:right-6" role="status" aria-live="polite" aria-label="Notifications">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2">
            {t.tone === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />}
            {t.tone === 'error' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />}
            {t.tone === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-content">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-content-muted">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded-lg p-1 text-content-faint hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {/* Confirm dialog */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) resolveConfirm(false); }}>
          <div role="alertdialog" aria-modal="true" aria-label={pendingConfirm.title} aria-describedby="confirm-desc" className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${pendingConfirm.danger ? 'bg-rose-500/15 text-rose-500' : 'bg-indigo-500/15 text-indigo-400'}`}>
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-black text-content">{pendingConfirm.title}</h2>
                {pendingConfirm.description && <p id="confirm-desc" className="mt-1 text-xs leading-5 text-content-muted">{pendingConfirm.description}</p>}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => resolveConfirm(false)} className="rounded-xl px-4 py-2 text-xs font-bold text-content-muted hover:bg-surface-2 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                {pendingConfirm.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => resolveConfirm(true)}
                onKeyDown={e => { if (e.key === 'Enter') resolveConfirm(true); }}
                className={`rounded-xl px-4 py-2 text-xs font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${pendingConfirm.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
              >
                {pendingConfirm.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};
