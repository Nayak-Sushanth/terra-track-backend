import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createInitialDemoWorkspace } from './src/data/demoData.ts';
import { evaluateRoadConditionGate } from './src/services/esp32Service.ts';
import {
  calculatePotholePriority,
  classifySeverityFromSensor,
  recalculatePotholePriorities,
} from './src/utilities/priorityEngine.ts';
import {
  generateH3HexGrid,
  runDbscanClustering,
} from './src/utilities/spatialEngine.ts';
import type {
  AlertRecord,
  Esp32Device,
  MunicipalUser,
  PotholeRecord,
  RepairHistoryRecord,
  RepairWorkOrder,
  SystemSettings,
  TelemetryIngestPayload,
  TerraWorkspaceState,
  UserRole,
} from './src/types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIREBASE_PROJECT_ID =
  process.env.VITE_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  'terra-track-53004';

const FIREBASE_DATABASE_ID =
  process.env.VITE_FIREBASE_DATABASE_ID ||
  process.env.FIREBASE_DATABASE_ID ||
  '(default)';

// Initialize Firebase Admin SDK strictly once for ID token cryptographic verification
// and persistent server-side Firestore ingestion on project terra-track-53004.
let adminAuth: ReturnType<typeof getAdminAuth> | null = null;
let adminDb: ReturnType<typeof getAdminFirestore> | null = null;
try {
  const adminApp =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          projectId: FIREBASE_PROJECT_ID,
        });
  adminAuth = getAdminAuth(adminApp);
  adminDb =
    FIREBASE_DATABASE_ID && FIREBASE_DATABASE_ID !== '(default)'
      ? getAdminFirestore(adminApp, FIREBASE_DATABASE_ID)
      : getAdminFirestore(adminApp);
} catch (err) {
  console.error('Firebase Admin SDK initialization warning:', err);
}

// Ephemeral HMAC signing key for server-issued DEMO MODE sandbox tokens
const DEMO_TOKEN_SECRET = crypto.randomBytes(32);
const ALLOWED_ROLES: ReadonlySet<UserRole> = new Set([
  'Admin',
  'Municipal Officer',
  'Field Maintenance Team',
]);

// Authoritative bootstrap Admin emails (never trusted from client requests)
const BOOTSTRAP_ADMIN_EMAILS = new Set(
  [
    process.env.TERRA_BOOTSTRAP_ADMIN_EMAIL || '',
    'nayaksushanth0@gmail.com',
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

interface AuthenticatedRequestContext {
  uid: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: 'Active' | 'Suspended';
  displayName: string;
  authMode: 'firebase' | 'demo';
}

type AuthedRequest = Request & { authUser?: AuthenticatedRequestContext };

// In-memory municipal DEMO workspace (kept strictly separate from LIVE_ESP32 records)
let workspace: TerraWorkspaceState = createInitialDemoWorkspace();
workspace.settings.firebaseStatus = `Project ${FIREBASE_PROJECT_ID} (asia-south1 · ${FIREBASE_DATABASE_ID})`;

function signDemoToken(payload: { uid: string; email: string; role: UserRole; name: string }): string {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      mode: 'demo',
      exp: Date.now() + 12 * 3600 * 1000,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', DEMO_TOKEN_SECRET)
    .update(body)
    .digest('base64url');
  return `demo.${body}.${sig}`;
}

function verifyDemoToken(token: string): AuthenticatedRequestContext | null {
  if (!token.startsWith('demo.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', DEMO_TOKEN_SECRET)
    .update(body)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      uid: string;
      email: string;
      role: UserRole;
      name: string;
      exp: number;
    };
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (!ALLOWED_ROLES.has(parsed.role)) return null;
    return {
      uid: parsed.uid,
      email: parsed.email,
      emailVerified: true,
      role: parsed.role,
      status: 'Active',
      displayName: parsed.name,
      authMode: 'demo',
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a Firebase user's authoritative role from Cloud Firestore `/users/{uid}`
 * using the caller's own verified Firebase ID token, falling back to verified
 * bootstrap Admin or least-privilege `Field Maintenance Team`.
 * NEVER reads or trusts any role supplied in request headers or body.
 */
async function resolveAuthoritativeFirebaseRole(
  uid: string,
  email: string,
  emailVerified: boolean,
  rawIdToken: string
): Promise<{ role: UserRole; status: 'Active' | 'Suspended'; fullName: string }> {
  // 1. Check Firestore `/users/{uid}` via REST API authenticated as the verified caller
  try {
    const dbName = encodeURIComponent(FIREBASE_DATABASE_ID);
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_PROJECT_ID
    )}/databases/${dbName}/documents/users/${encodeURIComponent(uid)}`;

    const resp = await fetch(firestoreUrl, {
      headers: {
        Authorization: `Bearer ${rawIdToken}`,
      },
    });

    if (resp.ok) {
      const docJson = (await resp.json()) as {
        fields?: Record<string, { stringValue?: string }>;
      };
      const fsRole = docJson.fields?.role?.stringValue as UserRole | undefined;
      const fsStatus = docJson.fields?.status?.stringValue;
      const fsName = docJson.fields?.fullName?.stringValue || email;
      if (fsRole && ALLOWED_ROLES.has(fsRole)) {
        return {
          role: fsRole,
          status: fsStatus === 'Suspended' ? 'Suspended' : 'Active',
          fullName: fsName,
        };
      }
    }
  } catch {
    // Fall through cleanly if Firestore doc doesn't exist yet or network is unreachable
  }

  // 2. Check verified bootstrap Admin email
  if (emailVerified && BOOTSTRAP_ADMIN_EMAILS.has(email.toLowerCase())) {
    return { role: 'Admin', status: 'Active', fullName: email };
  }

  // 3. Check authoritative server directory by UID or email
  const matched = workspace.users.find(
    (u) => u.uid === uid || u.email.toLowerCase() === email.toLowerCase()
  );
  if (matched) {
    return {
      role: matched.role,
      status: matched.status,
      fullName: matched.fullName,
    };
  }

  // 4. Least-privilege default
  return {
    role: 'Field Maintenance Team',
    status: 'Active',
    fullName: email || 'Municipal Operator',
  };
}

/**
 * Municipal User Authentication Middleware (Firebase ID Token OR signed Demo Session)
 */
async function requireMunicipalAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Empty Bearer token.' });
    return;
  }

  // Path A: Signed DEMO MODE Sandbox Token
  const demoCtx = verifyDemoToken(token);
  if (demoCtx) {
    req.authUser = demoCtx;
    next();
    return;
  }

  // Path B: Cryptographically Verified Firebase ID Token
  if (!adminAuth) {
    res.status(503).json({
      error: 'Authentication verifier is temporarily unavailable on this server instance.',
    });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || '';
    const emailVerified = Boolean(decoded.email_verified);
    const resolved = await resolveAuthoritativeFirebaseRole(
      decoded.uid,
      email,
      emailVerified,
      token
    );

    if (resolved.status === 'Suspended') {
      res.status(403).json({ error: 'Account is suspended.' });
      return;
    }

    req.authUser = {
      uid: decoded.uid,
      email,
      emailVerified,
      role: resolved.role,
      status: resolved.status,
      displayName: resolved.fullName || decoded.name || email,
      authMode: 'firebase',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * Backend Role-Based Access Control Middleware (NEVER trusts client-supplied role)
 */
function requireRoles(allowed: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowed.includes(user.role)) {
      res.status(403).json({
        error: `Forbidden: role "${user.role}" cannot perform this action. Required: ${allowed.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

/**
 * Separate ESP32 Hardware Device API Key Authentication Middleware.
 * Completely decoupled from Municipal User Firebase Auth tokens!
 */
function requireDeviceApiKey(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.ESP32_DEVICE_API_KEY || '';
  if (!configuredKey) {
    res.status(503).json({
      error:
        'ESP32 Device Ingestion API key (ESP32_DEVICE_API_KEY) is not configured on the server.',
    });
    return;
  }

  const providedKey = String(
    req.headers['x-device-api-key'] || req.headers['x-device-key'] || ''
  );
  if (!providedKey) {
    res.status(401).json({
      error: 'Missing X-Device-API-Key (or x-device-key) header for hardware telemetry.',
    });
    return;
  }

  const a = Buffer.from(providedKey);
  const b = Buffer.from(configuredKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'Invalid ESP32 device API key.' });
    return;
  }

  next();
}

function sanitizeFirestoreDocId(raw: string, fallbackPrefix: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

function normalizeIncomingHardwareTelemetry(
  rawBody: Record<string, unknown>,
  headerDeviceId?: string
): {
  deviceId: string;
  eventId: string;
  condition: string;
  isPothole: boolean;
  lat: number | null;
  lng: number | null;
  locationReliable: boolean;
  peakAccelG: number;
  rmsVibration: number;
  iriScore: number;
  speedKmh: number;
  mlConfidence: number;
  roadName: string;
  district: string;
  arterialClass: PotholeRecord['arterialClass'];
  manualSos: boolean;
  operatorName: string | null;
  firmwareVersion: string | null;
  batteryVoltage: number | null;
  satellites: number | null;
  gpsStatus: string | null;
  mpu6050Status: string | null;
  detectedAtIso: string;
} {
  const gpsObj =
    rawBody.gps && typeof rawBody.gps === 'object'
      ? (rawBody.gps as Record<string, unknown>)
      : {};
  const sensorObj =
    rawBody.sensor && typeof rawBody.sensor === 'object'
      ? (rawBody.sensor as Record<string, unknown>)
      : {};
  const detectionObj =
    rawBody.detection && typeof rawBody.detection === 'object'
      ? (rawBody.detection as Record<string, unknown>)
      : {};

  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  const deviceId =
    str(rawBody.deviceId) ||
    str(rawBody.device_id) ||
    str(headerDeviceId) ||
    '';

  const rawCondition =
    str(rawBody.classification) ||
    str(rawBody.condition) ||
    str(rawBody.road_condition) ||
    str(rawBody.roadCondition) ||
    str(detectionObj.classification) ||
    str(detectionObj.label) ||
    '';

  const isPothole = rawCondition.trim().toUpperCase() === 'POTHOLE';

  const lat = num(rawBody.latitude ?? rawBody.lat ?? gpsObj.latitude ?? gpsObj.lat);
  const lng = num(rawBody.longitude ?? rawBody.lng ?? rawBody.lon ?? gpsObj.longitude ?? gpsObj.lng);
  const coordsInBounds =
    lat !== null &&
    lng !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0);

  const explicitReliable =
    typeof rawBody.locationReliable === 'boolean'
      ? rawBody.locationReliable
      : typeof rawBody.gps_valid === 'boolean'
        ? rawBody.gps_valid
        : typeof gpsObj.valid === 'boolean'
          ? gpsObj.valid
          : null;
  const locationReliable = coordsInBounds && explicitReliable !== false;

  const rawConfidence =
    num(
      rawBody.confidence ??
        rawBody.mlConfidence ??
        rawBody.ml_confidence ??
        detectionObj.confidence
    ) ?? 0;
  const mlConfidence =
    rawConfidence > 0 && rawConfidence <= 1
      ? Number((rawConfidence * 100).toFixed(1))
      : Number(Math.max(0, Math.min(100, rawConfidence)).toFixed(1));

  const peakAccelG = Math.max(
    0,
    num(
      rawBody.peakAcceleration ??
        rawBody.peak_acceleration ??
        rawBody.peakAccelG ??
        rawBody.peak_accel_g ??
        sensorObj.peakAcceleration ??
        sensorObj.accelZ
    ) ?? 0
  );
  const rmsVibration = Math.max(
    0,
    num(
      rawBody.vibrationLevel ??
        rawBody.vibration_level ??
        rawBody.rmsVibration ??
        rawBody.rms_vibration ??
        sensorObj.vibrationLevel
    ) ?? 0
  );
  const iriScore = Math.max(
    0,
    num(rawBody.iriScore ?? rawBody.iri_score ?? sensorObj.iriScore) ?? 0
  );
  const speedKmh = Math.max(
    0,
    num(rawBody.speedKmh ?? rawBody.speed_kmh ?? gpsObj.speed ?? rawBody.speed) ?? 0
  );

  const rawArterial = str(rawBody.arterialClass ?? rawBody.arterial_class);
  const arterialClass: PotholeRecord['arterialClass'] =
    rawArterial === 'Highway' ||
    rawArterial === 'Arterial' ||
    rawArterial === 'Collector' ||
    rawArterial === 'Local'
      ? rawArterial
      : 'Arterial';

  const rawEventId =
    str(rawBody.eventId) ||
    str(rawBody.event_id) ||
    str(detectionObj.eventId) ||
    `EVT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const rawTimestamp = str(rawBody.timestamp) || str(rawBody.detectedAt) || str(rawBody.detected_at);
  const parsedDate = rawTimestamp ? new Date(rawTimestamp) : new Date();
  const detectedAtIso = Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString()
    : parsedDate.toISOString();

  return {
    deviceId: deviceId.slice(0, 80),
    eventId: sanitizeFirestoreDocId(rawEventId, 'EVT'),
    condition: rawCondition || 'UNKNOWN',
    isPothole,
    lat: locationReliable ? lat : null,
    lng: locationReliable ? lng : null,
    locationReliable,
    peakAccelG,
    rmsVibration,
    iriScore,
    speedKmh,
    mlConfidence,
    roadName: (
      str(rawBody.roadName) ||
      str(rawBody.road_name) ||
      str(rawBody.locationName) ||
      'GPS Hardware Sector'
    ).slice(0, 160),
    district: (
      str(rawBody.district) ||
      str(rawBody.ward) ||
      str(rawBody.zone) ||
      'Municipal Road Corridor'
    ).slice(0, 120),
    arterialClass,
    manualSos: rawBody.manualSos === true || rawBody.manual_sos === true,
    operatorName: str(rawBody.operatorName ?? rawBody.operator_name)?.slice(0, 120) ?? null,
    firmwareVersion: str(rawBody.firmwareVersion ?? rawBody.firmware_version)?.slice(0, 40) ?? null,
    batteryVoltage: num(rawBody.batteryVoltage ?? rawBody.battery_voltage),
    satellites: num(rawBody.satellites ?? gpsObj.satellites),
    gpsStatus: str(rawBody.gpsStatus ?? rawBody.gps_status ?? gpsObj.status),
    mpu6050Status: str(rawBody.mpu6050Status ?? rawBody.mpu6050_status ?? sensorObj.status),
    detectedAtIso,
  };
}

/**
 * Persists validated LIVE_ESP32 telemetry and device heartbeats directly to
 * Cloud Firestore collections (`devices`, `sensor_detections`, `potholes`,
 * `device_alerts`, `sos_alerts`) using the exact schema consumed by
 * `src/services/liveFirestoreService.ts`.
 */
async function persistLiveEsp32TelemetryToFirestore(
  rawBody: Record<string, unknown>,
  headerDeviceId?: string
): Promise<{
  acceptedIntoPotholeWorkflow: boolean;
  reason: string;
  eventId: string;
  deviceId: string;
  potholeId: string | null;
  alertId: string | null;
  sosAlertId: string | null;
  persistedCollections: string[];
}> {
  if (!adminDb) {
    throw new Error(
      'Cloud Firestore Admin SDK is not initialized on this server instance.'
    );
  }

  const parsed = normalizeIncomingHardwareTelemetry(rawBody, headerDeviceId);
  if (!parsed.deviceId) {
    throw new Error('Missing required deviceId field in hardware payload.');
  }

  const nowIso = new Date().toISOString();
  const deviceDocId = sanitizeFirestoreDocId(parsed.deviceId, 'ESP32');
  const persistedCollections: string[] = [];

  // 1. Always persist live device heartbeat & telemetry update to `/devices/{deviceId}`
  const deviceUpdate: Record<string, unknown> = {
    id: parsed.deviceId,
    deviceId: parsed.deviceId,
    device_id: parsed.deviceId,
    status: 'Online',
    deviceStatus: 'Online',
    lastCommunication: nowIso,
    lastHeartbeat: nowIso,
    lastSeen: nowIso,
    locationReliable: parsed.locationReliable,
    gpsStatus: parsed.gpsStatus ?? (parsed.locationReliable ? '3D Fix' : 'No Fix'),
    mpu6050Status: parsed.mpu6050Status ?? 'Calibrated',
    speedKmh: parsed.speedKmh,
    packetsToday: FieldValue.increment(1),
    detectionCount: FieldValue.increment(1),
    dataSource: 'LIVE_ESP32',
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (parsed.lat !== null && parsed.lng !== null) {
    deviceUpdate.latitude = parsed.lat;
    deviceUpdate.longitude = parsed.lng;
    deviceUpdate.lat = parsed.lat;
    deviceUpdate.lng = parsed.lng;
  }
  if (parsed.firmwareVersion) deviceUpdate.firmwareVersion = parsed.firmwareVersion;
  if (parsed.batteryVoltage !== null) deviceUpdate.batteryVoltage = parsed.batteryVoltage;
  if (parsed.satellites !== null) deviceUpdate.satellites = parsed.satellites;
  if (parsed.manualSos) deviceUpdate.manualSosButtonState = 'Triggered';

  // 2. Evaluate strict pothole-only workflow gate
  const evaluation = evaluateRoadConditionGate(
    {
      condition: parsed.isPothole ? 'Pothole' : ('NonPothole' as TelemetryIngestPayload['condition']),
      mlConfidence: parsed.mlConfidence,
      peakAccelG: parsed.peakAccelG,
    },
    workspace.settings.mlConfidenceCutoffPct,
    workspace.settings.mpu6050TriggerThresholdG
  );

  const batch = adminDb.batch();
  let potholeId: string | null = null;
  let alertId: string | null = null;
  let sosAlertId: string | null = null;

  if (parsed.manualSos) {
    sosAlertId = `SOS-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    batch.set(adminDb.collection('sos_alerts').doc(sosAlertId), {
      id: sosAlertId,
      alertId: sosAlertId,
      eventId: parsed.eventId,
      deviceId: parsed.deviceId,
      type: 'MANUAL_SOS',
      isManualSos: true,
      severity: 'Critical',
      title: `Manual SOS Hardware Button Activated — ${parsed.deviceId}`,
      message: `Physical SOS switch triggered on ESP32 node ${parsed.deviceId} near ${parsed.roadName}.`,
      latitude: parsed.lat,
      longitude: parsed.lng,
      locationReliable: parsed.locationReliable,
      roadName: parsed.roadName,
      operatorName: parsed.operatorName || 'Field Patrol Operator',
      status: 'Active',
      dataSource: 'LIVE_ESP32',
      timestamp: parsed.detectedAtIso,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    persistedCollections.push('sos_alerts');
  }

  if (parsed.isPothole && evaluation.entersPotholeWorkflow) {
    const severity = classifySeverityFromSensor(parsed.peakAccelG, parsed.iriScore);
    const priority = calculatePotholePriority(
      {
        severity,
        peakAccelG: parsed.peakAccelG,
        arterialClass: parsed.arterialClass,
        clusterNeighborCount: 1,
        detectedAt: parsed.detectedAtIso,
      },
      workspace.settings.priorityWeights
    );

    potholeId = parsed.eventId;
    deviceUpdate.potholesDetectedToday = FieldValue.increment(1);

    // Write to `/sensor_detections/{eventId}`
    batch.set(adminDb.collection('sensor_detections').doc(parsed.eventId), {
      eventId: parsed.eventId,
      deviceId: parsed.deviceId,
      classification: 'POTHOLE',
      severity,
      confidence: parsed.mlConfidence,
      latitude: parsed.lat,
      longitude: parsed.lng,
      locationReliable: parsed.locationReliable,
      peakAcceleration: parsed.peakAccelG,
      vibrationLevel: parsed.rmsVibration,
      iriScore: parsed.iriScore,
      speedKmh: parsed.speedKmh,
      roadName: parsed.roadName,
      district: parsed.district,
      detectionSource: 'LIVE_ESP32',
      dataSource: 'LIVE_ESP32',
      timestamp: parsed.detectedAtIso,
      receivedAt: nowIso,
      createdAt: FieldValue.serverTimestamp(),
    });
    persistedCollections.push('sensor_detections');

    // Write to `/potholes/{eventId}` (matches `mapPotholeDoc` in liveFirestoreService.ts)
    batch.set(
      adminDb.collection('potholes').doc(potholeId),
      {
        id: potholeId,
        eventId: parsed.eventId,
        deviceId: parsed.deviceId,
        classification: 'POTHOLE',
        severity,
        status: 'Detected',
        repair_status: 'Detected',
        verified: false,
        latitude: parsed.lat,
        longitude: parsed.lng,
        locationReliable: parsed.locationReliable,
        roadName: parsed.roadName,
        district: parsed.district,
        arterialClass: parsed.arterialClass,
        priorityScore: priority.totalScore,
        priorityTier: priority.tier,
        peakAcceleration: parsed.peakAccelG,
        vibrationLevel: parsed.rmsVibration,
        iriScore: parsed.iriScore,
        speedKmh: parsed.speedKmh,
        confidence: parsed.mlConfidence,
        detectionCount: 1,
        detectionSource: 'LIVE_ESP32',
        dataSource: 'LIVE_ESP32',
        timestamp: parsed.detectedAtIso,
        detectedAt: parsed.detectedAtIso,
        receivedAt: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    persistedCollections.push('potholes');

    if (severity === 'Critical') {
      alertId = `ALT-${parsed.eventId}`;
      batch.set(adminDb.collection('device_alerts').doc(alertId), {
        id: alertId,
        alertId,
        eventId: parsed.eventId,
        potholeId,
        deviceId: parsed.deviceId,
        type: 'CRITICAL_POTHOLE',
        isManualSos: false,
        severity: 'Critical',
        title: `Critical P1 Pothole Detected (${parsed.peakAccelG.toFixed(2)} g) — ${parsed.roadName}`,
        message: `Sensor ${parsed.deviceId} classified a severe pothole (${parsed.mlConfidence.toFixed(1)}% confidence, IRI ${parsed.iriScore.toFixed(1)} m/km).`,
        latitude: parsed.lat,
        longitude: parsed.lng,
        locationReliable: parsed.locationReliable,
        roadName: parsed.roadName,
        status: 'Active',
        dataSource: 'LIVE_ESP32',
        timestamp: parsed.detectedAtIso,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      persistedCollections.push('device_alerts');
    }
  }

  batch.set(adminDb.collection('devices').doc(deviceDocId), deviceUpdate, { merge: true });
  persistedCollections.unshift('devices');

  await batch.commit();

  return {
    acceptedIntoPotholeWorkflow: parsed.isPothole && evaluation.entersPotholeWorkflow,
    reason: parsed.isPothole
      ? evaluation.reason
      : 'Non-pothole telemetry ignored by pothole-only municipal workflow; device heartbeat persisted.',
    eventId: parsed.eventId,
    deviceId: parsed.deviceId,
    potholeId,
    alertId,
    sosAlertId,
    persistedCollections,
  };
}

function refreshSpatialAndPriorities(
  epsMeters = workspace.settings.dbscanDefaultEpsMeters,
  minPts = workspace.settings.dbscanDefaultMinPts,
  h3Resolution = workspace.settings.h3DefaultResolution
) {
  const { clusters, pointClusterMap } = runDbscanClustering(
    workspace.potholes,
    epsMeters,
    minPts
  );
  const h3Cells = generateH3HexGrid(workspace.potholes, h3Resolution);
  const h3Lookup = new Map<string, string>();
  for (const cell of h3Cells) {
    for (const pid of cell.potholeIds) {
      h3Lookup.set(pid, cell.h3Index);
    }
  }

  workspace.potholes = workspace.potholes.map((p) => ({
    ...p,
    clusterId: pointClusterMap.get(p.id) || null,
    h3Index: h3Lookup.get(p.id) || p.h3Index,
  }));

  workspace.potholes = recalculatePotholePriorities(
    workspace.potholes,
    workspace.settings.priorityWeights
  );

  const refreshed = runDbscanClustering(workspace.potholes, epsMeters, minPts);
  workspace.clusters = refreshed.clusters;
  workspace.h3Cells = generateH3HexGrid(workspace.potholes, h3Resolution);
}

function processTelemetryPacket(
  payload: TelemetryIngestPayload,
  enforcedDataSource: 'LIVE_ESP32' | 'SIMULATED_DEMO'
) {
  const now = new Date().toISOString();

  workspace.devices = workspace.devices.map((d) =>
    d.id === payload.deviceId
      ? {
          ...d,
          status: 'Online',
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          speedKmh: Number(payload.speedKmh) || 0,
          packetsToday: (d.packetsToday ?? 0) + 1,
          potholesDetectedToday:
            payload.condition === 'Pothole'
              ? (d.potholesDetectedToday ?? 0) + 1
              : (d.potholesDetectedToday ?? 0),
          lastHeartbeat: now,
          manualSosButtonState: payload.manualSos ? 'Triggered' : d.manualSosButtonState,
        }
      : d
  );

  if (payload.manualSos) {
    const sosNum = 10 + workspace.alerts.filter((a) => a.isManualSos).length;
    const sosAlert: AlertRecord = {
      id: `SOS-2026-${String(sosNum).padStart(3, '0')}`,
      category: 'MANUAL_SOS',
      isManualSos: true,
      severity: 'Critical',
      title: `Manual SOS Hardware Button Activated — ${payload.deviceId}`,
      message: `Independent physical SOS switch triggered on ${payload.deviceId} near ${payload.roadName}.`,
      timestamp: now,
      deviceId: payload.deviceId,
      potholeId: null,
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      roadName: payload.roadName,
      operatorName: payload.operatorName || 'Field Patrol Operator',
      status: 'Active',
      acknowledgedBy: null,
      acknowledgedAt: null,
      dataSource: enforcedDataSource,
    };
    workspace.alerts = [sosAlert, ...workspace.alerts];
  }

  const evaluation = evaluateRoadConditionGate(
    payload,
    workspace.settings.mlConfidenceCutoffPct,
    workspace.settings.mpu6050TriggerThresholdG
  );

  if (!evaluation.entersPotholeWorkflow) {
    return {
      acceptedIntoPotholeWorkflow: false,
      reason: evaluation.reason,
      workspace,
    };
  }

  const severity = classifySeverityFromSensor(payload.peakAccelG, payload.iriScore);
  const nextIdNum = 425 + workspace.potholes.length;
  const priority = calculatePotholePriority(
    {
      severity,
      peakAccelG: payload.peakAccelG,
      arterialClass: payload.arterialClass,
      clusterNeighborCount: 1,
      detectedAt: now,
    },
    workspace.settings.priorityWeights
  );

  const newPothole: PotholeRecord = {
    id: `PTH-2026-${String(nextIdNum).padStart(4, '0')}`,
    roadName: String(payload.roadName).slice(0, 160),
    segmentCode: `SEG-IN-${Math.floor(100 + Math.random() * 899)}`,
    district: String(payload.district).slice(0, 120),
    arterialClass: payload.arterialClass,
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    h3Index: '8928308280fffff',
    clusterId: null,
    classification: 'Pothole',
    severity,
    status: 'Detected',
    priorityScore: priority.totalScore,
    priorityTier: priority.tier,
    detectedAt: now,
    updatedAt: now,
    deviceId: payload.deviceId,
    telemetry: {
      peakAccelG: Number(payload.peakAccelG),
      rmsVibration: Number(payload.rmsVibration),
      iriScore: Number(payload.iriScore),
      durationMs: Math.round(95 + Number(payload.peakAccelG) * 20),
      speedKmh: Number(payload.speedKmh),
      mlConfidence: Number(payload.mlConfidence),
      waveformSample: [
        1.0, 1.02, 0.98, 1.04, 0.97, 1.25,
        Number((payload.peakAccelG * 0.65).toFixed(2)),
        Number(payload.peakAccelG.toFixed(2)),
        Number((-payload.peakAccelG * 0.4).toFixed(2)),
        Number((payload.peakAccelG * 0.3).toFixed(2)),
        1.12, 0.94, 1.03, 0.99, 1.01, 1.0,
      ],
    },
    detectionCount: 1,
    assignedWorkOrderId: null,
    notes:
      enforcedDataSource === 'LIVE_ESP32'
        ? 'Ingested via authenticated ESP32 Hardware Device API.'
        : 'Ingested via DEMO MODE Telemetry Simulator (Simulated).',
    dataSource: enforcedDataSource,
  };

  workspace.potholes = [newPothole, ...workspace.potholes];
  refreshSpatialAndPriorities();

  if (severity === 'Critical') {
    const alert: AlertRecord = {
      id: `ALT-2026-${Math.floor(320 + Math.random() * 600)}`,
      category: 'CRITICAL_POTHOLE',
      isManualSos: false,
      severity: 'Critical',
      title: `Critical P1 Pothole Detected (${payload.peakAccelG.toFixed(2)} g) — ${payload.roadName}`,
      message: `Sensor ${payload.deviceId} classified a severe pothole (${payload.mlConfidence.toFixed(1)}% confidence, IRI ${payload.iriScore.toFixed(1)} m/km).`,
      timestamp: now,
      deviceId: payload.deviceId,
      potholeId: newPothole.id,
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      roadName: payload.roadName,
      operatorName: null,
      status: 'Active',
      acknowledgedBy: null,
      acknowledgedAt: null,
      dataSource: enforcedDataSource,
    };
    workspace.alerts = [alert, ...workspace.alerts];
  }

  return {
    acceptedIntoPotholeWorkflow: true,
    reason: evaluation.reason,
    workspace,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Public health endpoint (no sensitive internals)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      firebaseProjectId: FIREBASE_PROJECT_ID,
      firestoreDatabaseId: FIREBASE_DATABASE_ID,
      firestoreRegion: 'asia-south1',
      firestorePersistenceConfigured: Boolean(adminDb),
      deviceApiKeyConfigured: Boolean(process.env.ESP32_DEVICE_API_KEY),
      mode: 'PRODUCTION_LIVE',
      timestamp: new Date().toISOString(),
    });
  });

  // Public Firebase Web App config hydration (strictly public client config keys only)
  app.get('/api/firebase-config', (_req, res) => {
    const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '';
    const authDomain =
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      process.env.FIREBASE_AUTH_DOMAIN ||
      `${FIREBASE_PROJECT_ID}.firebaseapp.com`;
    res.json({
      apiKey,
      authDomain,
      projectId: FIREBASE_PROJECT_ID,
      storageBucket:
        process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
        process.env.FIREBASE_MESSAGING_SENDER_ID ||
        '',
      appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '',
      databaseId: FIREBASE_DATABASE_ID,
      configured: Boolean(apiKey && FIREBASE_PROJECT_ID),
    });
  });

  // Explicit DEMO MODE sandbox session issuer (isolated from live Firebase Auth)
  app.post('/api/auth/demo-session', (req, res) => {
    const requestedRole = String(req.body?.role || 'Admin') as UserRole;
    const role: UserRole = ALLOWED_ROLES.has(requestedRole)
      ? requestedRole
      : 'Field Maintenance Team';

    const profileMap: Record<UserRole, { uid: string; email: string; name: string }> = {
      Admin: {
        uid: 'demo-admin-01',
        email: 'e.vance@metro-publicworks.gov',
        name: 'Elena Vance, PE',
      },
      'Municipal Officer': {
        uid: 'demo-officer-01',
        email: 's.patel@metro-publicworks.gov',
        name: 'Sanjay Patel',
      },
      'Field Maintenance Team': {
        uid: 'demo-field-01',
        email: 'r.alvarez@metro-publicworks.gov',
        name: 'Raymond Alvarez',
      },
    };

    const chosen = profileMap[role];
    const token = signDemoToken({ ...chosen, role });
    res.json({
      token,
      uid: chosen.uid,
      role,
      authMode: 'demo',
    });
  });

  // Authoritative session introspection (returns server-verified identity & role)
  app.get('/api/auth/me', requireMunicipalAuth, (req: AuthedRequest, res) => {
    const u = req.authUser!;
    res.json({
      uid: u.uid,
      email: u.email,
      emailVerified: u.emailVerified,
      role: u.role,
      status: u.status,
      authMode: u.authMode,
    });
  });

  // Self profile update — explicitly strips role and status so users can NEVER self-escalate
  app.patch('/api/auth/profile', requireMunicipalAuth, (req: AuthedRequest, res) => {
    const u = req.authUser!;
    const fullName = String(req.body?.fullName || '').trim().slice(0, 120);
    const department = String(req.body?.department || '').trim().slice(0, 120);
    const districtScope = String(req.body?.districtScope || '').trim().slice(0, 120);
    const phone = String(req.body?.phone || '').trim().slice(0, 40);

    workspace.users = workspace.users.map((entry) =>
      entry.uid === u.uid || entry.email.toLowerCase() === u.email.toLowerCase()
        ? {
            ...entry,
            fullName: fullName || entry.fullName,
            department: department || entry.department,
            districtScope: districtScope || entry.districtScope,
            phone,
          }
        : entry
    );

    res.json({ ok: true });
  });

  // Explicit DEMO MODE workspace bootstrap (strictly refuses live Firebase sessions so demo data is never shown as real data)
  app.get('/api/workspace', requireMunicipalAuth, (req: AuthedRequest, res) => {
    const caller = req.authUser!;
    if (caller.authMode !== 'demo') {
      return res.status(403).json({
        error:
          'Simulated /api/workspace is restricted to explicit Demo Mode. Live Firebase sessions read directly from Cloud Firestore.',
      });
    }
    const safeUsers =
      caller.role === 'Admin'
        ? workspace.users
        : workspace.users.filter(
            (u) => u.uid === caller.uid || u.email.toLowerCase() === caller.email.toLowerCase()
          );

    return res.json({
      ...workspace,
      settings: {
        ...workspace.settings,
        demoModeEnabled: true,
      },
      users: safeUsers,
    });
  });

  // Update pothole record (Tiered RBAC: Field Team can only update status/notes)
  app.patch(
    '/api/potholes/:id',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer', 'Field Maintenance Team']),
    (req: AuthedRequest, res) => {
      const idx = workspace.potholes.findIndex((p) => p.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Pothole record not found' });
      }
      const caller = req.authUser!;
      const existing = workspace.potholes[idx];
      const patch = req.body as Partial<PotholeRecord>;

      if (caller.role === 'Field Maintenance Team' && patch.severity && patch.severity !== existing.severity) {
        return res.status(403).json({
          error: 'Field Maintenance Team cannot modify pothole severity ratings.',
        });
      }

      const updated: PotholeRecord = {
        ...existing,
        status: patch.status ?? existing.status,
        severity:
          caller.role === 'Field Maintenance Team'
            ? existing.severity
            : (patch.severity ?? existing.severity),
        notes: patch.notes !== undefined ? String(patch.notes).slice(0, 1000) : existing.notes,
        assignedWorkOrderId:
          caller.role !== 'Field Maintenance Team' && patch.assignedWorkOrderId !== undefined
            ? patch.assignedWorkOrderId
            : existing.assignedWorkOrderId,
        updatedAt: new Date().toISOString(),
      };
      workspace.potholes[idx] = updated;
      refreshSpatialAndPriorities();
      return res.json(workspace.potholes[idx]);
    }
  );

  // Recompute DBSCAN & H3 hotspots (Admin & Municipal Officer only)
  app.post(
    '/api/hotspots/recompute',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer']),
    (req, res) => {
      const epsMeters = Math.min(
        2000,
        Math.max(50, Number(req.body?.epsMeters) || workspace.settings.dbscanDefaultEpsMeters)
      );
      const minPts = Math.min(
        20,
        Math.max(2, Number(req.body?.minPts) || workspace.settings.dbscanDefaultMinPts)
      );
      const rawRes = Number(req.body?.h3Resolution);
      const h3Resolution: 8 | 9 | 10 =
        rawRes === 8 || rawRes === 9 || rawRes === 10
          ? rawRes
          : workspace.settings.h3DefaultResolution;

      workspace.settings.dbscanDefaultEpsMeters = epsMeters;
      workspace.settings.dbscanDefaultMinPts = minPts;
      workspace.settings.h3DefaultResolution = h3Resolution;

      refreshSpatialAndPriorities(epsMeters, minPts, h3Resolution);
      res.json({
        clusters: workspace.clusters,
        h3Cells: workspace.h3Cells,
        potholes: workspace.potholes,
      });
    }
  );

  // Create repair work order (Admin & Municipal Officer only)
  app.post(
    '/api/repairs',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer']),
    (req: AuthedRequest, res) => {
      const caller = req.authUser!;
      const body = req.body as Omit<
        RepairWorkOrder,
        'id' | 'createdAt' | 'completedAt' | 'dataSource'
      >;
      const nextNum = 124 + workspace.repairs.length;
      const newOrder: RepairWorkOrder = {
        id: `WO-2026-${nextNum}`,
        title: String(body.title || 'Municipal Asphalt Patch Work Order').slice(0, 180),
        roadName: String(body.roadName || 'Municipal Road Segment').slice(0, 160),
        district: String(body.district || 'Central Civic Ward').slice(0, 120),
        potholeIds: Array.isArray(body.potholeIds) ? body.potholeIds.slice(0, 50) : [],
        clusterId: body.clusterId ?? null,
        priority: body.priority || 'P2',
        status: body.status || 'Queued',
        assignedCrewId: body.assignedCrewId ?? null,
        createdAt: new Date().toISOString(),
        scheduledDate: body.scheduledDate || new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
        slaDeadline: body.slaDeadline || new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        completedAt: null,
        estimatedAsphaltTons: Math.max(0, Number(body.estimatedAsphaltTons) || 2.0),
        estimatedCostUsd: Math.max(0, Number(body.estimatedCostUsd) || 3500),
        notes: String(body.notes || '').slice(0, 1000),
        dataSource: caller.authMode === 'demo' ? 'SIMULATED_DEMO' : 'LIVE_ESP32',
      };

      workspace.repairs = [newOrder, ...workspace.repairs];

      const historyEntry: RepairHistoryRecord = {
        id: `HIST-${String(workspace.repairHistory.length + 1).padStart(3, '0')}`,
        taskId: newOrder.id,
        previousStatus: 'Created',
        newStatus: newOrder.status,
        actorUid: caller.uid,
        actorName: caller.displayName,
        notes: `Work order created by ${caller.role}.`,
        createdAt: new Date().toISOString(),
      };
      workspace.repairHistory = [historyEntry, ...workspace.repairHistory];

      if (newOrder.potholeIds.length > 0) {
        const idSet = new Set(newOrder.potholeIds);
        workspace.potholes = workspace.potholes.map((p) =>
          idSet.has(p.id)
            ? {
                ...p,
                assignedWorkOrderId: newOrder.id,
                status: p.status === 'Detected' || p.status === 'Verified' ? 'Scheduled' : p.status,
                updatedAt: new Date().toISOString(),
              }
            : p
        );
      }

      res.status(201).json({ order: newOrder, potholes: workspace.potholes });
    }
  );

  // Update repair work order (Tiered RBAC + Terminal Completed State Lock + Audit History)
  app.patch(
    '/api/repairs/:id',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer', 'Field Maintenance Team']),
    (req: AuthedRequest, res) => {
      const idx = workspace.repairs.findIndex((r) => r.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Work order not found' });
      }
      const caller = req.authUser!;
      const existing = workspace.repairs[idx];
      const patch = req.body as Partial<RepairWorkOrder>;

      // Terminal State Lock: only Admin can alter a Completed repair task
      if (existing.status === 'Completed' && caller.role !== 'Admin') {
        return res.status(403).json({
          error: 'Completed repair work orders are locked. Only an Admin can reopen or modify them.',
        });
      }

      // Field Maintenance Team cannot reassign crews or alter priority
      if (
        caller.role === 'Field Maintenance Team' &&
        (patch.assignedCrewId !== undefined || patch.priority !== undefined)
      ) {
        return res.status(403).json({
          error: 'Field Maintenance Team can only update repair status and field notes.',
        });
      }

      const nextStatus = patch.status ?? existing.status;

      const updated: RepairWorkOrder = {
        ...existing,
        status: nextStatus,
        assignedCrewId:
          caller.role !== 'Field Maintenance Team' && patch.assignedCrewId !== undefined
            ? patch.assignedCrewId
            : existing.assignedCrewId,
        priority:
          caller.role !== 'Field Maintenance Team'
            ? (patch.priority ?? existing.priority)
            : existing.priority,
        notes: patch.notes !== undefined ? String(patch.notes).slice(0, 1000) : existing.notes,
        completedAt:
          nextStatus === 'Completed'
            ? existing.completedAt || new Date().toISOString()
            : null,
      };

      workspace.repairs[idx] = updated;

      if (nextStatus !== existing.status) {
        workspace.repairHistory = [
          {
            id: `HIST-${String(workspace.repairHistory.length + 1).padStart(3, '0')}`,
            taskId: updated.id,
            previousStatus: existing.status,
            newStatus: nextStatus,
            actorUid: caller.uid,
            actorName: caller.displayName,
            notes: updated.notes || `Status updated by ${caller.role}.`,
            createdAt: new Date().toISOString(),
          },
          ...workspace.repairHistory,
        ];
      }

      if (updated.potholeIds.length > 0) {
        const idSet = new Set(updated.potholeIds);
        workspace.potholes = workspace.potholes.map((p) => {
          if (!idSet.has(p.id)) return p;
          let nextPotholeStatus = p.status;
          if (nextStatus === 'Completed') nextPotholeStatus = 'Repaired';
          else if (nextStatus === 'In Progress' || nextStatus === 'Verification')
            nextPotholeStatus = 'In Progress';
          else if (nextStatus === 'Dispatched' || nextStatus === 'Queued')
            nextPotholeStatus = 'Scheduled';
          return {
            ...p,
            status: nextPotholeStatus,
            updatedAt: new Date().toISOString(),
          };
        });
        refreshSpatialAndPriorities();
      }

      res.json({ order: updated, potholes: workspace.potholes });
    }
  );

  // Update alert / SOS status (Terminal lock on Resolved SOS; Field Team can Acknowledge only)
  app.patch(
    '/api/alerts/:id',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer', 'Field Maintenance Team']),
    (req: AuthedRequest, res) => {
      const idx = workspace.alerts.findIndex((a) => a.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      const caller = req.authUser!;
      const existing = workspace.alerts[idx];
      const status = (req.body?.status as AlertRecord['status']) || 'Acknowledged';

      if (existing.isManualSos && existing.status === 'Resolved' && caller.role !== 'Admin') {
        return res.status(403).json({
          error: 'Resolved SOS alerts are locked. Only Admin can reopen.',
        });
      }

      if (
        existing.isManualSos &&
        status === 'Resolved' &&
        caller.role === 'Field Maintenance Team'
      ) {
        return res.status(403).json({
          error: 'Only Admin or Municipal Officer can mark a Manual SOS alert as Resolved.',
        });
      }

      const updated: AlertRecord = {
        ...existing,
        status,
        acknowledgedBy: status !== 'Active' ? existing.acknowledgedBy || caller.displayName : null,
        acknowledgedAt:
          status !== 'Active' ? existing.acknowledgedAt || new Date().toISOString() : null,
      };
      workspace.alerts[idx] = updated;

      if (updated.isManualSos && status === 'Resolved' && updated.deviceId) {
        workspace.devices = workspace.devices.map((d) =>
          d.id === updated.deviceId ? { ...d, manualSosButtonState: 'Armed' } : d
        );
      }

      res.json(updated);
    }
  );

  // Bulk acknowledge non-SOS notifications
  app.post(
    '/api/alerts/acknowledge-all',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer', 'Field Maintenance Team']),
    (req: AuthedRequest, res) => {
      const caller = req.authUser!;
      const now = new Date().toISOString();
      workspace.alerts = workspace.alerts.map((a) =>
        !a.isManualSos && a.status === 'Active'
          ? { ...a, status: 'Acknowledged', acknowledgedBy: caller.displayName, acknowledgedAt: now }
          : a
      );
      res.json(workspace.alerts);
    }
  );

  // Manual SOS Trigger from Authenticated Municipal Portal (Demo/Field Test)
  app.post(
    '/api/alerts/sos',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer', 'Field Maintenance Team']),
    (req: AuthedRequest, res) => {
      const caller = req.authUser!;
      const { deviceId, roadName, lat, lng, operatorName, message } = req.body as {
        deviceId: string;
        roadName: string;
        lat: number;
        lng: number;
        operatorName: string;
        message?: string;
      };

      const sosNum = 10 + workspace.alerts.filter((a) => a.isManualSos).length;
      const newAlert: AlertRecord = {
        id: `SOS-2026-${String(sosNum).padStart(3, '0')}`,
        category: 'MANUAL_SOS',
        isManualSos: true,
        severity: 'Critical',
        title: `Manual SOS Hardware Button Activated — ${deviceId}`,
        message:
          String(message || '').slice(0, 1000) ||
          `Physical manual SOS push-button pressed on ${deviceId} at ${roadName}. Independent of MPU6050 vibration classifier.`,
        timestamp: new Date().toISOString(),
        deviceId,
        potholeId: null,
        lat: Number(lat) || 37.7765,
        lng: Number(lng) || -122.4162,
        roadName: String(roadName || 'Municipal Patrol Sector').slice(0, 160),
        operatorName: String(operatorName || caller.displayName).slice(0, 120),
        status: 'Active',
        acknowledgedBy: null,
        acknowledgedAt: null,
        dataSource: caller.authMode === 'demo' ? 'SIMULATED_DEMO' : 'LIVE_ESP32',
      };

      workspace.alerts = [newAlert, ...workspace.alerts];
      let matchedDevice: Esp32Device | null = null;
      workspace.devices = workspace.devices.map((d) => {
        if (d.id === deviceId) {
          matchedDevice = {
            ...d,
            manualSosButtonState: 'Triggered',
            lat: newAlert.lat ?? d.lat,
            lng: newAlert.lng ?? d.lng,
            lastHeartbeat: new Date().toISOString(),
          };
          return matchedDevice;
        }
        return d;
      });

      res.status(201).json({ alert: newAlert, device: matchedDevice });
    }
  );

  // ===========================================================================
  // SEPARATE ESP32 HARDWARE DEVICE INGESTION API (X-Device-API-Key ONLY)
  // Completely separated from Municipal User Firebase Authentication!
  // ===========================================================================
  app.post('/api/telemetry/ingest', requireDeviceApiKey, (req, res) => {
    const payload = req.body as TelemetryIngestPayload;
    if (!payload?.deviceId || !payload?.condition) {
      return res.status(400).json({ error: 'Missing required deviceId or condition fields.' });
    }
    const result = processTelemetryPacket(payload, 'LIVE_ESP32');
    return res.status(result.acceptedIntoPotholeWorkflow ? 201 : 200).json({
      acceptedIntoPotholeWorkflow: result.acceptedIntoPotholeWorkflow,
      reason: result.reason,
      dataSource: 'LIVE_ESP32',
    });
  });

  app.post('/api/device/sos', requireDeviceApiKey, (req, res) => {
    const { deviceId, roadName, lat, lng, operatorName } = req.body as {
      deviceId: string;
      roadName?: string;
      lat?: number;
      lng?: number;
      operatorName?: string;
    };
    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId.' });
    }
    const sosNum = 10 + workspace.alerts.filter((a) => a.isManualSos).length;
    const alert: AlertRecord = {
      id: `SOS-2026-${String(sosNum).padStart(3, '0')}`,
      category: 'MANUAL_SOS',
      isManualSos: true,
      severity: 'Critical',
      title: `Hardware Manual SOS Button Triggered — ${deviceId}`,
      message: `Physical SOS switch pressed on ESP32 node ${deviceId}.`,
      timestamp: new Date().toISOString(),
      deviceId,
      potholeId: null,
      lat: Number(lat) || null,
      lng: Number(lng) || null,
      roadName: roadName || 'GPS Hardware Fix',
      operatorName: operatorName || 'Patrol Vehicle Operator',
      status: 'Active',
      acknowledgedBy: null,
      acknowledgedAt: null,
      dataSource: 'LIVE_ESP32',
    };
    workspace.alerts = [alert, ...workspace.alerts];
    return res.status(201).json({ alert });
  });

  // In-app DEMO MODE Telemetry Simulator (strictly forces SIMULATED_DEMO tag)
  app.post(
    '/api/simulator/telemetry',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer', 'Field Maintenance Team']),
    (req, res) => {
      const payload = req.body as TelemetryIngestPayload;
      const result = processTelemetryPacket(payload, 'SIMULATED_DEMO');
      return res.status(result.acceptedIntoPotholeWorkflow ? 201 : 200).json(result);
    }
  );

  // ESP32 device remote commands (OTA strictly Admin-only; ping/calibrate Admin & Municipal Officer)
  app.post(
    '/api/devices/:id/action',
    requireMunicipalAuth,
    requireRoles(['Admin', 'Municipal Officer']),
    (req: AuthedRequest, res) => {
      const caller = req.authUser!;
      const idx = workspace.devices.findIndex((d) => d.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'ESP32 device not found' });
      }
      const action = req.body?.action as 'ping' | 'calibrate' | 'ota';
      if (action === 'ota' && caller.role !== 'Admin') {
        return res.status(403).json({ error: 'Only Admin can push OTA firmware updates.' });
      }

      const existing = workspace.devices[idx];
      const now = new Date().toISOString();
      let updated: Esp32Device = { ...existing, lastHeartbeat: now };

      if (action === 'ping') {
        updated = {
          ...updated,
          status: 'Online',
          gpsFix: existing.gpsFix === 'No Fix' ? '3D Fix' : existing.gpsFix,
          satellites: Math.max(8, existing.satellites ?? 0),
          signalRssi: Math.max(-72, existing.signalRssi ?? -95),
          packetsToday: (existing.packetsToday ?? 0) + 1,
        };
      } else if (action === 'calibrate') {
        updated = {
          ...updated,
          mpu6050Status: 'Calibrated',
          status: existing.status === 'Degraded' ? 'Online' : existing.status,
        };
      } else if (action === 'ota') {
        updated = {
          ...updated,
          firmwareVersion: '2.4.2-mpu-ml',
        };
      }

      workspace.devices[idx] = updated;
      res.json(updated);
    }
  );

  // Register new ESP32 node (Admin only)
  app.post(
    '/api/devices',
    requireMunicipalAuth,
    requireRoles(['Admin']),
    (req: AuthedRequest, res) => {
      const caller = req.authUser!;
      const { id, vehicleLabel, mountType, district, firmwareVersion } = req.body as {
        id: string;
        vehicleLabel: string;
        mountType: Esp32Device['mountType'];
        district: string;
        firmwareVersion: string;
      };
      const newDevice: Esp32Device = {
        id: String(id || `ESP32-NODE-${Math.floor(10 + Math.random() * 89)}`).slice(0, 64),
        vehicleLabel: String(vehicleLabel || 'New Municipal Unit').slice(0, 120),
        mountType: mountType || 'Municipal Patrol Van',
        district: String(district || 'Central Civic Ward').slice(0, 120),
        status: 'Online',
        firmwareVersion: String(firmwareVersion || '2.4.1-mpu-ml').slice(0, 40),
        mpu6050Status: 'Calibrated',
        gpsFix: '3D Fix',
        satellites: 10,
        batteryVoltage: 13.7,
        signalRssi: -64,
        packetsToday: 1,
        potholesDetectedToday: 0,
        lastHeartbeat: new Date().toISOString(),
        lat: 37.7758,
        lng: -122.4148,
        speedKmh: 0,
        manualSosButtonState: 'Armed',
        recentAccelSamples: [
          { t: 'T-12s', ax: 0.01, ay: -0.02, az: 1.0 },
          { t: 'T-10s', ax: -0.01, ay: 0.01, az: 1.01 },
          { t: 'T-8s', ax: 0.02, ay: 0.0, az: 0.99 },
          { t: 'T-6s', ax: 0.0, ay: -0.01, az: 1.02 },
          { t: 'T-4s', ax: -0.02, ay: 0.02, az: 1.0 },
          { t: 'T-2s', ax: 0.01, ay: 0.0, az: 1.01 },
        ],
        dataSource: caller.authMode === 'demo' ? 'SIMULATED_DEMO' : 'LIVE_ESP32',
      };
      workspace.devices = [newDevice, ...workspace.devices];
      res.status(201).json(newDevice);
    }
  );

  // Update system settings & priority weights (Admin only)
  app.patch(
    '/api/settings',
    requireMunicipalAuth,
    requireRoles(['Admin']),
    (req, res) => {
      const patch = req.body as Partial<SystemSettings>;
      workspace.settings = {
        ...workspace.settings,
        ...patch,
        priorityWeights: patch.priorityWeights
          ? { ...workspace.settings.priorityWeights, ...patch.priorityWeights }
          : workspace.settings.priorityWeights,
      };
      refreshSpatialAndPriorities();
      res.json({
        settings: workspace.settings,
        potholes: workspace.potholes,
        clusters: workspace.clusters,
        h3Cells: workspace.h3Cells,
      });
    }
  );

  // Admin-only User & Role Management (strictly blocks self-role modification by non-Admins)
  app.post(
    '/api/users',
    requireMunicipalAuth,
    requireRoles(['Admin']),
    (req, res) => {
      const body = req.body as Omit<MunicipalUser, 'id' | 'lastLogin'>;
      const role: UserRole = ALLOWED_ROLES.has(body.role)
        ? body.role
        : 'Field Maintenance Team';

      const newUser: MunicipalUser = {
        id: `USR-${String(workspace.users.length + 1).padStart(3, '0')}`,
        fullName: String(body.fullName || '').trim().slice(0, 120),
        email: String(body.email || '').trim().slice(0, 200),
        role,
        department: String(body.department || '').trim().slice(0, 120),
        districtScope: String(body.districtScope || '').trim().slice(0, 120),
        phone: String(body.phone || '').trim().slice(0, 40),
        status: body.status === 'Suspended' ? 'Suspended' : 'Active',
        lastLogin: new Date().toISOString(),
      };
      workspace.users = [newUser, ...workspace.users];
      res.status(201).json(newUser);
    }
  );

  app.patch(
    '/api/users/:id/role',
    requireMunicipalAuth,
    requireRoles(['Admin']),
    (req, res) => {
      const idx = workspace.users.findIndex((u) => u.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'User not found' });
      }
      const nextRole = req.body?.role as UserRole;
      if (!ALLOWED_ROLES.has(nextRole)) {
        return res.status(400).json({ error: 'Invalid role. Must be Admin, Municipal Officer, or Field Maintenance Team.' });
      }
      workspace.users[idx] = { ...workspace.users[idx], role: nextRole };
      return res.json(workspace.users[idx]);
    }
  );

  app.patch(
    '/api/users/:id/toggle',
    requireMunicipalAuth,
    requireRoles(['Admin']),
    (req, res) => {
      const idx = workspace.users.findIndex((u) => u.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'User not found' });
      }
      const existing = workspace.users[idx];
      const updated: MunicipalUser = {
        ...existing,
        status: existing.status === 'Active' ? 'Suspended' : 'Active',
      };
      workspace.users[idx] = updated;
      res.json(updated);
    }
  );

  // Return JSON 404 for unmatched /api/* routes instead of serving SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  const distPath = path.resolve(__dirname, 'dist');
  const distIndexPath = path.join(distPath, 'index.html');
  const isDevMode = process.env.NODE_ENV === 'development';
  let hasBuiltFrontend = fs.existsSync(distIndexPath);

  if (!isDevMode && !hasBuiltFrontend) {
    // Safety net: if a container starts production mode before `npm run build` populated dist/,
    // build the Vite frontend automatically instead of crashing with exit code 1.
    try {
      console.log('Production dist/index.html not found; running Vite production build...');
      const { build } = await import('vite');
      await build({
        root: __dirname,
        logLevel: 'warn',
      });
      hasBuiltFrontend = fs.existsSync(distIndexPath);
    } catch (buildErr) {
      console.error('On-demand production frontend build failed:', buildErr);
    }
  }

  let serverMode: 'development' | 'production' = 'production';
  if (isDevMode || !hasBuiltFrontend) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    serverMode = 'development';
  } else {
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(distIndexPath);
    });
    serverMode = 'production';
  }

  const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
  const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `TERRA Track Municipal Road Intelligence server running on http://0.0.0.0:${PORT} [mode: ${serverMode}] (Firebase Project: ${FIREBASE_PROJECT_ID})`
    );
  });

  const handleShutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down TERRA Track server gracefully...`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal error starting TERRA Track server:', err);
  process.exit(1);
});
