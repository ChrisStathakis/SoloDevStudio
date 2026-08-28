import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Card } from './ui';

export const AuthView: React.FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        if (!username.trim() || !password) throw new Error('Username and password required');
        await login(username.trim(), password);
      } else {
        if (!username.trim() || !email.trim() || !password) throw new Error('All fields required');
        await register(username.trim(), email.trim(), password);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail
        || err?.response?.data?.error
        || err?.response?.data?.password?.[0]
        || err?.response?.data?.email?.[0]
        || err?.response?.data?.username?.[0]
        || err?.response?.data?.non_field_errors?.[0]
        || err?.message
        || 'Request failed';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/10 blur-[100px]" />
      <Card className="relative w-full max-w-md overflow-hidden p-8 shadow-2xl shadow-indigo-950/10 sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"><span className="text-lg font-black">S</span></span>
          <div><h1 className="text-xl font-extrabold tracking-tight text-content">SoloDev Studio</h1><p className="mt-0.5 text-xs text-content-muted">Your deliberate workspace for building.</p></div>
        </div>

        <div className="mb-6 flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
          <button type="button" onClick={() => setMode('login')} className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold transition ${mode === 'login' ? 'bg-surface text-content shadow-sm' : 'text-content-muted hover:text-content'}`}>Log in</button>
          <button type="button" onClick={() => setMode('register')} className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold transition ${mode === 'register' ? 'bg-surface text-content shadow-sm' : 'text-content-muted hover:text-content'}`}>Create account</button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-content-muted">Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} required autoFocus placeholder="e.g. solodev" className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-content outline-none placeholder:text-content-muted focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20" />
          </div>
          {mode === 'register' && (
            <div>
              <label className="mb-1.5 block text-xs font-bold text-content-muted">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-content outline-none placeholder:text-content-muted focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-content-muted">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-content outline-none placeholder:text-content-muted focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20" />
          </div>

          {error && <div className="text-xs text-rose-300 bg-rose-950/30 border border-rose-900/50 rounded-xl px-3 py-2">{error}</div>}

          <Button type="submit" disabled={loading} className="mt-2 w-full">{loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</Button>
        </form>
        <p className="mt-6 text-center text-xs leading-5 text-content-muted">Your projects, ideas, and focus history stay together in one calm workspace.</p>
      </Card>
    </div>
  );
};
