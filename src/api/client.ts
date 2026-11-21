import type {
  AlertRecord,
  DbscanCluster,
  Esp32Device,
  H3HexCell,
  MunicipalUser,
  PotholeRecord,
  RepairWorkOrder,
  SystemSettings,
  TelemetryIngestPayload,
  TerraWorkspaceState,
  UserRole,
} from '../types';

type TokenProvider = () => Promise<string | null>;

let authTokenProvider: TokenProvider = async () => null;

export function setApiAuthTokenProvider(provider: TokenProvider): void {
  authTokenProvider = provider;
}

async function apiRequest<T>(
  url: string,
  options?: RequestInit & { explicitToken?: string }
): Promise<T> {
  const token = options?.explicitToken ?? (await authTokenProvider());
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let detail = 'Request failed';
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) detail = json.error;
    } catch {
      detail = await response.text().catch(() => 'Request failed');
    }
    throw new Error(`${detail} (HTTP ${response.status})`);
  }

  return (await response.json()) as T;
}

export const terraApiClient = {
  getAuthMe(explicitToken?: string): Promise<{
    uid: string;
    email: string;
    emailVerified: boolean;
    role: UserRole;
    status: 'Active' | 'Suspended';
    authMode: 'firebase' | 'demo';
  }> {
    return apiRequest('/api/auth/me', { explicitToken });
  },

  createDemoSession(role: UserRole): Promise<{
    token: string;
    role: UserRole;
    uid: string;
    authMode: 'demo';
  }> {
    return apiRequest('/api/auth/demo-session', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  },

  updateOwnProfile(patch: {
    fullName: string;
    department: string;
    districtScope: string;
    phone: string;
  }): Promise<{ ok: boolean }> {
    return apiRequest('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  getWorkspace(): Promise<TerraWorkspaceState> {
    return apiRequest<TerraWorkspaceState>('/api/workspace');
  },

  updatePothole(
    id: string,
    patch: Partial<Pick<PotholeRecord, 'status' | 'severity' | 'notes' | 'assignedWorkOrderId'>>
  ): Promise<PotholeRecord> {
    return apiRequest<PotholeRecord>(`/api/potholes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  recomputeHotspots(params: {
    epsMeters: number;
    minPts: number;
    h3Resolution: 8 | 9 | 10;
  }): Promise<{ clusters: DbscanCluster[]; h3Cells: H3HexCell[]; potholes: PotholeRecord[] }> {
    return apiRequest('/api/hotspots/recompute', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  createRepairOrder(
    payload: Omit<RepairWorkOrder, 'id' | 'createdAt' | 'completedAt' | 'dataSource'>
  ): Promise<{ order: RepairWorkOrder; potholes: PotholeRecord[] }> {
    return apiRequest('/api/repairs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateRepairOrder(
    id: string,
    patch: Partial<Pick<RepairWorkOrder, 'status' | 'assignedCrewId' | 'notes' | 'priority'>>
  ): Promise<{ order: RepairWorkOrder; potholes: PotholeRecord[] }> {
    return apiRequest(`/api/repairs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  updateAlertStatus(
    id: string,
    status: AlertRecord['status']
  ): Promise<AlertRecord> {
    return apiRequest<AlertRecord>(`/api/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  markAllAlertsAcknowledged(): Promise<AlertRecord[]> {
    return apiRequest<AlertRecord[]>('/api/alerts/acknowledge-all', {
      method: 'POST',
    });
  },

  triggerManualSos(payload: {
    deviceId: string;
    roadName: string;
    lat: number;
    lng: number;
    operatorName: string;
    message?: string;
  }): Promise<{ alert: AlertRecord; device: Esp32Device | null }> {
    return apiRequest('/api/alerts/sos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * In-app DEMO simulator endpoint (forces dataSource = 'SIMULATED_DEMO').
   * Real hardware ESP32 devices authenticate separately via POST /api/telemetry/ingest
   * with X-Device-API-Key.
   */
  ingestTelemetry(payload: TelemetryIngestPayload): Promise<{
    acceptedIntoPotholeWorkflow: boolean;
    reason: string;
    workspace: TerraWorkspaceState;
  }> {
    return apiRequest('/api/simulator/telemetry', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deviceAction(
    id: string,
    action: 'ping' | 'calibrate' | 'ota'
  ): Promise<Esp32Device> {
    return apiRequest<Esp32Device>(`/api/devices/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  registerDevice(payload: {
    id: string;
    vehicleLabel: string;
    mountType: Esp32Device['mountType'];
    district: string;
    firmwareVersion: string;
  }): Promise<Esp32Device> {
    return apiRequest<Esp32Device>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSettings(patch: Partial<SystemSettings>): Promise<{
    settings: SystemSettings;
    potholes: PotholeRecord[];
    clusters: DbscanCluster[];
    h3Cells: H3HexCell[];
  }> {
    return apiRequest('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  createUser(
    payload: Omit<MunicipalUser, 'id' | 'lastLogin'>
  ): Promise<MunicipalUser> {
    return apiRequest<MunicipalUser>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateUserRole(id: string, role: UserRole): Promise<MunicipalUser> {
    return apiRequest<MunicipalUser>(`/api/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  toggleUserStatus(id: string): Promise<MunicipalUser> {
    return apiRequest<MunicipalUser>(`/api/users/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH',
    });
  },
};
