import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, WifiOff } from 'lucide-react';
import { MainLayout } from './layouts/MainLayout';
import { SimulateTelemetryModal } from './components/common/SimulateTelemetryModal';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { UserProfileModal } from './components/auth/UserProfileModal';
import { LoginPage } from './pages/LoginPage';
import { OverviewDashboard } from './pages/OverviewDashboard';
import { LiveRoadMap } from './pages/LiveRoadMap';
import { PotholeManagement } from './pages/PotholeManagement';
import { HotspotAnalysis } from './pages/HotspotAnalysis';
import { RepairManagement } from './pages/RepairManagement';
import { AlertsNotifications } from './pages/AlertsNotifications';
import { DeviceManagement } from './pages/DeviceManagement';
import { AnalyticsReports } from './pages/AnalyticsReports';
import { SettingsUsers } from './pages/SettingsUsers';
import { useAuth } from './contexts/AuthContext';
import { useFirestoreWorkspace } from './hooks/useFirestoreWorkspace';
import { loadInitialWorkspace, terraApiClient } from './services/terraService';
import {
  createLiveRepairTask,
  updateLiveDeviceAlertStatus,
  updateLivePotholeRecord,
  updateLiveRepairTask,
} from './services/liveFirestoreService';
import type {
  AlertStatus,
  DbscanCluster,
  Esp32Device,
  MunicipalUser,
  PotholeRecord,
  PotholeStatus,
  RepairWorkOrder,
  ScreenId,
  SystemSettings,
  TelemetryIngestPayload,
  TerraWorkspaceState,
  UserRole,
} from './types';

export default function App() {
  const { session, authLoading, verifyingAdmin, logout } = useAuth();

  const [activeScreen, setActiveScreen] = useState<ScreenId>('overview');
  const [demoWorkspace, setDemoWorkspace] = useState<TerraWorkspaceState | null>(null);
  const [loadingDemoWorkspace, setLoadingDemoWorkspace] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [actionErrorBanner, setActionErrorBanner] = useState<string | null>(null);
  const [dismissedSyncErrorsKey, setDismissedSyncErrorsKey] = useState<string | null>(null);

  const spatialConfigRef = useRef<{
    epsMeters: number;
    minPts: number;
    h3Resolution: 8 | 9 | 10;
  }>({
    epsMeters: 320,
    minPts: 2,
    h3Resolution: 9,
  });
  const localAlertOverridesRef = useRef<{
    acknowledged: Set<string>;
    resolved: Set<string>;
  }>({
    acknowledged: new Set<string>(),
    resolved: new Set<string>(),
  });

  // Cross-screen contextual selections
  const [selectedMapPotholeId, setSelectedMapPotholeId] = useState<string | null>(null);
  const [mapFocusCoord, setMapFocusCoord] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const [prefillRepair, setPrefillRepair] = useState<{
    title: string;
    roadName: string;
    district: string;
    potholeIds: string[];
    clusterId: string | null;
    priority: 'P1' | 'P2' | 'P3';
  } | null>(null);

  const isLiveFirebaseMode = session?.mode === 'firebase';

  // Centralized real-time Cloud Firestore subscription (gated strictly on resolved Firebase Auth)
  const {
    workspace: liveWorkspace,
    syncState: liveSyncState,
    loading: loadingLiveWorkspace,
    rawBundleRef: rawLiveBundleRef,
    rebuildFromCache: rebuildLiveWorkspaceFromCache,
    reconnect: handleReconnectFirestore,
  } = useFirestoreWorkspace({
    getSpatialConfig: () => spatialConfigRef.current,
    getLocalAlertOverrides: () => localAlertOverridesRef.current,
  });

  const workspace = isLiveFirebaseMode ? liveWorkspace : demoWorkspace;
  const loadingWorkspace = isLiveFirebaseMode ? loadingLiveWorkspace : loadingDemoWorkspace;

  // Keep selectedMapPotholeId valid whenever live Firestore adds/removes potholes
  useEffect(() => {
    if (!isLiveFirebaseMode || !liveWorkspace) return;
    setSelectedMapPotholeId((prev) => {
      if (prev && liveWorkspace.potholes.some((p) => p.id === prev)) return prev;
      const firstGeolocated = liveWorkspace.potholes.find(
        (p) => p.isVerifiedForMap !== false && p.hasReliableGps !== false && p.lat !== null && p.lng !== null
      );
      return firstGeolocated?.id ?? liveWorkspace.potholes[0]?.id ?? null;
    });
  }, [isLiveFirebaseMode, liveWorkspace]);

  // Reset UI banners & handle isolated Demo Mode workspace loading
  useEffect(() => {
    if (!session) {
      setDemoWorkspace(null);
      setSelectedMapPotholeId(null);
      setMapFocusCoord(null);
      return;
    }

    if (session.mode === 'firebase') {
      setActionErrorBanner(null);
      setDismissedSyncErrorsKey(null);
      localAlertOverridesRef.current = {
        acknowledged: new Set<string>(),
        resolved: new Set<string>(),
      };
      return;
    }

    // Isolated Demo Mode (never touches live Firebase Firestore)
    let mounted = true;
    setLoadingDemoWorkspace(true);
    loadInitialWorkspace()
      .then(({ data }) => {
        if (!mounted) return;
        setDemoWorkspace(data);
        setSelectedMapPotholeId(data.potholes[0]?.id || null);
      })
      .finally(() => {
        if (mounted) setLoadingDemoWorkspace(false);
      });

    return () => {
      mounted = false;
    };
  }, [session?.uid, session?.mode, session?.role]);

  const showError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Action rejected by server.';
    setActionErrorBanner(msg);
  };

  const refreshFullWorkspace = async () => {
    if (isLiveFirebaseMode) return;
    const fresh = await terraApiClient.getWorkspace();
    setDemoWorkspace(fresh);
  };

  const resolveFirestoreDocId = (
    collectionKey: 'potholes' | 'deviceAlerts' | 'sosAlerts',
    recordId: string
  ): string => {
    const docs = rawLiveBundleRef.current?.[collectionKey] || [];
    const direct = docs.find((d) => d.id === recordId);
    if (direct) return direct.id;
    const matched = docs.find((d) => {
      const data = d.data as Record<string, unknown>;
      return (
        data.id === recordId ||
        data.pothole_id === recordId ||
        data.potholeId === recordId ||
        data.alert_id === recordId ||
        data.alertId === recordId
      );
    });
    return matched?.id ?? recordId;
  };

  // Cross-screen navigation helpers
  const handleInspectPotholeOnMap = (pothole: PotholeRecord) => {
    if (
      pothole.hasReliableGps === false ||
      typeof pothole.lat !== 'number' ||
      typeof pothole.lng !== 'number' ||
      !Number.isFinite(pothole.lat) ||
      !Number.isFinite(pothole.lng) ||
      (pothole.lat === 0 && pothole.lng === 0)
    ) {
      setActionErrorBanner(
        `Pothole ${pothole.eventId ?? pothole.id} does not have reliable GPS coordinates and cannot be plotted on the map.`
      );
      return;
    }
    setSelectedMapPotholeId(pothole.id);
    setMapFocusCoord({ lat: pothole.lat, lng: pothole.lng, zoom: 16 });
    setActiveScreen('map');
  };

  const handleLocateCoordOnMap = (lat: number, lng: number) => {
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      (lat === 0 && lng === 0)
    ) {
      return;
    }
    setMapFocusCoord({ lat, lng, zoom: 16 });
    setActiveScreen('map');
  };

  const handleStartRepairForPothole = (pothole: PotholeRecord) => {
    const roadLabel = pothole.roadName ?? (pothole.eventId ?? pothole.id);
    setPrefillRepair({
      title: `${roadLabel} (${pothole.id}) Asphalt Patch`,
      roadName: pothole.roadName ?? 'N/A',
      district: pothole.district ?? 'N/A',
      potholeIds: [pothole.id],
      clusterId: pothole.clusterId,
      priority: pothole.priorityTier ?? 'P2',
    });
    setActiveScreen('repairs');
  };

  const handleStartRepairForCluster = (cluster: DbscanCluster) => {
    setPrefillRepair({
      title: `${cluster.name} Batch Resurfacing (${cluster.id})`,
      roadName: cluster.name,
      district: cluster.district ?? 'N/A',
      potholeIds: cluster.potholeIds,
      clusterId: cluster.id,
      priority: cluster.riskTier === 'Critical' ? 'P1' : 'P2',
    });
    setActiveScreen('repairs');
  };

  // Mutation handlers (Live Firebase Firestore vs isolated Demo Mode)
  const handleUpdatePothole = async (
    id: string,
    patch: Partial<Pick<PotholeRecord, 'status' | 'severity' | 'notes' | 'verified'>>
  ) => {
    setActionErrorBanner(null);
    try {
      if (isLiveFirebaseMode) {
        const docId = resolveFirestoreDocId('potholes', id);
        await updateLivePotholeRecord(docId, patch);
        return;
      }
      await terraApiClient.updatePothole(id, {
        status: patch.status,
        severity: patch.severity,
        notes: patch.notes,
      });
      await refreshFullWorkspace();
    } catch (err) {
      showError(err);
    }
  };

  const handleUpdatePotholeStatus = async (id: string, status: PotholeStatus) => {
    await handleUpdatePothole(id, { status });
  };

  const handleRecomputeHotspots = async (params: {
    epsMeters: number;
    minPts: number;
    h3Resolution: 8 | 9 | 10;
  }) => {
    setActionErrorBanner(null);
    try {
      if (isLiveFirebaseMode) {
        spatialConfigRef.current = { ...params };
        rebuildLiveWorkspaceFromCache();
        return;
      }
      const res = await terraApiClient.recomputeHotspots(params);
      setDemoWorkspace((prev) =>
        prev
          ? {
              ...prev,
              clusters: res.clusters,
              h3Cells: res.h3Cells,
              potholes: res.potholes,
              settings: {
                ...prev.settings,
                dbscanDefaultEpsMeters: params.epsMeters,
                dbscanDefaultMinPts: params.minPts,
                h3DefaultResolution: params.h3Resolution,
              },
            }
          : prev
      );
    } catch (err) {
      showError(err);
    }
  };

  const handleCreateRepairOrder = async (
    payload: Omit<RepairWorkOrder, 'id' | 'createdAt' | 'completedAt' | 'dataSource'>
  ) => {
    setActionErrorBanner(null);
    try {
      if (isLiveFirebaseMode && session) {
        const mappedPayload = {
          ...payload,
          potholeIds: payload.potholeIds.map((pid) =>
            resolveFirestoreDocId('potholes', pid)
          ),
        };
        await createLiveRepairTask(mappedPayload, session.uid);
        return;
      }
      const res = await terraApiClient.createRepairOrder(payload);
      setDemoWorkspace((prev) =>
        prev
          ? {
              ...prev,
              repairs: [res.order, ...prev.repairs],
              potholes: res.potholes,
            }
          : prev
      );
    } catch (err) {
      showError(err);
      throw err;
    }
  };

  const handleUpdateRepairOrder = async (
    id: string,
    patch: Partial<Pick<RepairWorkOrder, 'status' | 'assignedCrewId' | 'priority' | 'notes'>>
  ) => {
    setActionErrorBanner(null);
    try {
      if (isLiveFirebaseMode) {
        const existingOrder = workspace?.repairs.find((r) => r.id === id);
        const linkedDocIds = (existingOrder?.potholeIds || []).map((pid) =>
          resolveFirestoreDocId('potholes', pid)
        );
        await updateLiveRepairTask(id, patch, {
          linkedPotholeIds: linkedDocIds,
          previousStatus: existingOrder?.status,
          actorUid: session?.uid,
          actorName: session?.fullName || session?.email,
        });
        return;
      }
      await terraApiClient.updateRepairOrder(id, patch);
      await refreshFullWorkspace();
    } catch (err) {
      showError(err);
    }
  };

  const handleUpdateAlertStatus = async (id: string, status: AlertStatus) => {
    setActionErrorBanner(null);
    try {
      if (isLiveFirebaseMode && session) {
        const target = workspace?.alerts.find((a) => a.id === id);
        if (target?.sourceCollection === 'device_alerts') {
          const docId = resolveFirestoreDocId('deviceAlerts', id);
          await updateLiveDeviceAlertStatus(
            docId,
            status,
            session.email || session.fullName,
            'device_alerts'
          );
        } else if (target?.sourceCollection === 'sos_alerts') {
          const docId = resolveFirestoreDocId('sosAlerts', id);
          await updateLiveDeviceAlertStatus(
            docId,
            status,
            session.email || session.fullName,
            'sos_alerts'
          );
        } else {
          if (status === 'Resolved') {
            localAlertOverridesRef.current.resolved.add(id);
            localAlertOverridesRef.current.acknowledged.add(id);
          } else if (status === 'Acknowledged') {
            localAlertOverridesRef.current.acknowledged.add(id);
          }
          rebuildLiveWorkspaceFromCache();
        }
        return;
      }
      await terraApiClient.updateAlertStatus(id, status);
      await refreshFullWorkspace();
    } catch (err) {
      showError(err);
    }
  };

  const handleAcknowledgeAllAlerts = async () => {
    setActionErrorBanner(null);
    try {
      if (isLiveFirebaseMode && session && workspace) {
        const activeAlerts = workspace.alerts.filter((a) => a.status === 'Active');
        for (const alert of activeAlerts) {
          if (alert.sourceCollection === 'device_alerts') {
            const docId = resolveFirestoreDocId('deviceAlerts', alert.id);
            await updateLiveDeviceAlertStatus(
              docId,
              'Acknowledged',
              session.email || session.fullName,
              'device_alerts'
            );
          } else if (alert.sourceCollection === 'sos_alerts') {
            const docId = resolveFirestoreDocId('sosAlerts', alert.id);
            await updateLiveDeviceAlertStatus(
              docId,
              'Acknowledged',
              session.email || session.fullName,
              'sos_alerts'
            );
          } else {
            localAlertOverridesRef.current.acknowledged.add(alert.id);
          }
        }
        rebuildLiveWorkspaceFromCache();
        return;
      }
      const alerts = await terraApiClient.markAllAlertsAcknowledged();
      setDemoWorkspace((prev) => (prev ? { ...prev, alerts } : prev));
    } catch (err) {
      showError(err);
    }
  };

  const handleTriggerManualSos = async (payload: {
    deviceId: string;
    roadName: string;
    lat: number;
    lng: number;
    operatorName: string;
    message?: string;
  }) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      setActionErrorBanner(
        'Simulated SOS triggers are disabled in Live Firebase mode. Real SOS events are ingested from ESP32 / Rider hardware into Firestore.'
      );
      return;
    }
    try {
      await terraApiClient.triggerManualSos(payload);
      await refreshFullWorkspace();
    } catch (err) {
      showError(err);
    }
  };

  const handleIngestSimulatedTelemetry = async (payload: TelemetryIngestPayload) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      throw new Error(
        'Telemetry Simulator is only available in Demo Mode so live Cloud Firestore data remains uncontaminated.'
      );
    }
    const res = await terraApiClient.ingestTelemetry(payload);
    setDemoWorkspace(res.workspace);
    return {
      acceptedIntoPotholeWorkflow: res.acceptedIntoPotholeWorkflow,
      reason: res.reason,
    };
  };

  const handleDeviceAction = async (id: string, action: 'ping' | 'calibrate' | 'ota') => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      throw new Error(
        `Direct ${action.toUpperCase()} commands are managed by the ESP32 backend service for live device ${id}.`
      );
    }
    try {
      const updated = await terraApiClient.deviceAction(id, action);
      setDemoWorkspace((prev) =>
        prev
          ? {
              ...prev,
              devices: prev.devices.map((d) => (d.id === id ? updated : d)),
            }
          : prev
      );
    } catch (err) {
      showError(err);
      throw err;
    }
  };

  const handleRegisterDevice = async (payload: {
    id: string;
    vehicleLabel: string;
    mountType: Esp32Device['mountType'];
    district: string;
    firmwareVersion: string;
  }) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      throw new Error(
        'Live ESP32 device provisioning must be completed via the TERRA Track backend device registration endpoint.'
      );
    }
    try {
      const created = await terraApiClient.registerDevice(payload);
      setDemoWorkspace((prev) =>
        prev ? { ...prev, devices: [created, ...prev.devices] } : prev
      );
    } catch (err) {
      showError(err);
      throw err;
    }
  };

  const handleUpdateSettings = async (patch: Partial<SystemSettings>) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      if (
        patch.dbscanDefaultEpsMeters !== undefined ||
        patch.dbscanDefaultMinPts !== undefined ||
        patch.h3DefaultResolution !== undefined
      ) {
        spatialConfigRef.current = {
          epsMeters: patch.dbscanDefaultEpsMeters ?? spatialConfigRef.current.epsMeters,
          minPts: patch.dbscanDefaultMinPts ?? spatialConfigRef.current.minPts,
          h3Resolution: patch.h3DefaultResolution ?? spatialConfigRef.current.h3Resolution,
        };
        rebuildLiveWorkspaceFromCache();
      }
      return;
    }
    const res = await terraApiClient.updateSettings(patch);
    setDemoWorkspace((prev) =>
      prev
        ? {
            ...prev,
            settings: res.settings,
            potholes: res.potholes,
            clusters: res.clusters,
            h3Cells: res.h3Cells,
          }
        : prev
    );
  };

  const handleCreateUser = async (payload: Omit<MunicipalUser, 'id' | 'lastLogin'>) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      throw new Error('Create municipal accounts via Firebase Authentication / Admin backend.');
    }
    const created = await terraApiClient.createUser(payload);
    setDemoWorkspace((prev) =>
      prev ? { ...prev, users: [created, ...prev.users] } : prev
    );
  };

  const handleUpdateUserRole = async (id: string, role: UserRole) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      throw new Error('Role updates are enforced server-side via the TERRA Track Admin backend.');
    }
    const updated = await terraApiClient.updateUserRole(id, role);
    setDemoWorkspace((prev) =>
      prev
        ? { ...prev, users: prev.users.map((u) => (u.id === id ? updated : u)) }
        : prev
    );
  };

  const handleToggleUserStatus = async (id: string) => {
    setActionErrorBanner(null);
    if (isLiveFirebaseMode) {
      setActionErrorBanner('User account suspension is enforced server-side via the Admin backend.');
      return;
    }
    try {
      const updated = await terraApiClient.toggleUserStatus(id);
      setDemoWorkspace((prev) =>
        prev
          ? {
              ...prev,
              users: prev.users.map((u) => (u.id === id ? updated : u)),
            }
          : prev
      );
    } catch (err) {
      showError(err);
    }
  };

  // Loading auth state persistence & backend administrator verification
  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#E9EDF3] p-4">
        <div
          role="status"
          aria-live="polite"
          className="neu-card px-8 py-7 text-center max-w-sm w-full"
        >
          <div className="neu-btn-primary mx-auto flex h-11 w-11 items-center justify-center rounded-2xl font-mono text-[14px] font-bold text-white">
            TT
          </div>
          <div className="mt-3.5 flex items-center justify-center gap-2 text-[15px] font-bold text-[#17243A]">
            <Loader2 className="h-4 w-4 animate-spin text-[#356AE6]" />
            <span>
              {verifyingAdmin
                ? 'Verifying Administrator Authorization'
                : 'Restoring TERRA Track Session'}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-[#718096]">
            {verifyingAdmin
              ? 'Validating Firebase ID token against the TERRA Track backend...'
              : 'Checking Firebase Auth persistence & Cloud Firestore connectivity...'}
          </div>
        </div>
      </div>
    );
  }

  // Protected Application Gate: unauthenticated users land on LoginPage
  if (!session) {
    return <LoginPage />;
  }

  if (loadingWorkspace || !workspace) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#E9EDF3] p-4">
        <div className="neu-card px-8 py-7 text-center max-w-sm w-full">
          <div className="neu-btn-primary mx-auto flex h-11 w-11 items-center justify-center rounded-2xl font-mono text-[14px] font-bold text-white">
            TT
          </div>
          <div className="mt-3.5 flex items-center justify-center gap-2 text-[15px] font-bold text-[#17243A]">
            <Loader2 className="h-4 w-4 animate-spin text-[#356AE6]" />
            <span>
              {isLiveFirebaseMode
                ? 'Syncing Live Cloud Firestore'
                : 'Loading Municipal GIS Workspace'}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-[#718096]">
            {isLiveFirebaseMode
              ? 'Attaching real-time listeners to terra-track-53004 (asia-south1)...'
              : `Authorized as ${session.role} (Demo Mode)`}
          </div>
        </div>
      </div>
    );
  }

  const activeSosCount = workspace.alerts.filter(
    (a) => a.isManualSos && a.status !== 'Resolved'
  ).length;
  const activeAlertsCount = workspace.alerts.filter((a) => a.status === 'Active').length;
  const syncErrorEntries = Object.entries(liveSyncState.errors);
  const syncErrorsSignature = syncErrorEntries.map(([k, v]) => `${k}:${v}`).join('|');

  return (
    <>
      <MainLayout
        activeScreen={activeScreen}
        onNavigate={(screen) => {
          setActionErrorBanner(null);
          setActiveScreen(screen);
        }}
        session={session}
        demoModeEnabled={workspace.settings.demoModeEnabled}
        liveSyncState={isLiveFirebaseMode ? liveSyncState : undefined}
        onReconnectFirestore={isLiveFirebaseMode ? handleReconnectFirestore : undefined}
        activeSosCount={activeSosCount}
        activeAlertsCount={activeAlertsCount}
        onOpenSimulator={() => {
          if (isLiveFirebaseMode) {
            setActionErrorBanner(
              'Telemetry Simulator is disabled during Live Firebase sessions to preserve authentic Firestore data.'
            );
            return;
          }
          setSimulatorOpen(true);
        }}
        onOpenProfile={() => setProfileOpen(true)}
        onLogout={logout}
      >
        {isLiveFirebaseMode && liveSyncState.isOffline && (
          <div className="mb-4 flex items-center gap-2.5 rounded-[14px] border border-[#FDBA74] bg-[#FFF4E6] px-4 py-3 text-[12px] text-[#9A3412] shadow-[4px_4px_10px_rgba(163,177,198,0.35),-3px_-3px_8px_rgba(255,255,255,0.82)]">
            <WifiOff className="h-4 w-4 shrink-0 text-[#EA580C]" />
            <span>
              <strong>Offline / Reconnecting to Cloud Firestore:</strong> Displaying latest cached
              snapshot. Real-time updates will resume automatically without refreshing once
              connectivity returns.
            </span>
          </div>
        )}

        {isLiveFirebaseMode &&
          syncErrorEntries.length > 0 &&
          dismissedSyncErrorsKey !== syncErrorsSignature && (
            <div className="neu-sos-panel mb-4 p-4 text-[12px] text-[#991B1B]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                  <div>
                    <div className="font-bold text-[#991B1B]">
                      Firestore Collection Access Notice ({syncErrorEntries.length}{' '}
                      {syncErrorEntries.length === 1 ? 'collection' : 'collections'})
                    </div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 font-mono text-[11px] text-[#7F1D1D]">
                      {syncErrorEntries.map(([colName, message]) => (
                        <li key={colName}>{message}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDismissedSyncErrorsKey(syncErrorsSignature)}
                  className="neu-btn px-2.5 py-1 font-mono text-[11px] font-semibold text-[#DC2626] shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

        {actionErrorBanner && (
          <div className="neu-sos-panel mb-4 flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-[#DC2626]">
            <span className="font-medium">{actionErrorBanner}</span>
            <button
              type="button"
              onClick={() => setActionErrorBanner(null)}
              className="neu-btn px-2.5 py-1 font-mono text-[11px] font-semibold text-[#DC2626] shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeScreen === 'overview' && (
          <ProtectedRoute screenTitle="Overview Dashboard">
            <OverviewDashboard
              workspace={workspace}
              onNavigate={setActiveScreen}
              onInspectPotholeOnMap={handleInspectPotholeOnMap}
              onQuickCreateRepair={handleStartRepairForPothole}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'map' && (
          <ProtectedRoute screenTitle="Live Road Map">
            <LiveRoadMap
              workspace={workspace}
              selectedPotholeId={selectedMapPotholeId}
              focusCoord={mapFocusCoord}
              onSelectPothole={(p) => setSelectedMapPotholeId(p?.id || null)}
              onUpdatePotholeStatus={handleUpdatePotholeStatus}
              onCreateRepairForPothole={handleStartRepairForPothole}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'potholes' && (
          <ProtectedRoute screenTitle="Pothole Management">
            <PotholeManagement
              workspace={workspace}
              onUpdatePothole={handleUpdatePothole}
              onLocateOnMap={handleInspectPotholeOnMap}
              onCreateRepair={handleStartRepairForPothole}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'hotspots' && (
          <ProtectedRoute
            screenTitle="Hotspot Analysis"
            allowedRoles={['Admin', 'Municipal Officer', 'Field Maintenance Team']}
            onFallbackNavigate={() => setActiveScreen('overview')}
          >
            <HotspotAnalysis
              workspace={workspace}
              onRecomputeHotspots={handleRecomputeHotspots}
              onCreateClusterRepair={handleStartRepairForCluster}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'repairs' && (
          <ProtectedRoute screenTitle="Repair Management">
            <RepairManagement
              workspace={workspace}
              prefillOrder={prefillRepair}
              onClearPrefill={() => setPrefillRepair(null)}
              onCreateRepairOrder={handleCreateRepairOrder}
              onUpdateRepairOrder={handleUpdateRepairOrder}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'alerts' && (
          <ProtectedRoute screenTitle="Alerts & Notifications">
            <AlertsNotifications
              workspace={workspace}
              onUpdateAlertStatus={handleUpdateAlertStatus}
              onAcknowledgeAll={handleAcknowledgeAllAlerts}
              onTriggerManualSos={handleTriggerManualSos}
              onLocateCoordOnMap={handleLocateCoordOnMap}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'devices' && (
          <ProtectedRoute screenTitle="ESP32 Device Management">
            <DeviceManagement
              workspace={workspace}
              onDeviceAction={handleDeviceAction}
              onRegisterDevice={handleRegisterDevice}
              onLocateCoordOnMap={handleLocateCoordOnMap}
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'analytics' && (
          <ProtectedRoute
            screenTitle="Analytics & Municipal Reports"
            allowedRoles={['Admin', 'Municipal Officer']}
            onFallbackNavigate={() => setActiveScreen('overview')}
          >
            <AnalyticsReports workspace={workspace} />
          </ProtectedRoute>
        )}

        {activeScreen === 'settings' && (
          <ProtectedRoute screenTitle="Settings & User Management">
            <SettingsUsers
              workspace={workspace}
              onUpdateSettings={handleUpdateSettings}
              onCreateUser={handleCreateUser}
              onUpdateUserRole={handleUpdateUserRole}
              onToggleUserStatus={handleToggleUserStatus}
            />
          </ProtectedRoute>
        )}
      </MainLayout>

      <SimulateTelemetryModal
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        devices={workspace.devices}
        onSubmitTelemetry={handleIngestSimulatedTelemetry}
      />

      <UserProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
