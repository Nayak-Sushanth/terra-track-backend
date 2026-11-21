export type ScreenId =
  | 'overview'
  | 'map'
  | 'potholes'
  | 'hotspots'
  | 'repairs'
  | 'alerts'
  | 'devices'
  | 'analytics'
  | 'settings';

export type RoadConditionClass = 'Pothole';

export type SeverityLevel = 'Critical' | 'High' | 'Moderate';

export type PotholeStatus =
  | 'Detected'
  | 'Verified'
  | 'Scheduled'
  | 'In Progress'
  | 'Repaired';

export type DataSourceType = 'SIMULATED_DEMO' | 'LIVE_ESP32';

export type RoadArterialClass = 'Arterial' | 'Collector' | 'Local' | 'Highway';

/**
 * Three authoritative TERRA Track municipal roles enforced by backend & Firestore rules.
 */
export type UserRole = 'Admin' | 'Municipal Officer' | 'Field Maintenance Team';

export interface SensorTelemetrySignature {
  peakAccelG: number | null; // MPU6050 Z-axis peak G-force / peakAcceleration
  rmsVibration: number | null; // RMS m/s^2 / vibrationLevel
  iriScore: number | null; // International Roughness Index (m/km)
  durationMs: number | null; // Impact pulse duration
  speedKmh: number | null; // Vehicle GPS speed at detection
  mlConfidence: number | null; // 0-100% sensor ML confidence
  waveformSample: number[]; // Compact Z-axis impulse trace (empty if unavailable)
  accelX?: number | null;
  accelY?: number | null;
  accelZ?: number | null;
  gyroX?: number | null;
  gyroY?: number | null;
  gyroZ?: number | null;
  sensorStatus?: string | null;
  gpsAltitude?: number | null;
  gpsAccuracy?: number | null;
  gpsSatellites?: number | null;
  gpsStatus?: string | null;
}

export interface PotholeRecord {
  id: string;
  eventId?: string | null;
  roadName: string | null;
  segmentCode: string | null;
  district: string | null;
  arterialClass: RoadArterialClass | null;
  lat: number | null;
  lng: number | null;
  hasReliableGps?: boolean;
  verified?: boolean | null;
  isVerifiedForMap?: boolean;
  h3Index: string | null;
  clusterId: string | null;
  classification: 'Pothole'; // Strictly only Pothole events enter this workflow
  severity: SeverityLevel | null;
  rawSeverity?: string | null;
  status: PotholeStatus | null;
  rawStatus?: string | null;
  priorityScore: number | null; // 0-100 computed by Priority Calculation Engine
  priorityTier: 'P1' | 'P2' | 'P3' | null;
  detectedAt: string | null; // ISO timestamp
  receivedAt?: string | null; // Backend receipt timestamp
  updatedAt: string | null;
  deviceId: string | null;
  telemetry: SensorTelemetrySignature;
  detectionCount: number | null; // Corroborating passes
  assignedWorkOrderId: string | null;
  notes: string | null;
  detectionSource?: string | null;
  dataSource: DataSourceType;
}


export interface DbscanCluster {
  id: string;
  name: string;
  district: string | null;
  centroidLat: number;
  centroidLng: number;
  radiusMeters: number;
  potholeIds: string[];
  potholeCount: number;
  criticalCount: number;
  avgIri: number | null;
  maxPeakG: number | null;
  priorityScore: number | null;
  riskTier: 'Critical' | 'High' | 'Moderate';
  hullPoints: Array<[number, number]>;
  dataSource: DataSourceType;
}

export interface H3HexCell {
  h3Index: string;
  resolution: 8 | 9 | 10;
  centerLat: number;
  centerLng: number;
  vertices: Array<[number, number]>;
  potholeCount: number;
  avgSeverityWeight: number | null;
  avgIri: number | null;
  compositePriority: number;
  district: string | null;
  potholeIds: string[];
}

export interface MunicipalZone {
  id: string;
  name: string;
  code: string;
  slaCriticalHours: number;
  slaHighHours: number;
  targetIriMax: number;
  roadKmMonitored: number;
  updatedAt: string;
}

export type WorkOrderStatus =
  | 'Queued'
  | 'Dispatched'
  | 'In Progress'
  | 'Verification'
  | 'Completed';

export interface MaintenanceCrew {
  id: string;
  name: string;
  leadEngineer: string;
  district: string;
  status: 'Available' | 'Dispatched' | 'On Site' | 'Off Shift';
  vehicleUnit: string;
  activeOrderCount: number | null;
  membersCount: number | null;
  contactRadio: string;
}

export interface RepairWorkOrder {
  id: string;
  title: string;
  roadName: string;
  district: string;
  potholeIds: string[];
  clusterId: string | null;
  priority: 'P1' | 'P2' | 'P3';
  status: WorkOrderStatus;
  assignedCrewId: string | null;
  createdAt: string | null;
  scheduledDate: string | null;
  slaDeadline: string | null;
  completedAt: string | null;
  estimatedAsphaltTons: number | null;
  estimatedCostUsd: number | null;
  notes: string;
  dataSource: DataSourceType;
}

export interface RepairHistoryRecord {
  id: string;
  taskId: string;
  previousStatus: WorkOrderStatus | 'Created';
  newStatus: WorkOrderStatus;
  actorUid: string;
  actorName: string;
  notes: string;
  postRepairIri?: number;
  createdAt: string;
}

export type AlertCategory =
  | 'MANUAL_SOS'
  | 'CRITICAL_POTHOLE'
  | 'HOTSPOT_THRESHOLD'
  | 'SLA_BREACH'
  | 'DEVICE_FAULT';

export type AlertStatus = 'Active' | 'Acknowledged' | 'Resolved';

export interface AlertRecord {
  id: string;
  eventId?: string | null;
  category: AlertCategory;
  isManualSos: boolean; // Independent physical SOS button event
  severity: 'Critical' | 'High' | 'Moderate' | 'Info' | null;
  title: string;
  message: string;
  timestamp: string | null;
  deviceId: string | null;
  potholeId: string | null;
  lat: number | null;
  lng: number | null;
  roadName: string | null;
  operatorName: string | null;
  status: AlertStatus;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  sourceCollection?: 'device_alerts' | 'potholes' | 'sos_alerts' | 'notifications' | 'demo';
  dataSource: DataSourceType;
}

export interface Esp32Device {
  id: string;
  vehicleLabel: string | null;
  mountType:
    | 'Municipal Patrol Van'
    | 'Public Transit Bus'
    | 'Road Inspection Truck'
    | 'Utility Fleet'
    | null;
  district: string | null;
  status: 'Online' | 'Degraded' | 'Offline' | null;
  rawStatus?: string | null;
  firmwareVersion: string | null;
  mpu6050Status: 'Calibrated' | 'Drift Warning' | 'Fault' | null;
  rawMpu6050Status?: string | null;
  gpsFix: '3D Fix' | '2D Fix' | 'No Fix' | null;
  rawGpsStatus?: string | null;
  satellites: number | null;
  batteryVoltage: number | null; // 12V vehicle rail or LiPo backup
  signalRssi: number | null; // dBm
  packetsToday: number | null;
  potholesDetectedToday: number | null;
  detectionCount?: number | null;
  deviceUptimeSec?: number | null;
  gpsAltitude?: number | null;
  gpsAccuracy?: number | null;
  lastHeartbeat: string | null;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  manualSosButtonState: 'Armed' | 'Triggered' | null;
  recentAccelSamples: Array<{ t: string; ax: number; ay: number; az: number }>;
  healthWarnings?: string[];
  dataSource: DataSourceType;
}

export interface MunicipalUser {
  id: string;
  uid?: string;
  fullName: string;
  email: string;
  role: UserRole;
  department: string;
  districtScope: string;
  phone?: string;
  status: 'Active' | 'Suspended';
  lastLogin: string;
}

export interface AuthenticatedSession {
  mode: 'firebase' | 'demo';
  uid: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  role: UserRole;
  department: string;
  districtScope: string;
  phone: string;
  status: 'Active' | 'Suspended';
}

export interface PriorityEngineWeights {
  severityWeight: number; // %
  peakGWeight: number; // %
  arterialWeight: number; // %
  clusterDensityWeight: number; // %
  ageWeight: number; // %
}

export interface SystemSettings {
  demoModeEnabled: boolean;
  municipalityName: string;
  coordinateReferenceLabel: string;
  mpu6050TriggerThresholdG: number;
  mlConfidenceCutoffPct: number;
  dbscanDefaultEpsMeters: number;
  dbscanDefaultMinPts: number;
  h3DefaultResolution: 8 | 9 | 10;
  slaCriticalHours: number;
  slaHighHours: number;
  priorityWeights: PriorityEngineWeights;
  esp32ApiEndpoint: string;
  firebaseStatus: string;
}

export interface TelemetryIngestPayload {
  deviceId: string;
  roadName: string;
  district: string;
  arterialClass: RoadArterialClass;
  lat: number;
  lng: number;
  condition: RoadConditionClass;
  peakAccelG: number;
  rmsVibration: number;
  iriScore: number;
  speedKmh: number;
  mlConfidence: number;
  manualSos?: boolean;
  operatorName?: string;
  dataSource?: DataSourceType;
}

export interface LiveDashboardMetrics {
  totalPotholeDetections: number;
  totalVerifiedPotholes: number;
  notVerifiedPotholesCount: number;
  unknownVerificationCount: number;
  reliableGpsPotholesCount: number;
  unreliableGpsPotholesCount: number;
  criticalPotholesCount: number;
  highPotholesCount: number;
  moderatePotholesCount: number;
  repairedPotholesCount: number;
  activeDevices: number;
  totalDevices: number;
  deviceHealthWarnings: number;
  unresolvedAlerts: number;
}

export type DatabaseConnectionStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'PERMISSION_ERROR'
  | 'ERROR';

export interface CollectionSubscriptionDiag {
  name: string;
  required: boolean;
  status: 'connecting' | 'connected' | 'permission-denied' | 'offline' | 'error';
  docCount: number;
  fromCache: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
}

export interface LiveCollectionSyncState {
  connectionStatus: DatabaseConnectionStatus;
  loading: boolean;
  ready: boolean;
  isOffline?: boolean;
  fromCache?: boolean;
  projectId: string;
  databaseId: string;
  lastError: string | null;
  errors: Record<string, string>;
  collections: Record<string, CollectionSubscriptionDiag>;
  lastSyncedAt: string | null;
}

export interface TerraWorkspaceState {
  potholes: PotholeRecord[];
  clusters: DbscanCluster[];
  h3Cells: H3HexCell[];
  zones: MunicipalZone[];
  repairs: RepairWorkOrder[];
  repairHistory: RepairHistoryRecord[];
  crews: MaintenanceCrew[];
  alerts: AlertRecord[];
  devices: Esp32Device[];
  users: MunicipalUser[];
  settings: SystemSettings;
  liveMetrics?: LiveDashboardMetrics;
  isLiveFirestore?: boolean;
}
