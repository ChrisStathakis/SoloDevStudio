import React from 'react';

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const buttonTones: Record<ButtonTone, string> = {
  primary: 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-400 active:bg-indigo-600',
  secondary: 'bg-surface-2 text-content border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'text-content-muted hover:bg-surface-2 hover:text-content',
  danger: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 hover:bg-rose-500/20',
  success: 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400',
};

export function Button({
  tone = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverse disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${buttonTones[tone]} ${className}`}
    />
  );
}

export function IconButton({ className = '', label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={props.title || label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-surface-2 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80 ${className}`}
    />
  );
}

export function Card({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-2xl border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.12)] ${className}`}>{children}</div>;
}

export function Badge({ tone = 'neutral', className = '', children }: { tone?: 'neutral' | 'indigo' | 'emerald' | 'amber' | 'rose'; className?: string; children: React.ReactNode }) {
  const tones = {
    neutral: 'bg-surface-2 text-content-muted border-line',
    indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
  };
  return <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-bold ${tones[tone]} ${className}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300/80">{eyebrow}</p>}
        <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-content sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-content-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/60 p-8 text-center">
      <h3 className="text-sm font-bold text-content">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs leading-5 text-content-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Dialog({
  label,
  onClose,
  children,
  className = '',
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // onClose is stored in a ref so parent re-renders (e.g. every keystroke in a
  // form field, which creates a new inline closure) don't re-run this effect.
  // Previously the [onClose] dep re-scheduled "focus first on open" per render,
  // yanking focus out of the field being typed in and onto the first tab button.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && panelRef.current) {
        const nodes = panelRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const focusables = (Array.from(nodes) as HTMLElement[]).filter(el => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus first focusable on open only (once per mount)
    const t = window.setTimeout(() => {
      const preferred = panelRef.current?.querySelector('[data-autofocus="true"]') as HTMLElement | null;
      const first = preferred ?? (panelRef.current?.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])') as HTMLElement | null);
      first?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className={`bg-surface rounded-3xl shadow-2xl border border-line w-full overflow-hidden flex flex-col max-h-[90vh] ${className}`}>
        {children}
      </div>
    </div>
  );
}
