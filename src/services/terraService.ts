import { terraApiClient } from '../api/client';
import { getFirebaseReadinessSummary } from '../config/firebase';
import { createInitialDemoWorkspace } from '../data/demoData';
import type { TerraWorkspaceState } from '../types';

/**
 * Unified TERRA Track Data Service
 *
 * Bridges the authenticated Express backend (with RBAC enforcement) and
 * Firebase Cloud Firestore readiness while preserving isolated DEMO MODE.
 */

export async function loadInitialWorkspace(): Promise<{
  data: TerraWorkspaceState;
  backendConnected: boolean;
  persistenceLabel: string;
}> {
  const readiness = getFirebaseReadinessSummary();
  try {
    const data = await terraApiClient.getWorkspace();
    return {
      data,
      backendConnected: true,
      persistenceLabel: readiness.firestoreConfigured
        ? 'Firebase Firestore + Node.js RBAC API'
        : 'Node.js API (DEMO MODE)',
    };
  } catch {
    return {
      data: createInitialDemoWorkspace(),
      backendConnected: false,
      persistenceLabel: 'Local Demo Fallback',
    };
  }
}

export { terraApiClient };
export * as firestoreService from './firestoreService';

