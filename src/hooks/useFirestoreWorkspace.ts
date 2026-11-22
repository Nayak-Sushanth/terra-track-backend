import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  buildLiveWorkspaceFromSnapshots,
  createInitialSyncState,
  subscribeToLiveFirestoreWorkspace,
  type LiveFirestoreSnapshotBundle,
} from '../services/liveFirestoreService';
import type { LiveCollectionSyncState, TerraWorkspaceState } from '../types';

export interface SpatialConfig {
  epsMeters: number;
  minPts: number;
  h3Resolution: 8 | 9 | 10;
}

export interface LocalAlertOverrides {
  acknowledged: Set<string>;
  resolved: Set<string>;
}

/**
 * Centralized real-time Cloud Firestore workspace hook.
 *
 * - Waits until Firebase Auth state has fully resolved AND an authorized
 *   Firebase session (`session.mode === 'firebase'` + `firebaseUser`) exists.
 * - Subscribes to all required Firestore collections via `onSnapshot` with
 *   incremental `docChanges()` tracking and automatic unmount cleanup.
 * - Never attaches listeners during Demo Mode.
 */
export function useFirestoreWorkspace(params: {
  getSpatialConfig: () => SpatialConfig;
  getLocalAlertOverrides: () => LocalAlertOverrides;
}) {
  const { session, firebaseUser, authLoading, authRestored, verifyingAdmin } = useAuth();
  const isLiveFirebaseActive =
    authRestored &&
    !authLoading &&
    !verifyingAdmin &&
    session?.mode === 'firebase' &&
    Boolean(firebaseUser);

  const [workspace, setWorkspace] = useState<TerraWorkspaceState | null>(null);
  const [syncState, setSyncState] = useState<LiveCollectionSyncState>(() =>
    createInitialSyncState()
  );
  const [loading, setLoading] = useState(false);
  const [reconnectTick, setReconnectTick] = useState(0);

  const rawBundleRef = useRef<LiveFirestoreSnapshotBundle | null>(null);
  const getSpatialConfigRef = useRef(params.getSpatialConfig);
  const getLocalAlertOverridesRef = useRef(params.getLocalAlertOverrides);

  getSpatialConfigRef.current = params.getSpatialConfig;
  getLocalAlertOverridesRef.current = params.getLocalAlertOverrides;

  const rebuildFromCache = useCallback(() => {
    if (!rawBundleRef.current) return;
    const spatial = getSpatialConfigRef.current();
    const overrides = getLocalAlertOverridesRef.current();
    const rebuilt = buildLiveWorkspaceFromSnapshots(rawBundleRef.current, {
      epsMeters: spatial.epsMeters,
      minPts: spatial.minPts,
      h3Resolution: spatial.h3Resolution,
      acknowledgedDerivedAlertIds: overrides.acknowledged,
      resolvedDerivedAlertIds: overrides.resolved,
    });
    setWorkspace(rebuilt);
  }, []);

  const reconnect = useCallback(() => {
    setReconnectTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isLiveFirebaseActive) {
      rawBundleRef.current = null;
      setWorkspace(null);
      setLoading(false);
      setSyncState(createInitialSyncState());
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToLiveFirestoreWorkspace({
      getSpatialConfig: () => getSpatialConfigRef.current(),
      getLocalAlertOverrides: () => getLocalAlertOverridesRef.current(),
      onWorkspace: (liveWorkspace, rawBundle) => {
        rawBundleRef.current = rawBundle;
        setWorkspace(liveWorkspace);
      },
      onSyncState: (nextSync) => {
        setSyncState(nextSync);
        if (!nextSync.loading) {
          setLoading(false);
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [isLiveFirebaseActive, firebaseUser?.uid, session?.role, reconnectTick]);

  return {
    isLiveFirebaseActive,
    workspace,
    syncState,
    loading,
    rawBundleRef,
    rebuildFromCache,
    reconnect,
  };
}
