
import type {
  PriorityEngineWeights,
  ScreenId,
  SystemSettings,
} from '../types/index.ts';
import { ESP32_DETECTIONS_ENDPOINT } from '../api/backendAdminApi.ts';

export interface NavItemConfig {
  id: ScreenId;
  label: string;
  shortLabel: string;
  section: 'Operations' | 'Intelligence' | 'System';
  description: string;
}

export const NAVIGATION_ITEMS: NavItemConfig[] = [
  {
    id: 'overview',
    label: 'Overview Dashboard',
    shortLabel: 'Overview',
    section: 'Operations',
    description: 'Municipal KPIs, triage queue, and sensor telemetry summary',
  },
  {
    id: 'map',
    label: 'Live Road Map',
    shortLabel: 'Road Map',
    section: 'Operations',
    description: 'Interactive Leaflet OSM GIS workspace with severity markers',
  },
  {
    id: 'potholes',
    label: 'Pothole Management',
    shortLabel: 'Potholes',
    section: 'Operations',
    description: 'Searchable pothole registry, verification status, and repair triage',
  },
  {
    id: 'hotspots',
    label: 'Hotspot Analysis',
    shortLabel: 'Hotspots',
    section: 'Intelligence',
    description: 'DBSCAN spatial clustering and H3 hexagonal hazard density',
  },
  {
    id: 'repairs',
    label: 'Repair Management',
    shortLabel: 'Repairs',
    section: 'Operations',
    description: 'Work orders, SLA tracking, and maintenance crew dispatch',
  },
  {
    id: 'alerts',
    label: 'Alerts & Notifications',
    shortLabel: 'Alerts',
    section: 'Operations',
    description: 'Independent physical SOS channel and automated hazard alerts',
  },
  {
    id: 'devices',
    label: 'ESP32 Devices',
    shortLabel: 'Devices',
    section: 'System',
    description: 'ESP32, MPU6050 vibration sensor, and GPS fleet diagnostics',
  },
  {
    id: 'analytics',
    label: 'Analytics & Reports',
    shortLabel: 'Analytics',
    section: 'Intelligence',
    description: 'Road health trends, IRI benchmarking, and CSV/JSON exports',
  },
  {
    id: 'settings',
    label: 'Settings & Users',
    shortLabel: 'Settings',
    section: 'System',
    description: 'RBAC users, priority engine weights, and integration readiness',
  },
];

export const DEFAULT_PRIORITY_WEIGHTS: PriorityEngineWeights = {
  severityWeight: 35,
  peakGWeight: 20,
  arterialWeight: 20,
  clusterDensityWeight: 15,
  ageWeight: 10,
};

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  demoModeEnabled: false,
  municipalityName: 'Metro Public Works Authority',
  coordinateReferenceLabel: 'WGS84 / OSM',
  mpu6050TriggerThresholdG: 2.1,
  mlConfidenceCutoffPct: 82,
  dbscanDefaultEpsMeters: 320,
  dbscanDefaultMinPts: 2,
  h3DefaultResolution: 9,
  slaCriticalHours: 24,
  slaHighHours: 72,
  priorityWeights: DEFAULT_PRIORITY_WEIGHTS,

  // Production Render backend
  esp32ApiEndpoint: ESP32_DETECTIONS_ENDPOINT,

  // Actual connection status must be determined dynamically.
  firebaseStatus: 'Checking Connection',
};

export const SUPPORTED_ROAD_CONDITIONS = ['Pothole'] as const;

export const SEVERITY_COLORS = {
  Critical: {
    hex: '#DC2626',
    bg: '#FEF2F2',
    border: '#FCA5A5',
    text: '#DC2626',
    tier: 'P1',
  },
  High: {
    hex: '#EA580C',
    bg: '#FFF7ED',
    border: '#FDBA74',
    text: '#EA580C',
    tier: 'P2',
  },
  Moderate: {
    hex: '#EAB308',
    bg: '#FEFCE8',
    border: '#FDE047',
    text: '#A16207',
    tier: 'P3',
  },
  Repaired: {
    hex: '#16A34A',
    bg: '#F0FDF4',
    border: '#86EFAC',
    text: '#16A34A',
    tier: 'OK',
  },
} as const;
