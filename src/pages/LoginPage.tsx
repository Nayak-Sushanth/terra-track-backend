import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  UserPlus,
  LogIn,
  AlertCircle,
  CheckCircle2,
  Database,
  PlayCircle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';

export const LoginPage: React.FC = () => {
  const {
    loginWithEmail,
    registerWithEmail,
    sendPasswordReset,
    enterDemoMode,
    authError,
    verifyingAdmin,
    clearAuthError,
    firebaseReady,
    missingFirebaseVars,
    connectivity,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('Pavement & GIS Engineering');
  const [districtScope, setDistrictScope] = useState('All Municipal Districts');
  const [demoRole, setDemoRole] = useState<UserRole>('Admin');
  const [error, setError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [enteringDemo, setEnteringDemo] = useState(false);

  const formatPasswordResetError = (err: unknown): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    switch (code) {
      case 'auth/invalid-email':
        return 'Please enter a valid Municipal Email address.';
      case 'auth/missing-email':
        return 'Please enter your Municipal Email address first.';
      case 'auth/user-not-found':
        return 'No Firebase operator account was found for that email address.';
      case 'auth/too-many-requests':
        return 'Too many password reset requests. Please wait a few minutes before trying again.';
      case 'auth/network-request-failed':
        return 'Network error while contacting Firebase Authentication. Please check your connection.';
      default: {
        const msg = err instanceof Error ? err.message : 'Unable to send password reset email.';
        return msg.replace('Firebase: ', '');
      }
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    clearAuthError();
    setResetSuccess(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your Municipal Email address above to reset your password.');
      return;
    }

    setSendingReset(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setResetSuccess(
        `Password reset email sent to ${trimmedEmail}. Please check your inbox (and spam folder) for instructions.`
      );
    } catch (err) {
      setError(formatPasswordResetError(err));
    } finally {
      setSendingReset(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    clearAuthError();
    setResetSuccess(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        await registerWithEmail({
          email,
          password,
          fullName,
          department,
          districtScope,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      setError(msg.replace('Firebase: ', ''));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnterDemo = async () => {
    setError(null);
    clearAuthError();
    setResetSuccess(null);
    setEnteringDemo(true);
    try {
      await enterDemoMode(demoRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start DEMO MODE session.');
    } finally {
      setEnteringDemo(false);
    }
  };

  const displayedError = error || authError;

  return (
    <div className="min-h-screen w-full bg-[#E9EDF3] flex flex-col lg:flex-row">
      {/* Left Soft Elevated Authority Panel */}
      <div className="lg:w-[448px] shrink-0 neu-sidebar text-[#17243A] p-8 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3.5">
            <div className="neu-btn-primary flex h-11 w-11 items-center justify-center rounded-2xl font-mono text-[15px] font-bold text-white">
              TT
            </div>
            <div>
              <div className="text-[19px] font-bold tracking-[-0.02em] leading-tight text-[#17243A]">
                TERRA Track
              </div>
              <div className="font-mono text-[11px] text-[#718096]">
                Municipal Road Intelligence Platform
              </div>
            </div>
          </div>

          <h1 className="mt-8 text-[22px] font-bold tracking-[-0.02em] leading-snug text-[#17243A]">
            Role-Protected Municipal GIS & ESP32 Telemetry Console
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[#52627A]">
            Sign in with your municipal Firebase account to manage validated MPU6050 pothole
            detections, DBSCAN/H3 spatial hotspots, repair work orders, and physical manual SOS
            alerts.
          </p>

          <div className="mt-7 space-y-4">
            <div className="neu-inset p-4">
              <div className="label-caps text-[#718096]">Firebase Backend Target</div>
              <div className="mt-2 flex items-center justify-between font-mono text-[12px]">
                <span className="font-bold text-[#17243A]">{connectivity.projectId}</span>
                <span className="font-semibold text-[#0F766E]">asia-south1 · (default)</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-[#52627A]">
                {connectivity.status === 'connected' ? (
                  <CheckCircle2 className="h-4 w-4 text-[#1E9E63] shrink-0" />
                ) : (
                  <Database className="h-4 w-4 text-[#D97706] shrink-0" />
                )}
                <span>{connectivity.message}</span>
              </div>
            </div>

            <div className="neu-surface-sm p-4 space-y-2 text-[12px]">
              <div className="label-caps text-[#718096]">Backend-Enforced RBAC Roles</div>
              <div className="flex items-center justify-between text-[#17243A]">
                <span className="font-semibold">1. Admin</span>
                <span className="font-mono text-[10px] text-[#718096]">Full Governance</span>
              </div>
              <div className="flex items-center justify-between text-[#17243A]">
                <span className="font-semibold">2. Municipal Officer</span>
                <span className="font-mono text-[10px] text-[#718096]">Triage & Dispatch</span>
              </div>
              <div className="flex items-center justify-between text-[#17243A]">
                <span className="font-semibold">3. Field Maintenance Team</span>
                <span className="font-mono text-[10px] text-[#718096]">Repair Execution</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t neu-divider pt-4 text-[11px] text-[#718096]">
          Authoritative roles are verified server-side via Firebase ID tokens and Firestore security
          rules. Client-supplied roles are never trusted.
        </div>
      </div>

      {/* Right Neumorphic Auth Workspace */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md space-y-5">
          <div className="neu-card p-7">
            <div className="flex items-center justify-between border-b neu-divider pb-4">
              <div>
                <h2 className="text-[17px] font-bold text-[#17243A]">
                  {mode === 'login' ? 'Municipal Operator Sign In' : 'Create Operator Account'}
                </h2>
                <p className="text-[12px] text-[#718096] mt-0.5">
                  Firebase Email & Password Authentication
                </p>
              </div>
              <div className="neu-inset-sm flex h-10 w-10 items-center justify-center rounded-xl text-[#356AE6]">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            <div className="neu-tab-track mt-5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  clearAuthError();
                  setResetSuccess(null);
                }}
                className={`h-9 text-[12px] font-semibold transition-all ${
                  mode === 'login' ? 'neu-tab-active' : 'neu-tab-inactive'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  clearAuthError();
                  setResetSuccess(null);
                }}
                className={`h-9 text-[12px] font-semibold transition-all ${
                  mode === 'register' ? 'neu-tab-active' : 'neu-tab-inactive'
                }`}
              >
                Register Account
              </button>
            </div>

            {!firebaseReady && (
              <div className="mt-4 rounded-xl border border-[#FDBA74] bg-[#FEF3E6] p-3.5 text-[12px] text-[#9A3412]">
                <div className="font-semibold">Firebase Web Env Variables Required for Live Auth</div>
                <p className="mt-1 text-[11px]">
                  Missing: <span className="font-mono">{missingFirebaseVars.join(', ')}</span>.
                  Configure these in AI Studio Secrets for project{' '}
                  <span className="font-mono">terra-track-53004</span>, or enter DEMO MODE below.
                </p>
              </div>
            )}

            {verifyingAdmin && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#93C5FD] bg-[#EEF4FF] p-3.5 text-[12px] text-[#1D4ED8]"
              >
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#356AE6]" />
                <div>
                  <div className="font-semibold text-[#17243A]">
                    Verifying administrator authorization...
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#52627A]">
                    Validating your Firebase ID token with the TERRA Track backend.
                  </div>
                </div>
              </div>
            )}

            {displayedError && !verifyingAdmin && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FDECEC] p-3.5 text-[12px] text-[#DC2626]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{displayedError}</span>
              </div>
            )}

            {resetSuccess && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#86EFAC] bg-[#E8F8EE] p-3.5 text-[12px] text-[#15803D]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{resetSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="label-caps block text-[#52627A]">Full Name</label>
                    <input
                      required
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g., Elena Vance, PE"
                      className="neu-input mt-1.5 h-10 w-full px-3.5 text-[13px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label-caps block text-[#52627A]">Department</label>
                      <input
                        required
                        type="text"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="neu-input mt-1.5 h-10 w-full px-3 text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="label-caps block text-[#52627A]">District Scope</label>
                      <input
                        required
                        type="text"
                        value={districtScope}
                        onChange={(e) => setDistrictScope(e.target.value)}
                        className="neu-input mt-1.5 h-10 w-full px-3 text-[12px]"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="label-caps block text-[#52627A]">Municipal Email</label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[#718096]" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@municipality.gov"
                    className="neu-input h-10 w-full pl-10 pr-3.5 text-[13px]"
                  />
                </div>
              </div>

              <div>
                <label className="label-caps block text-[#52627A]">Password</label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[#718096]" />
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="neu-input h-10 w-full pl-10 pr-3.5 text-[13px]"
                  />
                </div>
                {mode === 'login' && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={sendingReset || !firebaseReady}
                      className="text-[12px] font-semibold text-[#356AE6] hover:text-[#2756C5] hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      {sendingReset ? 'Sending reset email...' : 'Forgot Password?'}
                    </button>
                  </div>
                )}
              </div>

              {mode === 'register' && (
                <p className="text-[11px] text-[#718096]">
                  New accounts are provisioned with least-privilege role{' '}
                  <span className="font-mono font-semibold text-[#17243A]">
                    Field Maintenance Team
                  </span>
                  . An Admin can elevate roles in Settings.
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || verifyingAdmin || !firebaseReady}
                className="neu-btn-primary mt-1 inline-flex h-10 w-full items-center justify-center gap-2 px-4 text-[13px] font-semibold disabled:opacity-50"
              >
                {verifyingAdmin ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying Administrator Access...
                  </>
                ) : mode === 'login' ? (
                  <>
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    {submitting ? 'Authenticating...' : 'Sign In with Firebase'}
                  </>
                ) : (
                  <>
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    {submitting ? 'Creating Account...' : 'Create Municipal Account'}
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Separate DEMO MODE Sandbox Entry */}
          <div className="neu-card p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-bold text-[#17243A]">
                  DEMO MODE — Simulated Municipal Sandbox
                </div>
                <div className="text-[11px] text-[#718096] mt-0.5">
                  Isolated from live Firestore data. Preview any of the 3 RBAC roles.
                </div>
              </div>
              <span className="neu-inset-sm px-2 py-0.5 font-mono text-[10px] font-bold text-[#52627A]">
                DEMO
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <select
                value={demoRole}
                onChange={(e) => setDemoRole(e.target.value as UserRole)}
                className="neu-input h-9 flex-1 px-3 text-[12px] font-medium"
              >
                <option value="Admin">Demo Role: Admin</option>
                <option value="Municipal Officer">Demo Role: Municipal Officer</option>
                <option value="Field Maintenance Team">Demo Role: Field Maintenance Team</option>
              </select>
              <button
                type="button"
                disabled={enteringDemo}
                onClick={handleEnterDemo}
                className="neu-btn inline-flex h-9 items-center gap-1.5 px-3.5 text-[12px] font-bold text-[#356AE6] whitespace-nowrap shrink-0"
              >
                <PlayCircle className="h-4 w-4" />
                {enteringDemo ? 'Starting...' : 'Enter Demo Mode'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
