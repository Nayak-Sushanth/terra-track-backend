import type { UserRole } from '../types';

/**
 * TERRA Track External Node.js Backend API Integration
 *
 * Production/tunnel HTTPS backend: https://kde-planes-sponsorship-motorcycle.trycloudflare.com
 * Can be overridden with a non-localhost HTTPS VITE_BACKEND_API_URL environment variable.
 */
const CLOUDFLARE_BACKEND_API_URL = 'https://kde-planes-sponsorship-motorcycle.trycloudflare.com';

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

function resolveBackendApiBaseUrl(): string {
  const rawEnvUrl =
    typeof import.meta !== 'undefined' && typeof import.meta.env?.VITE_BACKEND_API_URL === 'string'
      ? import.meta.env.VITE_BACKEND_API_URL.trim()
      : '';

  if (rawEnvUrl) {
    try {
      const parsed = new URL(rawEnvUrl);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !isLoopbackHost(parsed.hostname)
      ) {
        return rawEnvUrl.replace(/\/+$/, '');
      }
    } catch {
      // Ignore malformed env value and use configured Cloudflare HTTPS endpoint
    }
  }

  return CLOUDFLARE_BACKEND_API_URL;
}

export const BACKEND_API_BASE_URL = resolveBackendApiBaseUrl();

export type BackendAuthErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR';

export class BackendAuthError extends Error {
  readonly code: BackendAuthErrorCode;
  readonly status: number | null;

  constructor(code: BackendAuthErrorCode, status: number | null, message: string) {
    super(message);
    this.name = 'BackendAuthError';
    this.code = code;
    this.status = status;
  }
}

export interface BackendAdminProfile {
  uid: string;
  email: string;
  fullName: string;
  role: UserRole;
  department: string;
  districtScope: string;
  phone: string;
  status: 'Active' | 'Suspended';
}

function isAdminRoleString(rawRole: string): boolean {
  const normalized = rawRole.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (
    normalized === 'admin' ||
    normalized === 'super_admin' ||
    normalized === 'superadmin' ||
    normalized === 'municipal_admin'
  );
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
  if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
  if (obj.error && typeof obj.error === 'object') {
    const nested = obj.error as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.trim()) {
      return nested.message.trim();
    }
  }
  return null;
}

/**
 * Calls GET {BACKEND_API_BASE_URL}/api/admin/profile with the Firebase ID token
 * in `Authorization: Bearer <token>`.
 *
 * The backend is solely responsible for verifying the token and authorizing admin
 * access. Frontend-supplied or locally stored roles are never trusted.
 */
export async function fetchAdminProfile(
  firebaseIdToken: string,
  expectedUid?: string
): Promise<BackendAdminProfile> {
  if (!firebaseIdToken || !firebaseIdToken.trim()) {
    throw new BackendAuthError(
      'UNAUTHORIZED',
      401,
      'Missing Firebase ID token. Please sign in again.'
    );
  }

  const endpoint = `${BACKEND_API_BASE_URL}/api/admin/profile`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${firebaseIdToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    throw new BackendAuthError(
      'NETWORK_ERROR',
      null,
      isAbort
        ? `Backend connection error: Request to ${BACKEND_API_BASE_URL} timed out. The HTTPS backend endpoint did not respond in time.`
        : `Backend connection error: Unable to reach the TERRA Track HTTPS backend at ${BACKEND_API_BASE_URL}. Please confirm the Cloudflare tunnel and Node.js server are online and allow CORS from this origin.`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let parsedBody: unknown = null;
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      parsedBody = await response.json();
    } else {
      const text = await response.text();
      if (text) {
        try {
          parsedBody = JSON.parse(text);
        } catch {
          parsedBody = { message: text };
        }
      }
    }
  } catch {
    parsedBody = null;
  }

  const serverMessage = extractErrorMessage(parsedBody);

  if (response.status === 401) {
    throw new BackendAuthError(
      'UNAUTHORIZED',
      401,
      serverMessage
        ? `Authentication required (HTTP 401): ${serverMessage}. Please sign in again.`
        : 'Authentication required (HTTP 401): Your session is invalid or expired. Please sign in again.'
    );
  }

  if (response.status === 403) {
    throw new BackendAuthError(
      'FORBIDDEN',
      403,
      serverMessage
        ? `Access denied (HTTP 403): ${serverMessage}`
        : 'Access denied (HTTP 403): Your account is not authorized to access the Municipal Admin Dashboard.'
    );
  }

  if (!response.ok) {
    if (response.status === 502 || response.status === 503 || response.status === 504 || response.status === 530) {
      throw new BackendAuthError(
        'SERVER_ERROR',
        response.status,
        `Backend service unavailable (HTTP ${response.status}) at ${BACKEND_API_BASE_URL}. Please verify the Node.js server and Cloudflare tunnel are running.`
      );
    }
    throw new BackendAuthError(
      'SERVER_ERROR',
      response.status,
      serverMessage
        ? `Backend error (HTTP ${response.status}): ${serverMessage}`
        : `Backend verification failed with HTTP ${response.status} at ${BACKEND_API_BASE_URL}. Please try again.`
    );
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    throw new BackendAuthError(
      'INVALID_RESPONSE',
      response.status,
      'Invalid response received from backend /api/admin/profile endpoint.'
    );
  }

  const root = parsedBody as Record<string, unknown>;
  const record = (
    (root.data && typeof root.data === 'object' ? root.data : null) ||
    (root.admin && typeof root.admin === 'object' ? root.admin : null) ||
    (root.profile && typeof root.profile === 'object' ? root.profile : null) ||
    (root.user && typeof root.user === 'object' ? root.user : null) ||
    root
  ) as Record<string, unknown>;

  const rawStatus = typeof record.status === 'string' ? record.status.trim().toLowerCase() : 'active';
  if (rawStatus === 'suspended' || rawStatus === 'disabled' || rawStatus === 'inactive') {
    throw new BackendAuthError(
      'FORBIDDEN',
      403,
      'Access denied (HTTP 403): Your municipal administrator account is suspended.'
    );
  }

  const returnedUid =
    typeof record.uid === 'string'
      ? record.uid.trim()
      : typeof record.id === 'string'
        ? record.id.trim()
        : '';

  if (expectedUid && returnedUid && returnedUid !== expectedUid) {
    throw new BackendAuthError(
      'UNAUTHORIZED',
      401,
      'Session identity mismatch between Firebase token and backend profile (HTTP 401).'
    );
  }

  const isAdminFlag = record.isAdmin ?? root.isAdmin;
  if (isAdminFlag === false) {
    throw new BackendAuthError(
      'FORBIDDEN',
      403,
      'Access denied (HTTP 403): Administrator privileges are required.'
    );
  }

  const rawRole = typeof record.role === 'string' ? record.role.trim() : '';
  if (rawRole) {
    if (!isAdminRoleString(rawRole)) {
      throw new BackendAuthError(
        'FORBIDDEN',
        403,
        `Access denied (HTTP 403): Backend role "${rawRole}" is not authorized for the Municipal Admin Dashboard.`
      );
    }
  } else if (isAdminFlag !== true && !returnedUid && typeof record.email !== 'string') {
    throw new BackendAuthError(
      'INVALID_RESPONSE',
      response.status,
      'Backend /api/admin/profile response did not include verifiable admin identity.'
    );
  }

  const email = typeof record.email === 'string' ? record.email.trim() : '';
  const fullName =
    (typeof record.fullName === 'string' && record.fullName.trim()) ||
    (typeof record.name === 'string' && record.name.trim()) ||
    (typeof record.displayName === 'string' && record.displayName.trim()) ||
    email ||
    'Municipal Administrator';

  return {
    uid: returnedUid || expectedUid || '',
    email,
    fullName,
    role: 'Admin',
    department:
      (typeof record.department === 'string' && record.department.trim()) ||
      'Municipal Administration',
    districtScope:
      (typeof record.districtScope === 'string' && record.districtScope.trim()) ||
      'All Municipal Districts',
    phone: typeof record.phone === 'string' ? record.phone.trim() : '',
    status: 'Active',
  };
}
