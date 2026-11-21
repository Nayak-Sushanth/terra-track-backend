import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  ensureFirebaseInitialized,
  testFirestoreConnection,
} from '../config/firebase';
import { usersFirestoreService } from '../services/firestoreService';
import { setApiAuthTokenProvider, terraApiClient } from '../api/client';
import { BackendAuthError, fetchAdminProfile } from '../api/backendAdminApi';
import type { AuthenticatedSession, UserRole } from '../types';

interface ConnectivityState {
  status: 'checking' | 'connected' | 'offline' | 'unconfigured' | 'error';
  message: string;
  projectId: string;
}

interface AuthContextValue {
  session: AuthenticatedSession | null;
  firebaseUser: FirebaseUser | null;
  authLoading: boolean;
  verifyingAdmin: boolean;
  authError: string | null;
  clearAuthError: () => void;
  firebaseReady: boolean;
  missingFirebaseVars: string[];
  connectivity: ConnectivityState;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (input: {
    email: string;
    password: string;
    fullName: string;
    department: string;
    districtScope: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  enterDemoMode: (role: UserRole) => Promise<void>;
  updateOwnProfile: (patch: {
    fullName: string;
    department: string;
    districtScope: string;
    phone: string;
  }) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  retestFirestoreConnection: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_PROFILE_BY_ROLE: Record<UserRole, Omit<AuthenticatedSession, 'mode'>> = {
  Admin: {
    uid: 'demo-admin-01',
    email: 'e.vance@metro-publicworks.gov',
    emailVerified: true,
    fullName: 'Elena Vance, PE',
    role: 'Admin',
    department: 'Director of Road Infrastructure',
    districtScope: 'All Municipal Districts',
    phone: '+1-415-555-0101',
    status: 'Active',
  },
  'Municipal Officer': {
    uid: 'demo-officer-01',
    email: 's.patel@metro-publicworks.gov',
    emailVerified: true,
    fullName: 'Sanjay Patel',
    role: 'Municipal Officer',
    department: 'Pavement & GIS Engineering',
    districtScope: 'Central Civic & Harbor Industrial',
    phone: '+1-415-555-0102',
    status: 'Active',
  },
  'Field Maintenance Team': {
    uid: 'demo-field-01',
    email: 'r.alvarez@metro-publicworks.gov',
    emailVerified: true,
    fullName: 'Raymond Alvarez',
    role: 'Field Maintenance Team',
    department: 'Rapid Patch & Telemetry Crew',
    districtScope: 'Harbor Industrial',
    phone: '+1-415-555-0104',
    status: 'Active',
  },
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [demoBearerToken, setDemoBearerToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [verifyingAdmin, setVerifyingAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [missingFirebaseVars, setMissingFirebaseVars] = useState<string[]>([]);
  const [connectivity, setConnectivity] = useState<ConnectivityState>({
    status: 'checking',
    message: 'Checking Firebase configuration...',
    projectId: 'terra-track-53004',
  });

  // Prevents duplicate /api/admin/profile verification while explicit login/register is in flight
  const explicitAuthInFlightRef = useRef(false);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  // Wire Authorization Bearer token provider for API calls (strictly isolated per mode)
  useEffect(() => {
    setApiAuthTokenProvider(async () => {
      if (firebaseUser) {
        return firebaseUser.getIdToken();
      }
      if (demoBearerToken) {
        return demoBearerToken;
      }
      return null;
    });
  }, [firebaseUser, demoBearerToken]);

  const retestFirestoreConnection = useCallback(async () => {
    setConnectivity((prev) => ({ ...prev, status: 'checking' }));
    const result = await testFirestoreConnection();
    setConnectivity(result);
  }, []);

  /**
   * Authorizes a Firebase-authenticated user strictly against the Node.js backend:
   *   GET ${BACKEND_API_BASE_URL}/api/admin/profile
   *   Authorization: Bearer <Firebase ID Token>
   *
   * Never trusts any frontend-supplied or locally stored role.
   */
  const hydrateFirebaseUserSession = useCallback(async (user: FirebaseUser) => {
    setVerifyingAdmin(true);

    try {
      const idToken = await user.getIdToken();
      const adminProfile = await fetchAdminProfile(idToken, user.uid);

      setFirebaseUser(user);
      setDemoBearerToken(null);
      setAuthError(null);
      setApiAuthTokenProvider(async () => user.getIdToken());

      setSession({
        mode: 'firebase',
        uid: adminProfile.uid || user.uid,
        email: adminProfile.email || user.email || '',
        emailVerified: user.emailVerified,
        fullName:
          adminProfile.fullName || user.displayName || user.email?.split('@')[0] || 'Administrator',
        role: adminProfile.role,
        department: adminProfile.department,
        districtScope: adminProfile.districtScope,
        phone: adminProfile.phone,
        status: adminProfile.status,
      });
    } catch (err) {
      // Backend denied access (401/403) or could not verify admin role (network/server error).
      // Do NOT allow access to the municipal admin dashboard and clear Firebase session cleanly.
      const init = await ensureFirebaseInitialized();
      if (init.auth?.currentUser) {
        await signOut(init.auth).catch(() => undefined);
      }
      setFirebaseUser(null);
      setDemoBearerToken(null);
      setApiAuthTokenProvider(async () => null);
      setSession(null);

      const message =
        err instanceof BackendAuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to verify administrator access with the backend.';
      setAuthError(message);
      throw err;
    } finally {
      setVerifyingAdmin(false);
    }
  }, []);

  // Initialize singleton Firebase SDK + startup connection test + Auth persistence listener
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let mounted = true;

    (async () => {
      const init = await ensureFirebaseInitialized();
      if (!mounted) return;
      setFirebaseReady(init.ready);
      setMissingFirebaseVars(init.missingFields);

      const conn = await testFirestoreConnection();
      if (mounted) setConnectivity(conn);

      if (init.ready && init.auth) {
        unsubscribe = onAuthStateChanged(init.auth, async (user) => {
          if (!mounted) return;
          if (explicitAuthInFlightRef.current) {
            return;
          }
          if (user) {
            try {
              await hydrateFirebaseUserSession(user);
            } catch {
              // Error already captured in authError and session cleared cleanly
            } finally {
              if (mounted) setAuthLoading(false);
            }
          } else {
            setFirebaseUser(null);
            setSession((prev) => (prev?.mode === 'demo' ? prev : null));
            setAuthLoading(false);
          }
        });
      } else {
        setAuthLoading(false);
      }
    })();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [hydrateFirebaseUserSession]);

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      const init = await ensureFirebaseInitialized();
      if (!init.ready || !init.auth) {
        throw new Error(
          `Firebase SDK is not configured (${init.missingFields.join(', ') || 'check env vars'}).`
        );
      }
      explicitAuthInFlightRef.current = true;
      try {
        const cred = await signInWithEmailAndPassword(init.auth, email.trim(), password);
        await hydrateFirebaseUserSession(cred.user);
      } finally {
        explicitAuthInFlightRef.current = false;
      }
    },
    [hydrateFirebaseUserSession]
  );

  const registerWithEmail = useCallback(
    async (input: {
      email: string;
      password: string;
      fullName: string;
      department: string;
      districtScope: string;
    }) => {
      setAuthError(null);
      const init = await ensureFirebaseInitialized();
      if (!init.ready || !init.auth) {
        throw new Error(
          `Firebase SDK is not configured (${init.missingFields.join(', ') || 'check env vars'}).`
        );
      }
      explicitAuthInFlightRef.current = true;
      try {
        const cred = await createUserWithEmailAndPassword(
          init.auth,
          input.email.trim(),
          input.password
        );
        await updateProfile(cred.user, { displayName: input.fullName.trim() });

        // Create least-privilege Firestore profile (`Field Maintenance Team`)
        try {
          await usersFirestoreService.createProfile({
            uid: cred.user.uid,
            fullName: input.fullName.trim(),
            email: cred.user.email || input.email.trim(),
            department: input.department.trim() || 'Municipal Public Works',
            districtScope: input.districtScope.trim() || 'All Municipal Districts',
            role: 'Field Maintenance Team',
          });
        } catch (err) {
          console.warn(
            'Firestore profile creation deferred (check firestore.rules deployment):',
            err
          );
        }

        await hydrateFirebaseUserSession(cred.user);
      } finally {
        explicitAuthInFlightRef.current = false;
      }
    },
    [hydrateFirebaseUserSession]
  );

  // Isolated DEMO MODE — never contacts Firebase Auth or the real Node.js backend
  const enterDemoMode = useCallback(async (role: UserRole) => {
    setAuthError(null);
    const demoSessionResp = await terraApiClient.createDemoSession(role);
    setFirebaseUser(null);
    setDemoBearerToken(demoSessionResp.token);
    setApiAuthTokenProvider(async () => demoSessionResp.token);
    setSession({
      mode: 'demo',
      ...DEMO_PROFILE_BY_ROLE[demoSessionResp.role],
      role: demoSessionResp.role,
    });
  }, []);

  const logout = useCallback(async () => {
    const init = await ensureFirebaseInitialized();
    if (init.auth && init.auth.currentUser) {
      await signOut(init.auth);
    }
    setFirebaseUser(null);
    setDemoBearerToken(null);
    setApiAuthTokenProvider(async () => null);
    setSession(null);
  }, []);

  const updateOwnProfile = useCallback(
    async (patch: {
      fullName: string;
      department: string;
      districtScope: string;
      phone: string;
    }) => {
      if (!session) return;
      if (session.mode === 'firebase' && firebaseUser) {
        await updateProfile(firebaseUser, { displayName: patch.fullName.trim() });
        try {
          await usersFirestoreService.updateOwnProfile(firebaseUser.uid, patch);
        } catch (err) {
          console.warn('Firestore profile update warning:', err);
        }
      }
      await terraApiClient.updateOwnProfile(patch);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              fullName: patch.fullName.trim(),
              department: patch.department.trim(),
              districtScope: patch.districtScope.trim(),
              phone: patch.phone.trim(),
            }
          : prev
      );
    },
    [session, firebaseUser]
  );

  const resendVerificationEmail = useCallback(async () => {
    if (!firebaseUser) return;
    await sendEmailVerification(firebaseUser);
  }, [firebaseUser]);

  const sendPasswordReset = useCallback(async (email: string) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      throw new Error('Please enter your Municipal Email address first.');
    }
    const init = await ensureFirebaseInitialized();
    if (!init.ready || !init.auth) {
      throw new Error(
        `Firebase SDK is not configured (${init.missingFields.join(', ') || 'check env vars'}).`
      );
    }
    await sendPasswordResetEmail(init.auth, trimmedEmail);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        firebaseUser,
        authLoading,
        verifyingAdmin,
        authError,
        clearAuthError,
        firebaseReady,
        missingFirebaseVars,
        connectivity,
        loginWithEmail,
        registerWithEmail,
        logout,
        enterDemoMode,
        updateOwnProfile,
        resendVerificationEmail,
        sendPasswordReset,
        retestFirestoreConnection,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
