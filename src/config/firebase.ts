import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';

declare const __TERRA_FIREBASE_PUBLIC_CONFIG__: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId: string;
};

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId: string;
}

export const FIRESTORE_COLLECTIONS = {
  // Primary Live Pothole & ESP32 Telemetry Collections
  potholes: 'potholes',
  sensorDetections: 'sensor_detections',
  devices: 'devices',
  deviceAlerts: 'device_alerts',
  // Operational & Municipal RBAC Collections
  users: 'users',
  potholeEvents: 'pothole_events',
  potholeClusters: 'pothole_clusters',
  municipalZones: 'municipal_zones',
  maintenanceTeams: 'maintenance_teams',
  repairTasks: 'repair_tasks',
  repairHistory: 'repair_history',
  sosAlerts: 'sos_alerts',
  notifications: 'notifications',
} as const;

export const FIREBASE_INTEGRATION_CONTRACT = {
  projectId: 'terra-track-53004',
  region: 'asia-south1',
  databaseId: '(default)',
  collections: FIRESTORE_COLLECTIONS,
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let cachedConfig: FirebasePublicConfig | null = null;
let firebaseAppInstance: FirebaseApp | null = null;
let firebaseAuthInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let persistenceConfigured = false;

function readBuildTimePublicConfig(): FirebasePublicConfig {
  const fromDefine =
    typeof __TERRA_FIREBASE_PUBLIC_CONFIG__ !== 'undefined'
      ? __TERRA_FIREBASE_PUBLIC_CONFIG__
      : null;
  const metaEnv =
    typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string>);

  return {
    apiKey: metaEnv.VITE_FIREBASE_API_KEY || fromDefine?.apiKey || '',
    authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || fromDefine?.authDomain || '',
    projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || fromDefine?.projectId || 'terra-track-53004',
    storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || fromDefine?.storageBucket || '',
    messagingSenderId:
      metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || fromDefine?.messagingSenderId || '',
    appId: metaEnv.VITE_FIREBASE_APP_ID || fromDefine?.appId || '',
    databaseId: metaEnv.VITE_FIREBASE_DATABASE_ID || fromDefine?.databaseId || '(default)',
  };
}

export function isFirebasePublicConfigComplete(cfg: FirebasePublicConfig | null): boolean {
  return Boolean(cfg && cfg.apiKey && cfg.projectId);
}

/**
 * Hydrates public Firebase Web SDK configuration from build-time env vars or
 * the backend `/api/firebase-config` route (public client keys only).
 * Strictly guards against duplicate `initializeApp()` calls.
 */
export async function ensureFirebaseInitialized(): Promise<{
  ready: boolean;
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  config: FirebasePublicConfig;
  missingFields: string[];
}> {
  if (!cachedConfig) {
    cachedConfig = readBuildTimePublicConfig();
  }

  // If browser env vars weren't bundled with VITE_ prefix, check runtime server public config
  if (!isFirebasePublicConfigComplete(cachedConfig) && typeof window !== 'undefined') {
    try {
      const resp = await fetch('/api/firebase-config');
      if (resp.ok) {
        const runtimeCfg = (await resp.json()) as Partial<FirebasePublicConfig>;
        cachedConfig = {
          apiKey: runtimeCfg.apiKey || cachedConfig.apiKey,
          authDomain: runtimeCfg.authDomain || cachedConfig.authDomain,
          projectId: runtimeCfg.projectId || cachedConfig.projectId || 'terra-track-53004',
          storageBucket: runtimeCfg.storageBucket || cachedConfig.storageBucket,
          messagingSenderId:
            runtimeCfg.messagingSenderId || cachedConfig.messagingSenderId,
          appId: runtimeCfg.appId || cachedConfig.appId,
          databaseId: runtimeCfg.databaseId || cachedConfig.databaseId || '(default)',
        };
      }
    } catch {
      // Ignore network fallback error; handled cleanly via missingFields
    }
  }

  const missingFields: string[] = [];
  if (!cachedConfig.apiKey) missingFields.push('VITE_FIREBASE_API_KEY');
  if (!cachedConfig.projectId) missingFields.push('VITE_FIREBASE_PROJECT_ID');

  if (!isFirebasePublicConfigComplete(cachedConfig)) {
    return {
      ready: false,
      app: null,
      auth: null,
      db: null,
      config: cachedConfig,
      missingFields,
    };
  }

  if (!firebaseAppInstance) {
    const firebaseOptions: Record<string, string> = {
      apiKey: cachedConfig.apiKey,
      authDomain:
        cachedConfig.authDomain || `${cachedConfig.projectId}.firebaseapp.com`,
      projectId: cachedConfig.projectId,
    };
    if (cachedConfig.storageBucket) {
      firebaseOptions.storageBucket = cachedConfig.storageBucket;
    }
    if (cachedConfig.messagingSenderId) {
      firebaseOptions.messagingSenderId = cachedConfig.messagingSenderId;
    }
    if (cachedConfig.appId) {
      firebaseOptions.appId = cachedConfig.appId;
    }

    firebaseAppInstance =
      getApps().length > 0 ? getApp() : initializeApp(firebaseOptions);
  }

  if (!firebaseAuthInstance) {
    firebaseAuthInstance = getAuth(firebaseAppInstance);
  }

  if (!persistenceConfigured && typeof window !== 'undefined') {
    persistenceConfigured = true;
    setPersistence(firebaseAuthInstance, browserLocalPersistence).catch((err) => {
      console.warn('Firebase Auth persistence fallback:', err);
    });
  }

  if (!firestoreInstance) {
    const dbId = cachedConfig.databaseId;
    firestoreInstance =
      dbId && dbId !== '(default)'
        ? getFirestore(firebaseAppInstance, dbId)
        : getFirestore(firebaseAppInstance);
  }

  return {
    ready: true,
    app: firebaseAppInstance,
    auth: firebaseAuthInstance,
    db: firestoreInstance,
    config: cachedConfig,
    missingFields,
  };
}

export function getFirebaseAuthInstance(): Auth | null {
  return firebaseAuthInstance;
}

export function getFirestoreInstance(): Firestore | null {
  return firestoreInstance;
}

export function getLoadedFirebaseConfig(): FirebasePublicConfig {
  return cachedConfig || readBuildTimePublicConfig();
}

/**
 * Startup connectivity validation using `getDocFromServer` per Firebase guidelines.
 * Distinguishes live reachable Firestore (including expected permission-denied on
 * unauthenticated default-deny rules) from offline or misconfigured states.
 */
export async function testFirestoreConnection(): Promise<{
  status: 'connected' | 'offline' | 'unconfigured' | 'error';
  message: string;
  projectId: string;
}> {
  const init = await ensureFirebaseInitialized();
  if (!init.ready || !init.db) {
    return {
      status: 'unconfigured',
      message: `Missing Firebase Web config: ${init.missingFields.join(', ')}`,
      projectId: init.config.projectId,
    };
  }

  try {
    await getDocFromServer(doc(init.db, 'test', 'connection'));
    return {
      status: 'connected',
      message: `Connected to Cloud Firestore (${init.config.projectId} / ${init.config.databaseId})`,
      projectId: init.config.projectId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline') || msg.includes('offline')) {
      console.error('Please check your Firebase configuration:', msg);
      return {
        status: 'offline',
        message: 'Firestore client is offline. Verify project ID, network access, and API key.',
        projectId: init.config.projectId,
      };
    }
    if (msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
      // Reaching Firestore rules engine confirms live server connectivity!
      return {
        status: 'connected',
        message: `Connected to Cloud Firestore (${init.config.projectId} / ${init.config.databaseId}) — security rules active.`,
        projectId: init.config.projectId,
      };
    }
    return {
      status: 'error',
      message: msg,
      projectId: init.config.projectId,
    };
  }
}

/**
 * Structured Firestore Error Handler per Firebase guidelines.
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = firebaseAuthInstance?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function getFirebaseReadinessSummary() {
  const cfg = getLoadedFirebaseConfig();
  const configured = isFirebasePublicConfigComplete(cfg);
  return {
    firestoreConfigured: configured,
    authConfigured: configured,
    projectId: cfg.projectId || 'terra-track-53004',
    region: 'asia-south1',
    databaseId: cfg.databaseId || '(default)',
    activePersistenceMode: configured
      ? 'Firebase Auth + Cloud Firestore (with DEMO Sandbox)'
      : 'Node.js API (DEMO MODE — Firebase Env Pending)',
    collectionsCount: Object.keys(FIRESTORE_COLLECTIONS).length,
  };
}
