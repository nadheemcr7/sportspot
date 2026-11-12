import React, { useState } from 'react';
import { Lock, User, Phone, Shield, X, AlertCircle, UserPlus, LogIn } from 'lucide-react';
import { UserAccount } from '../types/sportspot';
import { safeApiJson } from '../lib/apiClient';

export type AuthModalMode = 'PLAYER_LOGIN' | 'PLAYER_REGISTER' | 'OWNER_LOGIN';

interface AuthModalProps {
  initialMode?: AuthModalMode;
  onClose: () => void;
  onAuthenticated: (user: UserAccount) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  initialMode = 'PLAYER_LOGIN',
  onClose,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const switchMode = (nextMode: AuthModalMode) => {
    setMode(nextMode);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both username and password.');
      return;
    }

    if (mode === 'PLAYER_REGISTER' && (!displayName.trim() || !phone.trim())) {
      setErrorMsg('Please enter your name and mobile number to create your account.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = mode === 'PLAYER_REGISTER' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'PLAYER_REGISTER'
          ? {
              username: username.trim(),
              password: password.trim(),
              displayName: displayName.trim(),
              phone: phone.trim(),
            }
          : {
              username: username.trim(),
              password: password.trim(),
            };

      const { ok, data } = await safeApiJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!ok) {
        throw new Error(data?.error || 'Authentication failed');
      }

      if (mode === 'OWNER_LOGIN' && data.user?.role !== 'OWNER') {
        throw new Error('This account is not a Turf Owner account. Please enter owner credentials.');
      }

      onAuthenticated(data.user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md bg-[#0F1624] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top Mode Tabs */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#141D2E] border-b border-slate-800">
          <div>
            <p className="text-xs font-mono text-[#A3E635]">
              {mode === 'OWNER_LOGIN'
                ? 'DEDICATED TURF OWNER ACCESS'
                : 'FAST USERNAME & PASSWORD ACCESS'}
            </p>
            <h2 id="auth-modal-title" className="text-lg font-display font-bold text-white">
              {mode === 'PLAYER_LOGIN' && 'Player Login'}
              {mode === 'PLAYER_REGISTER' && 'Create Player Account'}
              {mode === 'OWNER_LOGIN' && 'Turf Owner Portal Login'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close login modal"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role Switcher */}
        <div className="grid grid-cols-3 gap-1 p-2 bg-[#090D16] border-b border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => switchMode('PLAYER_LOGIN')}
            className={`py-2 px-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'PLAYER_LOGIN'
                ? 'bg-[#A3E635] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Player Login</span>
          </button>
          <button
            type="button"
            onClick={() => switchMode('PLAYER_REGISTER')}
            className={`py-2 px-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'PLAYER_REGISTER'
                ? 'bg-[#A3E635] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Sign Up</span>
          </button>
          <button
            type="button"
            onClick={() => switchMode('OWNER_LOGIN')}
            className={`py-2 px-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'OWNER_LOGIN'
                ? 'bg-[#A3E635] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Owner Login</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {mode === 'OWNER_LOGIN' && (
            <div className="bg-[#141D2E]/80 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-white">Turf Owner Admin Console</p>
              <p className="text-slate-400">
                Sign in with your owner credentials to open your dedicated management dashboard,
                verify customer GPay screenshots in one click, and manage walk-ins.
              </p>
              <p className="font-mono text-[11px] text-[#A3E635] pt-1">
                Default Owner Login: username <span className="underline">owner</span> · password{' '}
                <span className="underline">sportspot123</span>
              </p>
            </div>
          )}

          <div>
            <label htmlFor="auth-username" className="block text-xs font-medium text-slate-300 mb-1">
              Username *
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={mode === 'OWNER_LOGIN' ? 'owner' : 'e.g. rahul_7'}
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#A3E635]"
              />
            </div>
          </div>

          {mode === 'PLAYER_REGISTER' && (
            <>
              <div>
                <label
                  htmlFor="auth-displayname"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Your Full Name / Team Captain Name *
                </label>
                <input
                  id="auth-displayname"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full px-3.5 py-2.5 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div>
                <label htmlFor="auth-phone" className="block text-xs font-medium text-slate-300 mb-1">
                  Mobile Number (for Turf Entry Pass) *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98450 11223"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-[#090D16] border border-slate-700 rounded-lg text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-[#A3E635]"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300 mb-1">
              Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-password"
                type="password"
                required
                autoComplete={mode === 'PLAYER_REGISTER' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#090D16] border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#A3E635]"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 text-xs text-red-300 bg-red-950/50 border border-red-800/70 rounded-lg px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-[#A3E635] hover:bg-[#bef264] text-slate-950 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50"
          >
            {submitting
              ? 'Signing In...'
              : mode === 'PLAYER_REGISTER'
                ? 'Create Account & Continue'
                : mode === 'OWNER_LOGIN'
                  ? 'Sign In to Owner Portal'
                  : 'Sign In to Book Turf'}
          </button>
        </form>
      </div>
    </div>
  );
};
