/**
 * TERRA Track — Firebase Connectivity, Security Rules & Backend RBAC Verification Suite
 *
 * Verifies:
 * 1. Firestore security rules structural & Eight-Pillar invariants across all 10 collections.
 * 2. Live Firebase SDK singleton init, Firebase Auth Email/Password reachability, and live
 *    Cloud Firestore connectivity (`terra-track-53004`, `asia-south1`, `(default)`).
 * 3. Live backend RBAC authorization for Admin, Municipal Officer, and Field Maintenance Team.
 * 4. Unauthenticated request denial, frontend role-spoofing resistance, terminal state locks,
 *    and strict separation of ESP32 Device API auth (`X-Device-API-Key`) from municipal user auth.
 *
 * Run with: npx tsx firestore.rules.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, passed: true, detail: 'PASS' });
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, detail: msg });
    console.error(`  [FAIL] ${name} -> ${msg}`);
  }
}

async function apiFetch(
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const resp = await fetch(`${BASE_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await resp.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

async function main() {
  console.log('\n=== 1. Firestore Rules Static Invariant Checks ===');
  const rulesText = fs.readFileSync(RULES_PATH, 'utf-8');

  await runTest('Rules specify rules_version = 2 and default-deny catch-all', () => {
    assert.match(rulesText, /rules_version\s*=\s*'2'/);
    assert.match(
      rulesText,
      /match\s*\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/
    );
    assert.doesNotMatch(rulesText, /allow\s+read,\s*write:\s*if\s+true/);
  });

  const requiredCollections = [
    'users',
    'devices',
    'pothole_events',
    'pothole_clusters',
    'municipal_zones',
    'maintenance_teams',
    'repair_tasks',
    'repair_history',
    'sos_alerts',
    'notifications',
  ];

  await runTest('All 10 Firestore collections have explicit match rules', () => {
    for (const col of requiredCollections) {
      const pattern = new RegExp(`match\\s+\\/${col}\\/\\{[a-zA-Z0-9_]+\\}`);
      assert.match(rulesText, pattern, `Missing explicit match rule for /${col}`);
    }
  });

  await runTest('Self-role escalation is explicitly blocked on /users/{userId}', () => {
    assert.match(rulesText, /incoming\(\)\.role\s*==\s*'Field Maintenance Team'/);
    assert.match(rulesText, /incoming\(\)\.role\s*==\s*existing\(\)\.role/);
  });

  await runTest('Repair history is immutable (update and delete denied)', () => {
    const startIdx = rulesText.indexOf('match /repair_history/');
    assert.ok(startIdx > 0, 'repair_history block not found');
    const historyBlock = rulesText.slice(startIdx, startIdx + 900);
    assert.match(historyBlock, /allow\s+update,\s*delete:\s*if\s+false;/);
  });

  await runTest('Terminal state locks enforce Completed / Resolved immutability', () => {
    assert.match(rulesText, /existing\(\)\.status\s*!=\s*'Completed'/);
    assert.match(rulesText, /existing\(\)\.status\s*!=\s*'Resolved'/);
  });

  await runTest('Client Firestore writes cannot spoof LIVE_ESP32 records on pothole_events/sos_alerts', () => {
    assert.match(rulesText, /incoming\(\)\.dataSource\s*==\s*'SIMULATED_DEMO'/);
  });

  console.log('\n=== 2. Live Firebase SDK, Auth & Cloud Firestore Connectivity ===');

  const cfgResp = await apiFetch('/api/firebase-config');
  const cfg = (cfgResp.json || {}) as Record<string, string | boolean>;

  await runTest('Runtime Firebase public config is present for terra-track-53004', () => {
    assert.equal(cfgResp.status, 200);
    assert.equal(cfg.projectId, 'terra-track-53004');
    assert.equal(Boolean(cfg.apiKey), true);
    assert.equal(Boolean(cfg.configured), true);
  });

  await runTest('Firebase SDK initializes strictly once (singleton guard)', () => {
    const options: Record<string, string> = {
      apiKey: String(cfg.apiKey),
      authDomain: String(cfg.authDomain || 'terra-track-53004.firebaseapp.com'),
      projectId: String(cfg.projectId),
    };
    if (cfg.storageBucket) options.storageBucket = String(cfg.storageBucket);
    if (cfg.messagingSenderId) options.messagingSenderId = String(cfg.messagingSenderId);
    if (cfg.appId) options.appId = String(cfg.appId);

    const app1 = getApps().length > 0 ? getApp() : initializeApp(options);
    const app2 = getApps().length > 0 ? getApp() : initializeApp(options);
    assert.equal(getApps().length, 1);
    assert.strictEqual(app1, app2);
    assert.equal(app1.options.projectId, 'terra-track-53004');
  });

  await runTest('Firebase Auth (Email/Password) is live and reachable on terra-track-53004', async () => {
    const auth = getAuth(getApp());
    let authCode = '';
    try {
      await signInWithEmailAndPassword(
        auth,
        'nonexistent-probe@terra-track.invalid',
        'InvalidProbePass123!'
      );
    } catch (err: unknown) {
      authCode = (err as { code?: string })?.code || '';
    }
    assert.ok(
      authCode === 'auth/invalid-credential' ||
        authCode === 'auth/user-not-found' ||
        authCode === 'auth/wrong-password',
      `Unexpected Firebase Auth response code: ${authCode}`
    );
  });

  await runTest('Cloud Firestore (default) is reachable and enforces unauthenticated denial', async () => {
    const db = getFirestore(getApp());
    let fsCode = '';
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      // If rules were open in test mode, reaching server without offline error still proves connectivity,
      // but we expect permission-denied once hardened rules are active.
      fsCode = 'allowed';
    } catch (err: unknown) {
      fsCode = (err as { code?: string })?.code || String(err);
    }
    assert.equal(
      fsCode,
      'permission-denied',
      `Expected Firestore to respond with permission-denied for unauthenticated read, got: ${fsCode}`
    );
  });

  console.log('\n=== 3. Live Backend Auth, RBAC & Separate Device API Checks ===');

  await runTest('GET /api/health returns service metadata without exposing secrets', async () => {
    const { status, json } = await apiFetch('/api/health');
    assert.equal(status, 200);
    assert.equal(json?.status, 'ok');
    assert.equal(json?.firebaseProjectId, 'terra-track-53004');
  });

  await runTest('Unauthenticated request to /api/workspace is rejected with 401', async () => {
    const { status } = await apiFetch('/api/workspace');
    assert.equal(status, 401);
  });

  await runTest('Unauthenticated request to /api/auth/me is rejected with 401', async () => {
    const { status } = await apiFetch('/api/auth/me');
    assert.equal(status, 401);
  });

  await runTest('Invalid Bearer token is rejected with 401', async () => {
    const { status } = await apiFetch('/api/workspace', {
      token: 'forged.jwt.token',
    });
    assert.equal(status, 401);
  });

  // Acquire signed DEMO tokens for all 3 roles
  const demoField = await apiFetch('/api/auth/demo-session', {
    method: 'POST',
    body: { role: 'Field Maintenance Team' },
  });
  const demoOfficer = await apiFetch('/api/auth/demo-session', {
    method: 'POST',
    body: { role: 'Municipal Officer' },
  });
  const demoAdmin = await apiFetch('/api/auth/demo-session', {
    method: 'POST',
    body: { role: 'Admin' },
  });

  const fieldToken = String(demoField.json?.token || '');
  const officerToken = String(demoOfficer.json?.token || '');
  const adminToken = String(demoAdmin.json?.token || '');

  await runTest('Signed DEMO sessions issued for all 3 roles', () => {
    assert.equal(demoField.status, 200);
    assert.equal(demoOfficer.status, 200);
    assert.equal(demoAdmin.status, 200);
    assert.ok(fieldToken.startsWith('demo.'));
    assert.ok(officerToken.startsWith('demo.'));
    assert.ok(adminToken.startsWith('demo.'));
  });

  await runTest('Backend ignores spoofed X-User-Role header for Field Maintenance Team', async () => {
    const { status, json } = await apiFetch('/api/auth/me', {
      token: fieldToken,
      headers: { 'X-User-Role': 'Admin' },
    });
    assert.equal(status, 200);
    assert.equal(json?.role, 'Field Maintenance Team');
  });

  await runTest('Field Maintenance Team cannot self-escalate role via /api/auth/profile', async () => {
    const patchResp = await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      token: fieldToken,
      body: { fullName: 'Field Lead Updated', role: 'Admin', districtScope: 'Central Core' },
    });
    assert.equal(patchResp.status, 200);

    const meResp = await apiFetch('/api/auth/me', { token: fieldToken });
    assert.equal(meResp.status, 200);
    assert.equal(meResp.json?.role, 'Field Maintenance Team');
  });

  await runTest('Field Maintenance Team is denied (403) from creating users, changing roles, or updating settings', async () => {
    const r1 = await apiFetch('/api/users', {
      method: 'POST',
      token: fieldToken,
      body: { name: 'Attacker', email: 'atk@city.gov', role: 'Admin', district: 'North' },
    });
    const r2 = await apiFetch('/api/users/USR-001/role', {
      method: 'PATCH',
      token: fieldToken,
      body: { role: 'Admin' },
    });
    const r3 = await apiFetch('/api/settings', {
      method: 'PATCH',
      token: fieldToken,
      body: { dbscanDefaultEpsMeters: 50 },
    });
    const r4 = await apiFetch('/api/repairs', {
      method: 'POST',
      token: fieldToken,
      body: { title: 'Unauthorized WO', roadName: 'Test Rd', district: 'North' },
    });
    assert.equal(r1.status, 403);
    assert.equal(r2.status, 403);
    assert.equal(r3.status, 403);
    assert.equal(r4.status, 403);
  });

  await runTest('Field Maintenance Team can update repair status/notes but cannot edit Completed work orders', async () => {
    const allowed = await apiFetch('/api/repairs/WO-2026-118', {
      method: 'PATCH',
      token: fieldToken,
      body: { status: 'In Progress', notes: 'Crew on-site patching verified.' },
    });
    assert.equal(allowed.status, 200);

    const terminalBlocked = await apiFetch('/api/repairs/WO-2026-115', {
      method: 'PATCH',
      token: fieldToken,
      body: { status: 'In Progress', notes: 'Trying to reopen completed WO' },
    });
    assert.equal(terminalBlocked.status, 403);
  });

  await runTest('Municipal Officer can recompute hotspots & create work orders, but cannot change system settings or user roles', async () => {
    const allowed = await apiFetch('/api/hotspots/recompute', {
      method: 'POST',
      token: officerToken,
      body: { epsMeters: 150, minPts: 3 },
    });
    assert.equal(allowed.status, 200);

    const settingsDenied = await apiFetch('/api/settings', {
      method: 'PATCH',
      token: officerToken,
      body: { autoDispatchThreshold: 80 },
    });
    const roleDenied = await apiFetch('/api/users/USR-003/role', {
      method: 'PATCH',
      token: officerToken,
      body: { role: 'Admin' },
    });
    assert.equal(settingsDenied.status, 403);
    assert.equal(roleDenied.status, 403);
  });

  await runTest('Admin can update system settings and read full workspace', async () => {
    const ws = await apiFetch('/api/workspace', { token: adminToken });
    assert.equal(ws.status, 200);

    const settingsAllowed = await apiFetch('/api/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { autoDispatchThreshold: 76 },
    });
    assert.equal(settingsAllowed.status, 200);
  });

  await runTest('ESP32 Device API (/api/telemetry/ingest) rejects municipal user Bearer tokens without X-Device-API-Key', async () => {
    const resp = await apiFetch('/api/telemetry/ingest', {
      method: 'POST',
      token: adminToken,
      body: {
        deviceId: 'ESP32-V01',
        lat: 12.9716,
        lng: 77.5946,
        rmsVibration: 1.9,
        peakAccelG: 3.1,
        condition: 'Pothole',
        mlConfidence: 92,
      },
    });
    assert.ok(
      resp.status === 401 || resp.status === 503,
      `Expected 401 or 503 for device route without X-Device-API-Key, got ${resp.status}`
    );
  });

  await runTest('ESP32 Device SOS API (/api/device/sos) rejects municipal user Bearer tokens without X-Device-API-Key', async () => {
    const resp = await apiFetch('/api/device/sos', {
      method: 'POST',
      token: adminToken,
      body: {
        deviceId: 'ESP32-V01',
        lat: 12.9716,
        lng: 77.5946,
      },
    });
    assert.ok(
      resp.status === 401 || resp.status === 503,
      `Expected 401 or 503 for device SOS route without X-Device-API-Key, got ${resp.status}`
    );
  });

  const failed = results.filter((r) => !r.passed);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
