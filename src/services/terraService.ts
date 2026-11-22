import { terraApiClient } from '../api/client';
import { createInitialDemoWorkspace } from '../data/demoData';
import type { TerraWorkspaceState } from '../types';

/**
 * Isolated DEMO MODE Workspace Loader
 *
 * Production sessions read exclusively from real-time Cloud Firestore via
 * `useFirestoreWorkspace` / `liveFirestoreService.ts` and never call this loader.
 */
export async function loadInitialWorkspace(): Promise<{
  data: TerraWorkspaceState;
  backendConnected: boolean;
  persistenceLabel: string;
}> {
  try {
    const data = await terraApiClient.getWorkspace();
    return {
      data: {
        ...data,
        settings: {
          ...data.settings,
          demoModeEnabled: true,
        },
      },
      backendConnected: true,
      persistenceLabel: 'Isolated Demo Sandbox API',
    };
  } catch {
    return {
      data: createInitialDemoWorkspace(),
      backendConnected: false,
      persistenceLabel: 'Isolated Local Demo Sandbox',
    };
  }
}

export { terraApiClient };
export * as firestoreService from './firestoreService';

