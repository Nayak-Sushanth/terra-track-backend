import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  ensureFirebaseInitialized,
  FIRESTORE_COLLECTIONS,
  OperationType,
} from '../config/firebase';
import { ESP32_DETECTIONS_ENDPOINT } from '../api/backendAdminApi';
import { DEFAULT_PRIORITY_WEIGHTS } from '../config/appConfig';
import { generateH3HexGrid, runDbscanClustering } from '../utilities/spatialEngine';
import { calculatePotholePriority } from '../utilities/priorityEngine';
import type {
  AlertCategory,
  AlertRecord,
  AlertStatus,
  CollectionSubscriptionDiag,
  DatabaseConnectionStatus,
  DataSourceType,
  Esp32Device,
  LiveCollectionSyncState,
  LiveDashboardMetrics,
  MaintenanceCrew,
  MunicipalUser,
  MunicipalZone,
  PotholeRecord,
  PotholeStatus,
  RepairHistoryRecord,
  RepairWorkOrder,
  RoadArterialClass,
  SeverityLevel,
  TerraWorkspaceState,
  WorkOrderStatus,
} from '../types';

export interface RawFirestoreDoc {
  id: string;
  data: DocumentData;
}

export interface LiveFirestoreSnapshotBundle {
  sensorDetections: RawFirestoreDoc[];
  potholes: RawFirestoreDoc[];
  devices: RawFirestoreDoc[];
  deviceAlerts: RawFirestoreDoc[];
  sosAlerts?: RawFirestoreDoc[];
  repairTasks?: RawFirestoreDoc[];
  repairHistory?: RawFirestoreDoc[];
  maintenanceTeams?: RawFirestoreDoc[];
  municipalZones?: RawFirestoreDoc[];
  users?: RawFirestoreDoc[];
}

export interface MappedSensorDetection {
  docId: string;
  eventKey: string;
  eventId: string | null;
  deviceId: string | null;
  classification: 'Pothole';
  rawClassification: string;
  severity: SeverityLevel | null;
  confidence: number | null;
  lat: number | null;
  lng: number | null;
  hasReliableGps: boolean;
  detectedAt: string | null;
  peakAccelG: number | null;
  rmsVibration: number | null;
  iriScore: number | null;
  speedKmh: number | null;
  roadName: string | null;
  detectionSource: string | null;
}

// ============================================================================
// Pure Field Extractors (Strict Null Preservation — Zero Fabricated Defaults)
// ============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getCandidateContainers(
  data: Record<string, unknown>,
  nestedKeys: string[] = []
): Record<string, unknown>[] {
  const containers: Record<string, unknown>[] = [data];
  for (const key of nestedKeys) {
    const nested = asRecord(data[key]);
    if (nested) containers.push(nested);
  }
  return containers;
}

export function pickString(
  data: Record<string, unknown>,
  keys: string[],
  nestedKeys: string[] = []
): string | null {
  const containers = getCandidateContainers(data, nestedKeys);
  for (const container of containers) {
    for (const key of keys) {
      const val = container[key];
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (
          trimmed &&
          trimmed.toLowerCase() !== 'null' &&
          trimmed.toLowerCase() !== 'undefined'
        ) {
          return trimmed;
        }
      }
    }
  }
  return null;
}

export function pickNumber(
  data: Record<string, unknown>,
  keys: string[],
  nestedKeys: string[] = []
): number | null {
  const containers = getCandidateContainers(data, nestedKeys);
  for (const container of containers) {
    for (const key of keys) {
      const val = container[key];
      if (typeof val === 'number' && Number.isFinite(val)) {
        return val;
      }
      if (typeof val === 'string' && val.trim() !== '') {
        const parsed = Number(val);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }
  return null;
}

export function pickBoolean(
  data: Record<string, unknown>,
  keys: string[],
  nestedKeys: string[] = []
): boolean | null {
  const containers = getCandidateContainers(data, nestedKeys);
  for (const container of containers) {
    for (const key of keys) {
      const val = container[key];
      if (typeof val === 'boolean') return val;
    }
  }
  return null;
}

export function pickIsoTimestamp(
  data: Record<string, unknown>,
  keys: string[],
  nestedKeys: string[] = []
): string | null {
  const containers = getCandidateContainers(data, nestedKeys);
  for (const container of containers) {
    for (const key of keys) {
      const val = container[key];
      if (val === null || val === undefined) continue;

      if (val instanceof Timestamp) {
        return val.toDate().toISOString();
      }
      if (val instanceof Date && !Number.isNaN(val.getTime())) {
        return val.toISOString();
      }
      if (typeof val === 'object') {
        const rec = val as Record<string, unknown>;
        if (typeof rec.toDate === 'function') {
          try {
            const dt = (rec.toDate as () => Date)();
            if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
              return dt.toISOString();
            }
          } catch {
            // ignore
          }
        }
        const secs =
          typeof rec.seconds === 'number'
            ? rec.seconds
            : typeof rec._seconds === 'number'
              ? rec._seconds
              : null;
        if (secs !== null && Number.isFinite(secs)) {
          const nanos =
            typeof rec.nanoseconds === 'number'
              ? rec.nanoseconds
              : typeof rec._nanoseconds === 'number'
                ? rec._nanoseconds
                : 0;
          return new Date(secs * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
        }
      }
      if (typeof val === 'number' && Number.isFinite(val)) {
        const ms = val > 1e12 ? val : val * 1000;
        const dt = new Date(ms);
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      }
      if (typeof val === 'string' && val.trim()) {
        const dt = new Date(val.trim());
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      }
    }
  }
  return null;
}

function normalizeConfidence(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  if (raw >= 0 && raw <= 1) {
    return Number((raw * 100).toFixed(1));
  }
  if (raw > 1 && raw <= 100) {
    return Number(raw.toFixed(1));
  }
  return null;
}

/**
 * Strictly validates that a detection classification is POTHOLE.
 * Non-pothole records (e.g. smooth, uneven, speed bump) are never admitted.
 */
export function isStrictPotholeClassification(raw: string | null): boolean {
  if (!raw) return false;
  return raw.trim().toUpperCase() === 'POTHOLE';
}

export function normalizeSeverity(raw: string | null): SeverityLevel | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'critical' || cleaned === 'severe' || cleaned === 'p1' || cleaned === 'very high') {
    return 'Critical';
  }
  if (cleaned === 'high' || cleaned === 'major' || cleaned === 'p2') {
    return 'High';
  }
  if (
    cleaned === 'moderate' ||
    cleaned === 'medium' ||
    cleaned === 'low' ||
    cleaned === 'minor' ||
    cleaned === 'p3'
  ) {
    return 'Moderate';
  }
  return null;
}

export function normalizePotholeStatus(raw: string | null): PotholeStatus | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (cleaned === 'detected' || cleaned === 'new' || cleaned === 'open' || cleaned === 'reported' || cleaned === 'pending') {
    return 'Detected';
  }
  if (cleaned === 'verified' || cleaned === 'confirmed' || cleaned === 'eligible') {
    return 'Verified';
  }
  if (cleaned === 'scheduled' || cleaned === 'assigned' || cleaned === 'dispatched') {
    return 'Scheduled';
  }
  if (cleaned === 'in progress' || cleaned === 'repairing' || cleaned === 'under repair') {
    return 'In Progress';
  }
  if (cleaned === 'repaired' || cleaned === 'resolved' || cleaned === 'fixed' || cleaned === 'completed' || cleaned === 'closed') {
    return 'Repaired';
  }
  return null;
}

function normalizeArterialClass(raw: string | null): RoadArterialClass | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'highway') return 'Highway';
  if (cleaned === 'arterial') return 'Arterial';
  if (cleaned === 'collector') return 'Collector';
  if (cleaned === 'local') return 'Local';
  return null;
}

function isDisconnectedOrFaultStatus(raw: string | null): boolean {
  if (!raw) return false;
  const c = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return (
    c.includes('disconnect') ||
    c.includes('no fix') ||
    c.includes('nofix') ||
    c.includes('fault') ||
    c.includes('error') ||
    c.includes('offline') ||
    c.includes('fail') ||
    c.includes('lost') ||
    c.includes('unavailable') ||
    c.includes('invalid') ||
    c === 'false' ||
    c === '0'
  );
}

export function extractReliableCoordinates(data: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
  hasReliableGps: boolean;
  altitude: number | null;
  accuracy: number | null;
  satellites: number | null;
  speed: number | null;
  gpsStatus: string | null;
} {
  const gpsMap = asRecord(data.gps);
  const locationMap = asRecord(data.location);

  const lat = pickNumber(
    data,
    ['latitude', 'lat'],
    ['gps', 'location', 'coordinates', 'geo', 'position']
  );
  const lng = pickNumber(
    data,
    ['longitude', 'lng', 'lon'],
    ['gps', 'location', 'coordinates', 'geo', 'position']
  );
  const altitude = pickNumber(
    data,
    ['altitude', 'alt', 'gps_altitude', 'gpsAltitude'],
    ['gps', 'location', 'position', 'telemetry']
  );
  const accuracy = pickNumber(
    data,
    ['accuracy', 'gps_accuracy', 'gpsAccuracy', 'hdop'],
    ['gps', 'location', 'position', 'telemetry']
  );
  const satellites = pickNumber(
    data,
    ['satellites', 'gps_satellites', 'gpsSatellites', 'sat_count', 'satCount'],
    ['gps', 'location', 'telemetry']
  );
  const speed = pickNumber(
    data,
    ['speed_kmh', 'speedKmh', 'speed'],
    ['gps', 'telemetry', 'location']
  );

  const gpsFlag = pickBoolean(
    data,
    [
      'locationReliable',
      'location_reliable',
      'gps_valid',
      'gpsValid',
      'has_reliable_gps',
      'hasReliableGps',
      'reliable_gps',
      'reliableGps',
      'coordinates_valid',
      'coordinatesValid',
      'gps_fix_valid',
      'gpsFixValid',
      'gps_connected',
      'gpsConnected',
    ],
    ['metadata', 'backendMetadata', 'backend_metadata', 'gps', 'location', 'health', 'sensor_status', 'sensorStatus']
  );

  const nestedGpsStatus = gpsMap ? pickString(gpsMap, ['status', 'fix', 'state']) : null;
  const nestedLocStatus = locationMap ? pickString(locationMap, ['status', 'state']) : null;
  const gpsStatusStr =
    nestedGpsStatus ??
    pickString(
      data,
      ['gps_status', 'gpsStatus', 'gps_fix', 'gpsFix', 'location_status', 'locationStatus'],
      ['gps', 'location', 'health', 'metadata', 'backendMetadata']
    ) ??
    nestedLocStatus;

  const coordsInBounds =
    lat !== null &&
    lng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0);

  if (!coordsInBounds) {
    return {
      lat: null,
      lng: null,
      hasReliableGps: false,
      altitude,
      accuracy,
      satellites,
      speed,
      gpsStatus: gpsStatusStr,
    };
  }

  if (gpsFlag === false || isDisconnectedOrFaultStatus(gpsStatusStr)) {
    return {
      lat: null,
      lng: null,
      hasReliableGps: false,
      altitude,
      accuracy,
      satellites,
      speed,
      gpsStatus: gpsStatusStr,
    };
  }

  return {
    lat,
    lng,
    hasReliableGps: true,
    altitude,
    accuracy,
    satellites,
    speed,
    gpsStatus: gpsStatusStr,
  };
}

function canonicalEventKey(eventId: string | null, docId: string): string {
  return (eventId && eventId.trim()) || docId.trim();
}

// ============================================================================
// Collection Mappers (Pothole-Only Live Firestore Collections — Nested & Flat)
// ============================================================================

export function mapSensorDetectionDoc(
  docId: string,
  data: DocumentData
): MappedSensorDetection | null {
  const rec = (data || {}) as Record<string, unknown>;
  const rawClassification = pickString(
    rec,
    [
      'classification',
      'road_condition',
      'roadCondition',
      'predicted_class',
      'predictedClass',
      'condition',
      'label',
      'detection_type',
      'detectionType',
      'event_type',
      'eventType',
      'class',
    ],
    ['detection', 'prediction', 'ml']
  );

  // Strict pothole-only gate: ignore any sensor_detections record whose classification is not POTHOLE
  if (!rawClassification || !isStrictPotholeClassification(rawClassification)) {
    return null;
  }

  const eventId = pickString(
    rec,
    ['eventId', 'event_id', 'detectionId', 'detection_id'],
    ['detection', 'metadata', 'backendMetadata']
  );
  const { lat, lng, hasReliableGps, speed } = extractReliableCoordinates(rec);

  return {
    docId,
    eventKey: canonicalEventKey(eventId, docId),
    eventId: eventId ?? docId,
    deviceId: pickString(
      rec,
      ['deviceId', 'device_id', 'esp32Id', 'esp32_id'],
      ['device', 'metadata']
    ),
    classification: 'Pothole',
    rawClassification,
    severity: normalizeSeverity(
      pickString(rec, ['severity', 'severity_level', 'severityLevel'], ['detection'])
    ),
    confidence: normalizeConfidence(
      pickNumber(
        rec,
        ['confidence', 'ml_confidence', 'mlConfidence', 'confidence_score', 'confidenceScore'],
        ['detection', 'telemetry', 'ml', 'prediction', 'sensor']
      )
    ),
    lat,
    lng,
    hasReliableGps,
    detectedAt: pickIsoTimestamp(
      rec,
      [
        'timestamp',
        'detectedAt',
        'detected_at',
        'eventTimestamp',
        'event_timestamp',
        'receivedAt',
        'received_at',
        'createdAt',
        'created_at',
      ],
      ['detection', 'metadata', 'backendMetadata']
    ),
    peakAccelG: pickNumber(
      rec,
      [
        'peakAcceleration',
        'peak_acceleration',
        'peak_accel_g',
        'peakAccelG',
        'peak_g',
        'peakG',
        'max_accel_g',
        'z_peak',
        'accelZ',
        'accel_z',
      ],
      ['sensor', 'telemetry', 'sensor_data', 'sensorData', 'mpu6050']
    ),
    rmsVibration: pickNumber(
      rec,
      ['vibrationLevel', 'vibration_level', 'rms_vibration', 'rmsVibration', 'vibration_rms', 'rms'],
      ['sensor', 'telemetry', 'sensor_data', 'sensorData', 'mpu6050']
    ),
    iriScore: pickNumber(
      rec,
      ['iri_score', 'iriScore', 'iri'],
      ['sensor', 'telemetry', 'sensor_data', 'sensorData']
    ),
    speedKmh: speed,
    roadName: pickString(
      rec,
      ['road_name', 'roadName', 'location_name', 'locationName', 'address', 'street', 'corridor'],
      ['location', 'gps']
    ),
    detectionSource: pickString(
      rec,
      ['detection_source', 'detectionSource', 'source', 'data_source', 'dataSource', 'origin'],
      ['metadata', 'backendMetadata', 'detection']
    ),
  };
}

export function mapPotholeDoc(docId: string, data: DocumentData): PotholeRecord | null {
  const rec = (data || {}) as Record<string, unknown>;
  const rawClassification = pickString(
    rec,
    [
      'classification',
      'road_condition',
      'roadCondition',
      'predicted_class',
      'predictedClass',
      'condition',
      'label',
      'detection_type',
      'detectionType',
      'event_type',
      'eventType',
      'class',
    ],
    ['detection', 'prediction', 'ml']
  );

  // If a classification field is present on a potholes document, strictly require POTHOLE
  if (rawClassification !== null && !isStrictPotholeClassification(rawClassification)) {
    return null;
  }

  const sensorMap = asRecord(rec.sensor);
  const eventId = pickString(
    rec,
    ['eventId', 'event_id', 'sourceEventId', 'source_event_id'],
    ['detection', 'metadata', 'backendMetadata']
  );
  const {
    lat,
    lng,
    hasReliableGps,
    altitude: gpsAltitude,
    accuracy: gpsAccuracy,
    satellites: gpsSatellites,
    speed: speedKmh,
    gpsStatus,
  } = extractReliableCoordinates(rec);

  const rawSeverity = pickString(
    rec,
    ['severity', 'severity_level', 'severityLevel'],
    ['detection']
  );
  const severity = normalizeSeverity(rawSeverity);

  const rawStatus = pickString(
    rec,
    ['repair_status', 'repairStatus', 'status', 'lifecycle_status', 'lifecycleStatus'],
    ['detection']
  );
  const status = normalizePotholeStatus(rawStatus);

  const roadName = pickString(
    rec,
    ['road_name', 'roadName', 'location_name', 'locationName', 'address', 'corridor', 'street'],
    ['location', 'gps']
  );
  const district = pickString(
    rec,
    ['district', 'ward', 'zone', 'locality', 'area', 'city'],
    ['location', 'gps']
  );
  const segmentCode = pickString(rec, ['segment_code', 'segmentCode', 'segment']);
  const arterialClass = normalizeArterialClass(
    pickString(rec, ['arterial_class', 'arterialClass', 'road_class', 'roadClass'])
  );

  const accelX = pickNumber(rec, ['accelX', 'accel_x', 'ax'], ['sensor', 'telemetry', 'mpu6050']);
  const accelY = pickNumber(rec, ['accelY', 'accel_y', 'ay'], ['sensor', 'telemetry', 'mpu6050']);
  const accelZ = pickNumber(rec, ['accelZ', 'accel_z', 'az'], ['sensor', 'telemetry', 'mpu6050']);
  const gyroX = pickNumber(rec, ['gyroX', 'gyro_x', 'gx'], ['sensor', 'telemetry', 'mpu6050']);
  const gyroY = pickNumber(rec, ['gyroY', 'gyro_y', 'gy'], ['sensor', 'telemetry', 'mpu6050']);
  const gyroZ = pickNumber(rec, ['gyroZ', 'gyro_z', 'gz'], ['sensor', 'telemetry', 'mpu6050']);
  const sensorStatus =
    (sensorMap ? pickString(sensorMap, ['status', 'state']) : null) ??
    pickString(rec, ['sensorStatus', 'sensor_status', 'mpu6050Status', 'mpu6050_status'], ['telemetry', 'mpu6050']);

  const peakAccelG = pickNumber(
    rec,
    [
      'peakAcceleration',
      'peak_acceleration',
      'peak_accel_g',
      'peakAccelG',
      'peak_g',
      'peakG',
      'max_accel_g',
      'z_peak',
      'accelZ',
      'accel_z',
    ],
    ['sensor', 'telemetry', 'sensor_data', 'sensorData', 'mpu6050']
  );
  const rmsVibration = pickNumber(
    rec,
    ['vibrationLevel', 'vibration_level', 'rms_vibration', 'rmsVibration', 'vibration_rms', 'rms'],
    ['sensor', 'telemetry', 'sensor_data', 'sensorData', 'mpu6050']
  );
  const iriScore = pickNumber(
    rec,
    ['iri_score', 'iriScore', 'iri'],
    ['sensor', 'telemetry', 'sensor_data', 'sensorData']
  );
  const durationMs = pickNumber(
    rec,
    ['duration_ms', 'durationMs'],
    ['sensor', 'telemetry', 'sensor_data', 'sensorData']
  );
  const mlConfidence = normalizeConfidence(
    pickNumber(
      rec,
      ['confidence', 'ml_confidence', 'mlConfidence', 'confidence_score', 'confidenceScore'],
      ['detection', 'telemetry', 'ml', 'prediction', 'sensor']
    )
  );

  const rawWaveform =
    asRecord(rec.telemetry)?.waveformSample ??
    asRecord(rec.sensor)?.waveformSample ??
    rec.waveformSample ??
    rec.waveform_sample;
  const waveformSample = Array.isArray(rawWaveform)
    ? rawWaveform.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : [];

  const receivedAt = pickIsoTimestamp(
    rec,
    ['receivedAt', 'received_at'],
    ['metadata', 'backendMetadata', 'backend_metadata']
  );
  const detectedAt =
    pickIsoTimestamp(
      rec,
      [
        'timestamp',
        'detectedAt',
        'detected_at',
        'detectionDate',
        'detection_date',
        'eventTimestamp',
        'event_timestamp',
        'createdAt',
        'created_at',
      ],
      ['detection', 'metadata', 'backendMetadata']
    ) ?? receivedAt;
  const updatedAt = pickIsoTimestamp(rec, ['updatedAt', 'updated_at']) ?? detectedAt;

  const storedPriorityScore = pickNumber(rec, ['priority_score', 'priorityScore']);
  let priorityScore: number | null = storedPriorityScore;
  let priorityTier: 'P1' | 'P2' | 'P3' | null = null;

  const rawTier = pickString(rec, ['priority_tier', 'priorityTier']);
  if (rawTier === 'P1' || rawTier === 'P2' || rawTier === 'P3') {
    priorityTier = rawTier;
  }

  if (priorityScore === null && (severity !== null || peakAccelG !== null)) {
    const computed = calculatePotholePriority(
      {
        severity,
        peakAccelG,
        arterialClass,
        clusterNeighborCount: 1,
        detectedAt,
      },
      DEFAULT_PRIORITY_WEIGHTS
    );
    priorityScore = computed.totalScore;
    priorityTier = priorityTier ?? computed.tier;
  } else if (priorityScore !== null && !priorityTier) {
    priorityTier = priorityScore >= 78 ? 'P1' : priorityScore >= 55 ? 'P2' : 'P3';
  }

  const detectionSource = pickString(
    rec,
    ['detection_source', 'detectionSource', 'source', 'data_source', 'dataSource', 'origin'],
    ['metadata', 'backendMetadata', 'detection']
  );

  const dataSource: DataSourceType =
    detectionSource?.toUpperCase().includes('DEMO') ||
    detectionSource?.toUpperCase().includes('SIMULATED')
      ? 'SIMULATED_DEMO'
      : 'LIVE_ESP32';

  // Strictly read ONLY the actual Firestore `verified` boolean.
  // Never infer verification from confidence, severity, status, or classification.
  // Map display depends solely on valid GPS coordinates, never verification status.
  const verified: boolean | null = pickBoolean(
    rec,
    ['verified'],
    ['detection', 'metadata', 'backendMetadata']
  );

  return {
    id: pickString(rec, ['pothole_id', 'potholeId', 'id']) ?? docId,
    eventId,
    roadName,
    segmentCode,
    district,
    arterialClass,
    lat,
    lng,
    hasReliableGps,
    verified,
    h3Index: pickString(rec, ['h3_index', 'h3Index']),
    clusterId: pickString(rec, ['cluster_id', 'clusterId']),
    classification: 'Pothole',
    severity,
    rawSeverity,
    status,
    rawStatus,
    priorityScore,
    priorityTier,
    detectedAt,
    receivedAt,
    updatedAt,
    deviceId: pickString(
      rec,
      ['deviceId', 'device_id', 'esp32Id', 'esp32_id'],
      ['device', 'metadata']
    ),
    telemetry: {
      peakAccelG,
      rmsVibration,
      iriScore,
      durationMs,
      speedKmh,
      mlConfidence,
      waveformSample,
      accelX,
      accelY,
      accelZ,
      gyroX,
      gyroY,
      gyroZ,
      sensorStatus,
      gpsAltitude,
      gpsAccuracy,
      gpsSatellites,
      gpsStatus,
    },
    detectionCount: pickNumber(
      rec,
      ['detectionCount', 'detection_count', 'passes', 'occurrences'],
      ['device', 'detection', 'metadata']
    ),
    assignedWorkOrderId: pickString(rec, [
      'assigned_work_order_id',
      'assignedWorkOrderId',
      'work_order_id',
      'workOrderId',
    ]),
    notes: pickString(rec, ['notes', 'remarks', 'description']),
    detectionSource,
    dataSource,
  };
}


function normalizeDeviceStatus(raw: string | null): Esp32Device['status'] {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (c === 'online' || c === 'active' || c === 'connected' || c === 'healthy' || c === 'ok') {
    return 'Online';
  }
  if (c === 'degraded' || c === 'warning' || c === 'partial' || c === 'unstable') {
    return 'Degraded';
  }
  if (c === 'offline' || c === 'inactive' || c === 'disconnected' || c === 'fault' || c === 'error') {
    return 'Offline';
  }
  return null;
}

function normalizeGpsStatus(
  rawStr: string | null,
  rawBool: boolean | null
): { gpsFix: Esp32Device['gpsFix']; rawGpsStatus: string | null; isDisconnected: boolean } {
  if (rawStr) {
    const c = rawStr.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (isDisconnectedOrFaultStatus(rawStr)) {
      return { gpsFix: 'No Fix', rawGpsStatus: rawStr, isDisconnected: true };
    }
    if (
      c.includes('3d') ||
      c === 'connected' ||
      c === 'ok' ||
      c === 'active' ||
      c === 'locked' ||
      c === 'fixed' ||
      c === 'healthy' ||
      c === 'online' ||
      c === 'valid'
    ) {
      return { gpsFix: '3D Fix', rawGpsStatus: rawStr, isDisconnected: false };
    }
    if (c.includes('2d')) {
      return { gpsFix: '2D Fix', rawGpsStatus: rawStr, isDisconnected: false };
    }
    return { gpsFix: null, rawGpsStatus: rawStr, isDisconnected: false };
  }

  if (rawBool === true) {
    return { gpsFix: '3D Fix', rawGpsStatus: 'Connected', isDisconnected: false };
  }
  if (rawBool === false) {
    return { gpsFix: 'No Fix', rawGpsStatus: 'Disconnected', isDisconnected: true };
  }
  return { gpsFix: null, rawGpsStatus: null, isDisconnected: false };
}

function normalizeMpuStatus(
  rawStr: string | null,
  rawBool: boolean | null
): { mpu6050Status: Esp32Device['mpu6050Status']; rawMpu6050Status: string | null; isDisconnected: boolean } {
  if (rawStr) {
    const c = rawStr.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (isDisconnectedOrFaultStatus(rawStr)) {
      return { mpu6050Status: 'Fault', rawMpu6050Status: rawStr, isDisconnected: true };
    }
    if (c.includes('drift') || c.includes('warn') || c.includes('degraded')) {
      return { mpu6050Status: 'Drift Warning', rawMpu6050Status: rawStr, isDisconnected: true };
    }
    if (c === 'calibrated' || c === 'connected' || c === 'ok' || c === 'active' || c === 'healthy' || c === 'online') {
      return { mpu6050Status: 'Calibrated', rawMpu6050Status: rawStr, isDisconnected: false };
    }
    return { mpu6050Status: null, rawMpu6050Status: rawStr, isDisconnected: false };
  }

  if (rawBool === true) {
    return { mpu6050Status: 'Calibrated', rawMpu6050Status: 'Connected', isDisconnected: false };
  }
  if (rawBool === false) {
    return { mpu6050Status: 'Fault', rawMpu6050Status: 'Disconnected', isDisconnected: true };
  }
  return { mpu6050Status: null, rawMpu6050Status: null, isDisconnected: false };
}

export function mapDeviceDoc(docId: string, data: DocumentData): Esp32Device {
  const rec = (data || {}) as Record<string, unknown>;
  const gpsMap = asRecord(rec.gps);
  const sensorMap = asRecord(rec.sensor);
  const mpuMap = asRecord(rec.mpu6050);
  const deviceId = pickString(rec, ['deviceId', 'device_id', 'id'], ['device']) ?? docId;

  const rawStatus = pickString(
    rec,
    ['device_status', 'deviceStatus', 'status', 'connection_status', 'connectionStatus', 'state'],
    ['device']
  );
  const status = normalizeDeviceStatus(rawStatus);

  const rawGpsStr =
    (gpsMap ? pickString(gpsMap, ['status', 'fix', 'state']) : null) ??
    pickString(
      rec,
      ['gps_status', 'gpsStatus', 'gps_fix', 'gpsFix', 'gnss_status', 'gnssStatus'],
      ['health', 'sensors', 'sensor_status', 'sensorStatus', 'gps']
    );
  const rawGpsBool = pickBoolean(
    rec,
    ['gps_connected', 'gpsConnected', 'gps_ok', 'gpsOk', 'gps_active', 'gpsActive', 'locationReliable', 'location_reliable'],
    ['health', 'sensors', 'sensor_status', 'sensorStatus', 'gps']
  );
  const gps = normalizeGpsStatus(rawGpsStr, rawGpsBool);

  const rawMpuStr =
    (sensorMap ? pickString(sensorMap, ['status', 'state']) : null) ??
    (mpuMap ? pickString(mpuMap, ['status', 'state']) : null) ??
    pickString(
      rec,
      ['mpu6050_status', 'mpu6050Status', 'mpu_status', 'mpuStatus', 'imu_status', 'imuStatus', 'sensor_status', 'sensorStatus'],
      ['health', 'sensors', 'sensor', 'sensor_status', 'sensorStatus', 'mpu6050']
    );
  const rawMpuBool = pickBoolean(
    rec,
    ['mpu6050_connected', 'mpu6050Connected', 'mpu_connected', 'mpuConnected', 'mpu6050_ok', 'mpu6050Ok', 'imu_connected'],
    ['health', 'sensors', 'sensor', 'sensor_status', 'sensorStatus', 'mpu6050']
  );
  const mpu = normalizeMpuStatus(rawMpuStr, rawMpuBool);

  const batteryVoltage = pickNumber(
    rec,
    ['batteryVoltage', 'battery_voltage', 'battery_v', 'batteryV', 'voltage'],
    ['device', 'health', 'power', 'telemetry']
  );

  const { lat, lng, altitude: gpsAltitude, accuracy: gpsAccuracy, satellites, speed } =
    extractReliableCoordinates(rec);

  const healthWarnings: string[] = [];
  if (gps.isDisconnected) {
    healthWarnings.push(
      `GPS Disconnected / No Fix (${gps.rawGpsStatus ?? 'Unavailable'})`
    );
  }
  if (mpu.isDisconnected) {
    healthWarnings.push(
      `MPU6050 Sensor Disconnected / Fault (${mpu.rawMpu6050Status ?? 'Fault'})`
    );
  }
  if (batteryVoltage !== null && batteryVoltage > 0 && batteryVoltage < 3.4) {
    healthWarnings.push(`Low Battery Voltage (${batteryVoltage.toFixed(2)} V)`);
  }

  const rawMount = pickString(rec, ['mount_type', 'mountType', 'vehicle_type', 'vehicleType'], ['device']);
  const mountType: Esp32Device['mountType'] =
    rawMount === 'Municipal Patrol Van' ||
    rawMount === 'Public Transit Bus' ||
    rawMount === 'Road Inspection Truck' ||
    rawMount === 'Utility Fleet'
      ? rawMount
      : null;

  const rawSos = pickString(rec, ['manual_sos_button_state', 'manualSosButtonState', 'sos_state', 'sosState']);
  const manualSosButtonState: Esp32Device['manualSosButtonState'] =
    rawSos?.toLowerCase() === 'triggered'
      ? 'Triggered'
      : rawSos?.toLowerCase() === 'armed'
        ? 'Armed'
        : null;

  const rawSamples = rec.recentAccelSamples ?? rec.recent_accel_samples;
  const recentAccelSamples = Array.isArray(rawSamples)
    ? rawSamples.filter(
        (s): s is { t: string; ax: number; ay: number; az: number } =>
          Boolean(
            s &&
              typeof s === 'object' &&
              typeof (s as Record<string, unknown>).t === 'string' &&
              typeof (s as Record<string, unknown>).ax === 'number' &&
              typeof (s as Record<string, unknown>).ay === 'number' &&
              typeof (s as Record<string, unknown>).az === 'number'
          )
      )
    : [];

  return {
    id: deviceId,
    vehicleLabel: pickString(
      rec,
      ['vehicle_label', 'vehicleLabel', 'name', 'device_name', 'deviceName', 'label'],
      ['device']
    ),
    mountType,
    district: pickString(rec, ['district', 'ward', 'zone', 'region', 'city'], ['location']),
    status: status ?? (healthWarnings.length > 0 ? 'Degraded' : null),
    rawStatus,
    firmwareVersion: pickString(
      rec,
      ['firmwareVersion', 'firmware_version', 'fwVersion', 'fw_version', 'firmware'],
      ['device']
    ),
    mpu6050Status: mpu.mpu6050Status,
    rawMpu6050Status: mpu.rawMpu6050Status,
    gpsFix: gps.gpsFix,
    rawGpsStatus: gps.rawGpsStatus,
    satellites,
    gpsAltitude,
    gpsAccuracy,
    batteryVoltage,
    signalRssi: pickNumber(rec, ['signal_rssi', 'signalRssi', 'rssi', 'wifi_rssi'], ['telemetry', 'network']),
    packetsToday: pickNumber(
      rec,
      ['packets_today', 'packetsToday', 'total_packets', 'totalPackets'],
      ['device', 'telemetry']
    ),
    detectionCount: pickNumber(
      rec,
      ['detectionCount', 'detection_count', 'total_detections', 'totalDetections'],
      ['device', 'telemetry']
    ),
    deviceUptimeSec: pickNumber(
      rec,
      ['deviceUptime', 'device_uptime', 'uptimeSec', 'uptime_sec', 'uptime'],
      ['device', 'health', 'telemetry']
    ),
    potholesDetectedToday: pickNumber(rec, ['potholes_detected_today', 'potholesDetectedToday']),
    lastHeartbeat: pickIsoTimestamp(
      rec,
      [
        'last_communication',
        'lastCommunication',
        'last_comm_time',
        'lastCommTime',
        'last_seen',
        'lastSeen',
        'last_heartbeat',
        'lastHeartbeat',
        'receivedAt',
        'received_at',
        'updated_at',
        'updatedAt',
        'timestamp',
      ],
      ['device', 'metadata', 'backendMetadata']
    ),
    lat,
    lng,
    speedKmh: speed,
    manualSosButtonState,
    recentAccelSamples,
    healthWarnings,
    dataSource: 'LIVE_ESP32',
  };
}

function normalizeAlertStatus(raw: string | null): AlertStatus {
  if (!raw) return 'Active';
  const c = raw.trim().toLowerCase();
  if (c === 'resolved' || c === 'closed' || c === 'cleared') return 'Resolved';
  if (c === 'acknowledged' || c === 'ack' || c === 'in_progress' || c === 'in progress') {
    return 'Acknowledged';
  }
  return 'Active';
}

function normalizeAlertSeverity(raw: string | null): AlertRecord['severity'] {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (c === 'critical' || c === 'severe' || c === 'emergency') return 'Critical';
  if (c === 'high' || c === 'error') return 'High';
  if (c === 'moderate' || c === 'medium' || c === 'warning' || c === 'warn') return 'Moderate';
  if (c === 'info' || c === 'low') return 'Info';
  return null;
}

export function mapDeviceAlertDoc(
  docId: string,
  data: DocumentData,
  sourceCollection: 'device_alerts' | 'sos_alerts' = 'device_alerts'
): AlertRecord {
  const rec = (data || {}) as Record<string, unknown>;
  const rawType = pickString(rec, ['alert_type', 'alertType', 'type', 'category']) ?? '';
  const typeLower = rawType.toLowerCase();
  const isManualSos =
    sourceCollection === 'sos_alerts' ||
    pickBoolean(rec, ['is_manual_sos', 'isManualSos', 'manual_sos', 'manualSos']) === true ||
    typeLower.includes('sos');

  let category: AlertCategory = 'DEVICE_FAULT';
  if (isManualSos) category = 'MANUAL_SOS';
  else if (typeLower.includes('pothole')) category = 'CRITICAL_POTHOLE';
  else if (typeLower.includes('hotspot') || typeLower.includes('cluster')) category = 'HOTSPOT_THRESHOLD';
  else if (typeLower.includes('sla')) category = 'SLA_BREACH';
  else category = 'DEVICE_FAULT';

  const { lat, lng, hasReliableGps } = extractReliableCoordinates(rec);
  const deviceId = pickString(rec, ['device_id', 'deviceId', 'esp32_id', 'esp32Id']);
  const eventId = pickString(rec, ['event_id', 'eventId']);
  const potholeId = pickString(rec, ['pothole_id', 'potholeId']);

  const title =
    pickString(rec, ['title', 'subject']) ??
    (rawType
      ? `${rawType}${deviceId ? ` (${deviceId})` : ''}`
      : isManualSos
        ? `Manual SOS Alert${deviceId ? ` — ${deviceId}` : ''}`
        : `Device Health Alert${deviceId ? ` — ${deviceId}` : ''}`);

  const message =
    pickString(rec, ['message', 'description', 'details', 'reason']) ??
    (isManualSos ? 'Manual SOS alert recorded in Firestore.' : 'Device alert recorded in Firestore.');

  return {
    id: pickString(rec, ['alert_id', 'alertId', 'id']) ?? docId,
    eventId,
    category,
    isManualSos,
    severity: normalizeAlertSeverity(pickString(rec, ['severity', 'level'])) ?? (isManualSos ? 'Critical' : null),
    title,
    message,
    timestamp: pickIsoTimestamp(rec, [
      'timestamp',
      'created_at',
      'createdAt',
      'triggered_at',
      'triggeredAt',
      'detected_at',
      'detectedAt',
    ]),
    deviceId,
    potholeId,
    lat: hasReliableGps ? lat : null,
    lng: hasReliableGps ? lng : null,
    roadName: pickString(rec, ['road_name', 'roadName', 'location_name', 'locationName'], ['location']),
    operatorName: pickString(rec, ['operator_name', 'operatorName', 'rider_name', 'riderName']),
    status: normalizeAlertStatus(pickString(rec, ['status', 'state'])),
    acknowledgedBy: pickString(rec, ['acknowledged_by', 'acknowledgedBy']),
    acknowledgedAt: pickIsoTimestamp(rec, ['acknowledged_at', 'acknowledgedAt']),
    sourceCollection,
    dataSource: 'LIVE_ESP32',
  };
}

// ============================================================================
// Pure Workspace Builder (Deduplicated Stats + Clusters + Alerts)
// ============================================================================

export function buildLiveWorkspaceFromSnapshots(
  bundle: LiveFirestoreSnapshotBundle,
  options?: {
    epsMeters?: number;
    minPts?: number;
    h3Resolution?: 8 | 9 | 10;
    acknowledgedDerivedAlertIds?: ReadonlySet<string>;
    resolvedDerivedAlertIds?: ReadonlySet<string>;
  }
): TerraWorkspaceState {
  const epsMeters = options?.epsMeters ?? 320;
  const minPts = options?.minPts ?? 2;
  const h3Resolution = options?.h3Resolution ?? 9;

  // 1. Map strictly pothole-only collections without fabricating missing fields
  const mappedPotholeSensorDetections = bundle.sensorDetections
    .map((d) => mapSensorDetectionDoc(d.id, d.data))
    .filter((d): d is MappedSensorDetection => d !== null);
  const rawPotholes = bundle.potholes
    .map((d) => mapPotholeDoc(d.id, d.data))
    .filter((p): p is PotholeRecord => p !== null);
  const devices = bundle.devices.map((d) => mapDeviceDoc(d.id, d.data));
  const deviceAlerts = [
    ...bundle.deviceAlerts.map((d) => mapDeviceAlertDoc(d.id, d.data, 'device_alerts')),
    ...(bundle.sosAlerts || []).map((d) => mapDeviceAlertDoc(d.id, d.data, 'sos_alerts')),
  ];

  // Deduplicate potholes by canonical key (eventId || id) so the same event is never double-counted
  const potholeByKey = new Map<string, PotholeRecord>();
  for (const p of rawPotholes) {
    const key = canonicalEventKey(p.eventId ?? null, p.id);
    if (!potholeByKey.has(key)) {
      potholeByKey.set(key, p);
    }
  }
  const uniquePotholes = Array.from(potholeByKey.values());

  // 2. Run real DBSCAN & H3 spatial analysis strictly on potholes with reliable GPS coordinates
  const geolocatedPotholes = uniquePotholes.filter(
    (p) => p.hasReliableGps === true && p.lat !== null && p.lng !== null
  );
  const { clusters, pointClusterMap } = runDbscanClustering(
    geolocatedPotholes,
    epsMeters,
    minPts
  );
  const h3Cells = generateH3HexGrid(geolocatedPotholes, h3Resolution);

  const potholesWithSpatial: PotholeRecord[] = uniquePotholes.map((p) => {
    const assignedCluster = pointClusterMap.get(p.id) ?? p.clusterId;
    const matchedCell = h3Cells.find((cell) => cell.potholeIds.includes(p.id));
    return {
      ...p,
      clusterId: assignedCluster,
      h3Index: p.h3Index ?? matchedCell?.h3Index ?? null,
    };
  });

  // 3. Deduplicated Pothole-Only Detection Count (classification === "POTHOLE" across potholes + sensor_detections)
  const allPotholeDetectionKeys = new Set<string>();
  for (const det of mappedPotholeSensorDetections) {
    allPotholeDetectionKeys.add(det.eventKey);
  }
  for (const p of potholesWithSpatial) {
    allPotholeDetectionKeys.add(canonicalEventKey(p.eventId ?? null, p.id));
  }

  // Merge active device_alerts into corresponding devices' healthWarnings without duplicating
  const activeDeviceAlertMap = new Map<string, AlertRecord[]>();
  for (const alert of deviceAlerts) {
    if (alert.deviceId && alert.status !== 'Resolved') {
      const list = activeDeviceAlertMap.get(alert.deviceId) || [];
      list.push(alert);
      activeDeviceAlertMap.set(alert.deviceId, list);
    }
  }

  const enrichedDevices = devices.map((dev) => {
    const warnings = [...(dev.healthWarnings || [])];
    const alertsForDev = activeDeviceAlertMap.get(dev.id) || [];
    for (const a of alertsForDev) {
      const label = a.title;
      if (!warnings.some((w) => w.toLowerCase() === label.toLowerCase())) {
        warnings.push(label);
      }
    }
    return {
      ...dev,
      healthWarnings: warnings,
    };
  });

  const activeDevicesCount = enrichedDevices.filter((d) => d.status === 'Online').length;

  // Device health warnings: count unique warning conditions (per device sensor fault + unique active device_alerts)
  const warningKeys = new Set<string>();
  for (const dev of enrichedDevices) {
    if (dev.gpsFix === 'No Fix' || isDisconnectedOrFaultStatus(dev.rawGpsStatus ?? null)) {
      warningKeys.add(`gps:${dev.id}`);
    }
    if (
      dev.mpu6050Status === 'Fault' ||
      dev.mpu6050Status === 'Drift Warning' ||
      isDisconnectedOrFaultStatus(dev.rawMpu6050Status ?? null)
    ) {
      warningKeys.add(`mpu6050:${dev.id}`);
    }
  }
  for (const alert of deviceAlerts) {
    if (alert.status !== 'Resolved' && alert.category === 'DEVICE_FAULT') {
      const dedupeKey = alert.eventId
        ? `alert-evt:${alert.eventId}`
        : `alert-doc:${alert.id}`;
      warningKeys.add(dedupeKey);
    }
  }

  // 5. Merge Alerts from `device_alerts` and eligible `potholes` WITHOUT duplicates
  const alertMap = new Map<string, AlertRecord>();
  const coveredEventKeys = new Set<string>();

  for (const alert of deviceAlerts) {
    const key = alert.eventId
      ? `evt:${alert.eventId}`
      : alert.potholeId
        ? `pothole:${alert.potholeId}`
        : `doc:${alert.id}`;
    if (!alertMap.has(key)) {
      alertMap.set(key, alert);
    }
    if (alert.eventId) coveredEventKeys.add(alert.eventId);
    if (alert.potholeId) coveredEventKeys.add(alert.potholeId);
  }

  for (const pothole of potholesWithSpatial) {
    if (pothole.status === 'Repaired') continue;
    // Do not generate location-based pothole/rider warnings from unreliable GPS data
    if (pothole.hasReliableGps === false || pothole.lat === null || pothole.lng === null) {
      continue;
    }
    const evtKey = canonicalEventKey(pothole.eventId ?? null, pothole.id);
    if (coveredEventKeys.has(evtKey) || coveredEventKeys.has(pothole.id)) {
      continue; // Already covered by an existing alert — never duplicate!
    }
    coveredEventKeys.add(evtKey);

    const derivedId = `POTHOLE-${evtKey}`;
    const status: AlertStatus = options?.resolvedDerivedAlertIds?.has(derivedId)
      ? 'Resolved'
      : options?.acknowledgedDerivedAlertIds?.has(derivedId)
        ? 'Acknowledged'
        : 'Active';

    const sevLabel = pothole.severity ?? pothole.rawSeverity ?? 'N/A';
    const locLabel = pothole.roadName
      ? pothole.roadName
      : pothole.hasReliableGps && pothole.lat !== null && pothole.lng !== null
        ? `${pothole.lat.toFixed(5)}, ${pothole.lng.toFixed(5)}`
        : 'N/A';

    alertMap.set(`pothole-evt:${evtKey}`, {
      id: derivedId,
      eventId: pothole.eventId ?? pothole.id,
      category: 'CRITICAL_POTHOLE',
      isManualSos: false,
      severity: pothole.severity,
      title: `Eligible Pothole Event (${pothole.eventId ?? pothole.id})`,
      message: `Severity: ${sevLabel} · Location: ${locLabel} · Source: ${pothole.detectionSource ?? 'N/A'}`,
      timestamp: pothole.detectedAt,
      deviceId: pothole.deviceId,
      potholeId: pothole.id,
      lat: pothole.hasReliableGps ? pothole.lat : null,
      lng: pothole.hasReliableGps ? pothole.lng : null,
      roadName: pothole.roadName,
      operatorName: null,
      status,
      acknowledgedBy: null,
      acknowledgedAt: null,
      sourceCollection: 'potholes',
      dataSource: 'LIVE_ESP32',
    });
  }

  const alerts = Array.from(alertMap.values()).sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  // Strict Firestore boolean verification counts (never inferred from confidence/severity/classification)
  const totalVerifiedPotholes = potholesWithSpatial.filter((p) => p.verified === true).length;
  const notVerifiedPotholesCount = potholesWithSpatial.filter((p) => p.verified === false).length;
  const unknownVerificationCount = potholesWithSpatial.filter(
    (p) => p.verified === null || p.verified === undefined
  ).length;
  const reliableGpsPotholesCount = geolocatedPotholes.length;
  const unreliableGpsPotholesCount = potholesWithSpatial.length - reliableGpsPotholesCount;

  const criticalPotholesCount = potholesWithSpatial.filter(
    (p) => p.severity === 'Critical' && p.status !== 'Repaired'
  ).length;
  const highPotholesCount = potholesWithSpatial.filter(
    (p) => p.severity === 'High' && p.status !== 'Repaired'
  ).length;
  const moderatePotholesCount = potholesWithSpatial.filter(
    (p) => p.severity === 'Moderate' && p.status !== 'Repaired'
  ).length;
  const repairedPotholesCount = potholesWithSpatial.filter(
    (p) => p.status === 'Repaired'
  ).length;
  const unresolvedAlerts = alerts.filter((a) => a.status !== 'Resolved').length;

  const liveMetrics: LiveDashboardMetrics = {
    totalPotholeDetections: allPotholeDetectionKeys.size,
    totalVerifiedPotholes,
    notVerifiedPotholesCount,
    unknownVerificationCount,
    reliableGpsPotholesCount,
    unreliableGpsPotholesCount,
    criticalPotholesCount,
    highPotholesCount,
    moderatePotholesCount,
    repairedPotholesCount,
    activeDevices: activeDevicesCount,
    totalDevices: enrichedDevices.length,
    deviceHealthWarnings: warningKeys.size,
    unresolvedAlerts,
  };

  // 6. Optional Operational Collections (repair_tasks, repair_history, maintenance_teams, municipal_zones, users)
  const repairs: RepairWorkOrder[] = (bundle.repairTasks || []).map((docItem) => {
    const d = docItem.data as Record<string, unknown>;
    return {
      id: docItem.id,
      title: pickString(d, ['title']) ?? docItem.id,
      roadName: pickString(d, ['roadName', 'road_name']) ?? 'N/A',
      district: pickString(d, ['district']) ?? 'N/A',
      potholeIds: Array.isArray(d.potholeIds)
        ? d.potholeIds.filter((x): x is string => typeof x === 'string')
        : Array.isArray(d.pothole_ids)
          ? d.pothole_ids.filter((x): x is string => typeof x === 'string')
          : [],
      clusterId: pickString(d, ['clusterId', 'cluster_id']),
      priority: (pickString(d, ['priority']) as RepairWorkOrder['priority']) || 'P2',
      status: (pickString(d, ['status']) as RepairWorkOrder['status']) || 'Queued',
      assignedCrewId: pickString(d, ['assignedCrewId', 'assigned_crew_id']),
      createdAt: pickIsoTimestamp(d, ['createdAt', 'created_at']),
      scheduledDate: pickIsoTimestamp(d, ['scheduledDate', 'scheduled_date']),
      slaDeadline: pickIsoTimestamp(d, ['slaDeadline', 'sla_deadline']),
      completedAt: pickIsoTimestamp(d, ['completedAt', 'completed_at']),
      estimatedAsphaltTons: pickNumber(d, ['estimatedAsphaltTons', 'estimated_asphalt_tons']),
      estimatedCostUsd: pickNumber(d, ['estimatedCostUsd', 'estimated_cost_usd']),
      notes: pickString(d, ['notes']) ?? '',
      dataSource: 'LIVE_ESP32',
    };
  });

  const repairHistory: RepairHistoryRecord[] = (bundle.repairHistory || []).map((docItem) => {
    const d = docItem.data as Record<string, unknown>;
    const postRepairIri = pickNumber(d, ['postRepairIri', 'post_repair_iri']);
    return {
      id: docItem.id,
      taskId: pickString(d, ['taskId', 'task_id']) ?? 'N/A',
      previousStatus:
        (pickString(d, ['previousStatus', 'previous_status']) as RepairHistoryRecord['previousStatus']) ||
        'Queued',
      newStatus:
        (pickString(d, ['newStatus', 'new_status']) as WorkOrderStatus) || 'Queued',
      actorUid: pickString(d, ['actorUid', 'actor_uid']) ?? 'N/A',
      actorName: pickString(d, ['actorName', 'actor_name']) ?? 'N/A',
      notes: pickString(d, ['notes']) ?? '',
      ...(postRepairIri !== null ? { postRepairIri } : {}),
      createdAt: pickIsoTimestamp(d, ['createdAt', 'created_at']) ?? '',
    };
  });

  const crews: MaintenanceCrew[] = (bundle.maintenanceTeams || []).map((docItem) => {
    const d = docItem.data as Record<string, unknown>;
    return {
      id: docItem.id,
      name: pickString(d, ['name']) ?? docItem.id,
      leadEngineer: pickString(d, ['leadEngineer', 'lead_engineer']) ?? 'N/A',
      district: pickString(d, ['district']) ?? 'N/A',
      status: (pickString(d, ['status']) as MaintenanceCrew['status']) || 'Available',
      vehicleUnit: pickString(d, ['vehicleUnit', 'vehicle_unit']) ?? 'N/A',
      activeOrderCount: pickNumber(d, ['activeOrderCount', 'active_order_count']),
      membersCount: pickNumber(d, ['membersCount', 'members_count']),
      contactRadio: pickString(d, ['contactRadio', 'contact_radio']) ?? 'N/A',
    };
  });

  const zones: MunicipalZone[] = (bundle.municipalZones || []).map((docItem) => {
    const d = docItem.data as Record<string, unknown>;
    return {
      id: docItem.id,
      name: pickString(d, ['name']) ?? docItem.id,
      code: pickString(d, ['code', 'wardCode', 'ward_code']) ?? 'N/A',
      slaCriticalHours: pickNumber(d, ['slaCriticalHours', 'sla_critical_hours']) ?? 24,
      slaHighHours: pickNumber(d, ['slaHighHours', 'sla_high_hours']) ?? 72,
      targetIriMax: pickNumber(d, ['targetIriMax', 'target_iri_max']) ?? 3.5,
      roadKmMonitored: pickNumber(d, ['roadKmMonitored', 'road_km_monitored', 'roadLengthKm']) ?? 0,
      updatedAt: pickIsoTimestamp(d, ['updatedAt', 'updated_at', 'createdAt', 'created_at']) ?? '',
    };
  });

  const users: MunicipalUser[] = (bundle.users || []).map((docItem) => {
    const d = docItem.data as Record<string, unknown>;
    return {
      id: docItem.id,
      uid: pickString(d, ['uid']) ?? docItem.id,
      fullName: pickString(d, ['fullName', 'full_name', 'name']) ?? 'N/A',
      email: pickString(d, ['email']) ?? 'N/A',
      role: (pickString(d, ['role']) as MunicipalUser['role']) || 'Field Maintenance Team',
      department: pickString(d, ['department']) ?? 'N/A',
      districtScope: pickString(d, ['districtScope', 'district_scope']) ?? 'N/A',
      phone: pickString(d, ['phone']) ?? undefined,
      status: pickString(d, ['status']) === 'Suspended' ? 'Suspended' : 'Active',
      lastLogin: pickIsoTimestamp(d, ['updatedAt', 'updated_at', 'createdAt', 'created_at']) ?? '',
    };
  });

  return {
    potholes: potholesWithSpatial,
    clusters,
    h3Cells,
    zones,
    repairs,
    repairHistory,
    crews,
    alerts,
    devices: enrichedDevices,
    users,
    settings: {
      demoModeEnabled: false,
      municipalityName: 'Bengaluru Municipal Road Intelligence',
      coordinateReferenceLabel: 'WGS84 / Bengaluru, Karnataka (Live Cloud Firestore)',
      mpu6050TriggerThresholdG: 2.2,
      mlConfidenceCutoffPct: 75,
      dbscanDefaultEpsMeters: epsMeters,
      dbscanDefaultMinPts: minPts,
      h3DefaultResolution: h3Resolution,
      slaCriticalHours: 24,
      slaHighHours: 72,
      priorityWeights: DEFAULT_PRIORITY_WEIGHTS,
      esp32ApiEndpoint: ESP32_DETECTIONS_ENDPOINT,
      firebaseStatus: 'Project terra-track-53004 (asia-south1 · (default) · Real-Time onSnapshot)',
    },
    liveMetrics,
    isLiveFirestore: true,
  };
}

// ============================================================================
// Real-Time Firestore Subscription Manager (docChanges + Honest Diagnostics)
// ============================================================================

const CORE_COLLECTIONS = [
  FIRESTORE_COLLECTIONS.potholes,
  FIRESTORE_COLLECTIONS.sensorDetections,
  FIRESTORE_COLLECTIONS.devices,
  FIRESTORE_COLLECTIONS.deviceAlerts,
] as const;

const OPTIONAL_COLLECTIONS = [
  FIRESTORE_COLLECTIONS.sosAlerts,
  FIRESTORE_COLLECTIONS.repairTasks,
  FIRESTORE_COLLECTIONS.repairHistory,
  FIRESTORE_COLLECTIONS.maintenanceTeams,
  FIRESTORE_COLLECTIONS.municipalZones,
  FIRESTORE_COLLECTIONS.users,
] as const;

export interface MinimalDocChange {
  type: 'added' | 'modified' | 'removed';
  id: string;
  data: DocumentData;
}

/**
 * Pure incremental docChanges() reducer so additions, modifications, and
 * removals update the live collection map cleanly with zero duplicates.
 */
export function applyDocChangesToMap(
  docMap: Map<string, RawFirestoreDoc>,
  changes: ReadonlyArray<MinimalDocChange>
): RawFirestoreDoc[] {
  for (const change of changes) {
    if (change.type === 'removed') {
      docMap.delete(change.id);
    } else {
      docMap.set(change.id, { id: change.id, data: change.data });
    }
  }
  return Array.from(docMap.values());
}

/**
 * Honest database connection status derivation.
 * Never reports CONNECTED merely because Firebase config exists — only after
 * all 6 required core listeners have settled with actual snapshots and zero core errors.
 */
export function deriveDatabaseConnectionStatus(params: {
  collections: Record<string, CollectionSubscriptionDiag>;
  browserOffline: boolean;
  firestoreUnavailable: boolean;
  configError?: string | null;
  authMissing?: boolean;
}): DatabaseConnectionStatus {
  if (params.authMissing) return 'PERMISSION_ERROR';
  if (params.configError) return 'ERROR';

  const coreDiags = CORE_COLLECTIONS.map((name) => params.collections[name]).filter(
    (d): d is CollectionSubscriptionDiag => Boolean(d)
  );

  if (coreDiags.some((d) => d.status === 'permission-denied')) {
    return 'PERMISSION_ERROR';
  }
  if (params.browserOffline || params.firestoreUnavailable || coreDiags.some((d) => d.status === 'offline')) {
    return 'DISCONNECTED';
  }
  if (coreDiags.some((d) => d.status === 'error')) {
    return 'ERROR';
  }
  if (
    coreDiags.length >= CORE_COLLECTIONS.length &&
    coreDiags.every((d) => d.status === 'connected')
  ) {
    return 'CONNECTED';
  }
  return 'CONNECTING';
}

export function createInitialSyncState(
  projectId = 'terra-track-53004',
  databaseId = '(default)'
): LiveCollectionSyncState {
  const collections: Record<string, CollectionSubscriptionDiag> = {};
  for (const name of CORE_COLLECTIONS) {
    collections[name] = {
      name,
      required: true,
      status: 'connecting',
      docCount: 0,
      fromCache: false,
      error: null,
      lastUpdatedAt: null,
    };
  }
  for (const name of OPTIONAL_COLLECTIONS) {
    collections[name] = {
      name,
      required: false,
      status: 'connecting',
      docCount: 0,
      fromCache: false,
      error: null,
      lastUpdatedAt: null,
    };
  }
  return {
    connectionStatus: 'CONNECTING',
    loading: true,
    ready: false,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    fromCache: false,
    projectId,
    databaseId,
    lastError: null,
    errors: {},
    collections,
    lastSyncedAt: null,
  };
}

let activeLiveSubscriptionCleanup: (() => void) | null = null;

export function subscribeToLiveFirestoreWorkspace(params: {
  onWorkspace: (workspace: TerraWorkspaceState, rawBundle: LiveFirestoreSnapshotBundle) => void;
  onSyncState: (state: LiveCollectionSyncState) => void;
  getSpatialConfig?: () => { epsMeters: number; minPts: number; h3Resolution: 8 | 9 | 10 };
  getLocalAlertOverrides?: () => {
    acknowledged: ReadonlySet<string>;
    resolved: ReadonlySet<string>;
  };
}): () => void {
  // Prevent duplicate active listener sets (e.g., StrictMode double-mount or rapid re-auth)
  if (activeLiveSubscriptionCleanup) {
    activeLiveSubscriptionCleanup();
    activeLiveSubscriptionCleanup = null;
  }

  let cancelled = false;
  const activeUnsubs = new Map<string, Unsubscribe>();
  const docMaps = new Map<string, Map<string, RawFirestoreDoc>>();

  const bundle: LiveFirestoreSnapshotBundle = {
    sensorDetections: [],
    potholes: [],
    devices: [],
    deviceAlerts: [],
    sosAlerts: [],
    repairTasks: [],
    repairHistory: [],
    maintenanceTeams: [],
    municipalZones: [],
    users: [],
  };

  let projectId = 'terra-track-53004';
  let databaseId = '(default)';
  let lastSyncedAt: string | null = null;
  let lastError: string | null = null;
  let configError: string | null = null;
  let authMissing = false;

  const initialState = createInitialSyncState(projectId, databaseId);
  const collectionDiags: Record<string, CollectionSubscriptionDiag> = {
    ...initialState.collections,
  };
  const settledCore = new Set<string>();
  const errors: Record<string, string> = {};
  let browserOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  let firestoreUnavailable = false;
  let initializedDb: Awaited<ReturnType<typeof ensureFirebaseInitialized>>['db'] = null;

  const cloneCollectionsDiag = (): Record<string, CollectionSubscriptionDiag> => {
    const copy: Record<string, CollectionSubscriptionDiag> = {};
    for (const [k, v] of Object.entries(collectionDiags)) {
      copy[k] = { ...v };
    }
    return copy;
  };

  const emitSyncOnly = () => {
    if (cancelled) return;
    const ready = settledCore.size >= CORE_COLLECTIONS.length;
    const coreDiagList = CORE_COLLECTIONS.map((c) => collectionDiags[c]);
    const fromCache =
      coreDiagList.some((d) => d.status === 'connected') &&
      coreDiagList.filter((d) => d.status === 'connected').every((d) => d.fromCache);
    const connectionStatus = deriveDatabaseConnectionStatus({
      collections: collectionDiags,
      browserOffline,
      firestoreUnavailable,
      configError,
      authMissing,
    });

    params.onSyncState({
      connectionStatus,
      loading: !ready && !configError && !authMissing,
      ready,
      isOffline: browserOffline || firestoreUnavailable,
      fromCache,
      projectId,
      databaseId,
      lastError,
      errors: { ...errors },
      collections: cloneCollectionsDiag(),
      lastSyncedAt,
    });
  };

  const emitWorkspaceAndSync = () => {
    if (cancelled) return;
    const spatial = params.getSpatialConfig?.();
    const overrides = params.getLocalAlertOverrides?.();
    const workspace = buildLiveWorkspaceFromSnapshots(bundle, {
      epsMeters: spatial?.epsMeters,
      minPts: spatial?.minPts,
      h3Resolution: spatial?.h3Resolution,
      acknowledgedDerivedAlertIds: overrides?.acknowledged,
      resolvedDerivedAlertIds: overrides?.resolved,
    });
    params.onWorkspace(workspace, { ...bundle });
    emitSyncOnly();
  };

  const assignByCollection = (collectionName: string, docs: RawFirestoreDoc[]) => {
    switch (collectionName) {
      case FIRESTORE_COLLECTIONS.sensorDetections:
        bundle.sensorDetections = docs;
        break;
      case FIRESTORE_COLLECTIONS.potholes:
        bundle.potholes = docs;
        break;
      case FIRESTORE_COLLECTIONS.devices:
        bundle.devices = docs;
        break;
      case FIRESTORE_COLLECTIONS.deviceAlerts:
        bundle.deviceAlerts = docs;
        break;
      case FIRESTORE_COLLECTIONS.sosAlerts:
        bundle.sosAlerts = docs;
        break;
      case FIRESTORE_COLLECTIONS.repairTasks:
        bundle.repairTasks = docs;
        break;
      case FIRESTORE_COLLECTIONS.repairHistory:
        bundle.repairHistory = docs;
        break;
      case FIRESTORE_COLLECTIONS.maintenanceTeams:
        bundle.maintenanceTeams = docs;
        break;
      case FIRESTORE_COLLECTIONS.municipalZones:
        bundle.municipalZones = docs;
        break;
      case FIRESTORE_COLLECTIONS.users:
        bundle.users = docs;
        break;
    }
  };

  const attachCollectionListener = (collectionName: string, required: boolean) => {
    if (cancelled || !initializedDb) return;

    // Tear down any previous listener for this collection before re-attaching
    const prevUnsub = activeUnsubs.get(collectionName);
    if (prevUnsub) {
      try {
        prevUnsub();
      } catch {
        // ignore
      }
      activeUnsubs.delete(collectionName);
    }

    const docMap = new Map<string, RawFirestoreDoc>();
    docMaps.set(collectionName, docMap);

    collectionDiags[collectionName] = {
      name: collectionName,
      required,
      status: 'connecting',
      docCount: 0,
      fromCache: false,
      error: null,
      lastUpdatedAt: collectionDiags[collectionName]?.lastUpdatedAt ?? null,
    };

    const unsub = onSnapshot(
      collection(initializedDb, collectionName),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (cancelled) return;
        const nowIso = new Date().toISOString();

        // Explicitly process incremental docChanges() (added / modified / removed)
        const changes: MinimalDocChange[] = snapshot.docChanges().map((c) => ({
          type: c.type,
          id: c.doc.id,
          data: c.doc.data(),
        }));
        let docs: RawFirestoreDoc[];
        if (changes.length > 0) {
          docs = applyDocChangesToMap(docMap, changes);
        } else {
          // Metadata-only snapshot or empty initial collection
          docMap.clear();
          for (const d of snapshot.docs) {
            docMap.set(d.id, { id: d.id, data: d.data() });
          }
          docs = Array.from(docMap.values());
        }

        delete errors[collectionName];
        if (Object.keys(errors).length === 0) {
          lastError = null;
        }
        if (required) {
          settledCore.add(collectionName);
        }
        if (!snapshot.metadata.fromCache) {
          firestoreUnavailable = false;
        }

        collectionDiags[collectionName] = {
          name: collectionName,
          required,
          status: 'connected',
          docCount: docs.length,
          fromCache: snapshot.metadata.fromCache,
          error: null,
          lastUpdatedAt: nowIso,
        };
        lastSyncedAt = nowIso;

        assignByCollection(collectionName, docs);
        emitWorkspaceAndSync();
      },
      (err) => {
        if (cancelled) return;
        const code = (err as { code?: string })?.code || 'firestore-error';
        const msg = err instanceof Error ? err.message : String(err);

        if (required) {
          settledCore.add(collectionName);
          console.error(
            `Firestore onSnapshot error [${OperationType.LIST}] /${collectionName}:`,
            { code, message: msg }
          );
        }

        let diagStatus: CollectionSubscriptionDiag['status'] = 'error';
        let formattedErr = `Error reading /${collectionName}: ${msg}`;

        if (code === 'unavailable' || msg.toLowerCase().includes('offline')) {
          diagStatus = 'offline';
          if (required) firestoreUnavailable = true;
          formattedErr = `Cloud Firestore is currently offline or unreachable for /${collectionName}. Live sync will resume automatically when connectivity returns.`;
        } else if (
          code === 'permission-denied' ||
          msg.includes('Missing or insufficient permissions')
        ) {
          diagStatus = 'permission-denied';
          formattedErr = `Permission denied reading /${collectionName}. Deploy the updated firestore.rules to project ${projectId} to grant authenticated municipal access.`;
        }

        collectionDiags[collectionName] = {
          name: collectionName,
          required,
          status: diagStatus,
          docCount: docMap.size,
          fromCache: false,
          error: formattedErr,
          lastUpdatedAt: collectionDiags[collectionName]?.lastUpdatedAt ?? null,
        };

        if (required) {
          errors[collectionName] = formattedErr;
          lastError = formattedErr;
        }
        emitWorkspaceAndSync();
      }
    );

    activeUnsubs.set(collectionName, unsub);
  };

  const handleOnline = () => {
    browserOffline = false;
    firestoreUnavailable = false;
    if (initializedDb && !cancelled) {
      // Automatically recover any listeners that dropped while offline
      for (const name of CORE_COLLECTIONS) {
        const st = collectionDiags[name]?.status;
        if (st === 'offline' || st === 'error') {
          attachCollectionListener(name, true);
        }
      }
      for (const name of OPTIONAL_COLLECTIONS) {
        const st = collectionDiags[name]?.status;
        if (st === 'offline' || st === 'error') {
          attachCollectionListener(name, false);
        }
      }
    }
    emitSyncOnly();
  };

  const handleOffline = () => {
    browserOffline = true;
    emitSyncOnly();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  emitSyncOnly();

  (async () => {
    const init = await ensureFirebaseInitialized();
    if (cancelled) return;

    projectId = init.config.projectId || 'terra-track-53004';
    databaseId = init.config.databaseId || '(default)';

    if (!init.ready || !init.db) {
      configError = `Firebase Firestore is not configured (${init.missingFields.join(', ') || 'missing env vars'}).`;
      errors.firebase = configError;
      lastError = configError;
      emitSyncOnly();
      return;
    }

    // Ensure Firebase Auth has finished restoring persisted user session before subscribing
    if (typeof init.auth?.authStateReady === 'function') {
      try {
        await init.auth.authStateReady();
      } catch {
        // Handled cleanly by currentUser check below
      }
      if (cancelled) return;
    }

    if (!init.auth?.currentUser) {
      authMissing = true;
      const msg =
        'Firebase Authentication session is not active. Sign in with an authorized municipal account to subscribe to Cloud Firestore.';
      errors.auth = msg;
      lastError = msg;
      emitSyncOnly();
      return;
    }

    initializedDb = init.db;

    // 6 Core Live Firestore Collections
    for (const colName of CORE_COLLECTIONS) {
      attachCollectionListener(colName, true);
    }

    // Optional Existing Operational Collections (Repair Management, SOS, Zones, Users)
    for (const colName of OPTIONAL_COLLECTIONS) {
      attachCollectionListener(colName, false);
    }
  })();

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
    for (const unsub of activeUnsubs.values()) {
      try {
        unsub();
      } catch {
        // ignore cleanup error
      }
    }
    activeUnsubs.clear();
    docMaps.clear();
    if (activeLiveSubscriptionCleanup === cleanup) {
      activeLiveSubscriptionCleanup = null;
    }
  };

  activeLiveSubscriptionCleanup = cleanup;
  return cleanup;
}

// ============================================================================
// Live Firestore Mutations (Null-Safe Optional Fields)
// ============================================================================

export async function updateLivePotholeRecord(
  potholeDocId: string,
  patch: Partial<Pick<PotholeRecord, 'status' | 'severity' | 'notes' | 'assignedWorkOrderId' | 'verified'>>
): Promise<void> {
  const init = await ensureFirebaseInitialized();
  if (!init.ready || !init.db) {
    throw new Error('Firebase Firestore is not initialized.');
  }

  const payload: Record<string, unknown> = {
    updated_at: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (patch.status !== undefined) {
    payload.repair_status = patch.status ?? null;
    payload.status = patch.status ?? null;
  }
  if (patch.severity !== undefined) {
    payload.severity = patch.severity ?? null;
  }
  if (patch.verified !== undefined) {
    payload.verified = patch.verified;
    payload.isVerified = patch.verified;
    payload.is_verified = patch.verified;
  }
  if (patch.notes !== undefined) {
    const trimmed = typeof patch.notes === 'string' ? patch.notes.trim() : '';
    payload.notes = trimmed ? trimmed.slice(0, 1000) : null;
  }
  if (patch.assignedWorkOrderId !== undefined) {
    payload.assignedWorkOrderId = patch.assignedWorkOrderId ?? null;
  }

  await updateDoc(doc(init.db, FIRESTORE_COLLECTIONS.potholes, potholeDocId), payload);
}

export async function createLiveRepairTask(
  payload: Omit<RepairWorkOrder, 'id' | 'createdAt' | 'completedAt' | 'dataSource'>,
  createdByUid: string
): Promise<void> {
  const init = await ensureFirebaseInitialized();
  if (!init.ready || !init.db) {
    throw new Error('Firebase Firestore is not initialized.');
  }
  const taskId = `WO-${Date.now()}`;
  await setDoc(doc(init.db, FIRESTORE_COLLECTIONS.repairTasks, taskId), {
    id: taskId,
    title: payload.title.trim().slice(0, 180),
    roadName: payload.roadName.trim().slice(0, 160),
    district: payload.district.trim().slice(0, 120),
    potholeIds: payload.potholeIds.slice(0, 50),
    clusterId: payload.clusterId ?? null,
    priority: payload.priority,
    status: payload.status,
    assignedCrewId: payload.assignedCrewId ?? null,
    scheduledDate: payload.scheduledDate || null,
    slaDeadline: payload.slaDeadline || null,
    completedAt: null,
    estimatedAsphaltTons: payload.estimatedAsphaltTons,
    estimatedCostUsd: payload.estimatedCostUsd,
    notes: payload.notes?.trim() ? payload.notes.trim().slice(0, 1000) : null,
    dataSource: 'LIVE_ESP32',
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Best-effort link back to potholes documents
  for (const pid of payload.potholeIds) {
    await updateDoc(doc(init.db, FIRESTORE_COLLECTIONS.potholes, pid), {
      assignedWorkOrderId: taskId,
      repair_status: 'Scheduled',
      status: 'Scheduled',
      updated_at: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }
}

export async function updateLiveRepairTask(
  taskId: string,
  patch: Partial<Pick<RepairWorkOrder, 'status' | 'assignedCrewId' | 'priority' | 'notes'>>,
  context?: {
    linkedPotholeIds?: string[];
    previousStatus?: WorkOrderStatus;
    actorUid?: string;
    actorName?: string;
  }
): Promise<void> {
  const init = await ensureFirebaseInitialized();
  if (!init.ready || !init.db) {
    throw new Error('Firebase Firestore is not initialized.');
  }
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.status !== undefined) {
    payload.status = patch.status;
    payload.completedAt = patch.status === 'Completed' ? new Date().toISOString() : null;
  }
  if (patch.assignedCrewId !== undefined) payload.assignedCrewId = patch.assignedCrewId ?? null;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.notes !== undefined) {
    payload.notes = patch.notes.trim() ? patch.notes.trim().slice(0, 1000) : null;
  }

  await updateDoc(doc(init.db, FIRESTORE_COLLECTIONS.repairTasks, taskId), payload);

  // Propagate repair lifecycle changes back to linked pothole records so Map, Dashboard & Pothole Queue stay in sync
  if (patch.status && context?.linkedPotholeIds?.length) {
    const mappedPotholeStatus: PotholeStatus | null =
      patch.status === 'Completed'
        ? 'Repaired'
        : patch.status === 'In Progress' || patch.status === 'Verification'
          ? 'In Progress'
          : patch.status === 'Dispatched' || patch.status === 'Queued'
            ? 'Scheduled'
            : null;
    if (mappedPotholeStatus) {
      for (const pid of context.linkedPotholeIds) {
        await updateDoc(doc(init.db, FIRESTORE_COLLECTIONS.potholes, pid), {
          repair_status: mappedPotholeStatus,
          status: mappedPotholeStatus,
          updated_at: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
    }
  }

  // Best-effort immutable audit log entry in repair_history
  if (patch.status && context?.actorUid) {
    const histId = `RH-${Date.now()}`;
    await setDoc(doc(init.db, FIRESTORE_COLLECTIONS.repairHistory, histId), {
      id: histId,
      taskId,
      previousStatus: context.previousStatus ?? 'Queued',
      newStatus: patch.status,
      actorUid: context.actorUid,
      actorName: context.actorName ?? 'Municipal Operator',
      notes: patch.notes?.trim() ? patch.notes.trim().slice(0, 1000) : null,
      createdAt: serverTimestamp(),
    }).catch(() => undefined);
  }
}

export async function updateLiveDeviceAlertStatus(
  alertDocId: string,
  status: AlertStatus,
  acknowledgedBy: string,
  targetCollection: 'device_alerts' | 'sos_alerts' = 'device_alerts'
): Promise<void> {
  const init = await ensureFirebaseInitialized();
  if (!init.ready || !init.db) {
    throw new Error('Firebase Firestore is not initialized.');
  }
  const collectionPath =
    targetCollection === 'sos_alerts'
      ? FIRESTORE_COLLECTIONS.sosAlerts
      : FIRESTORE_COLLECTIONS.deviceAlerts;
  await updateDoc(doc(init.db, collectionPath, alertDocId), {
    status,
    acknowledged_by: acknowledgedBy || null,
    acknowledgedBy: acknowledgedBy || null,
    acknowledged_at: new Date().toISOString(),
    acknowledgedAt: new Date().toISOString(),
    updated_at: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
