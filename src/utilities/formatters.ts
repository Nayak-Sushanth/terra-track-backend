export const NA_LABEL = 'N/A';

export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function displayOrNA(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NA_LABEL;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : NA_LABEL;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return NA_LABEL;
  }
  return trimmed;
}

export function formatCoord(
  value: number | null | undefined,
  axis: 'lat' | 'lng'
): string {
  if (!isValidNumber(value)) return NA_LABEL;
  const dir = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(5)}°${dir}`;
}

export function formatLatLngPair(
  lat: number | null | undefined,
  lng: number | null | undefined
): string {
  if (!isValidNumber(lat) || !isValidNumber(lng)) return NA_LABEL;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function formatShortTimestamp(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string' || !iso.trim()) return NA_LABEL;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NA_LABEL;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string' || !iso.trim()) return NA_LABEL;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return NA_LABEL;
  const diffMs = Date.now() - time;
  if (diffMs < 0) return 'Just now';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatCurrency(amount: number | null | undefined): string {
  if (!isValidNumber(amount)) return NA_LABEL;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatIri(iri: number | null | undefined): string {
  if (!isValidNumber(iri)) return NA_LABEL;
  return `${iri.toFixed(2)} m/km`;
}

export function formatPeakG(peakG: number | null | undefined): string {
  if (!isValidNumber(peakG)) return NA_LABEL;
  return `${peakG.toFixed(2)} g`;
}

export function formatConfidence(confidence: number | null | undefined): string {
  if (!isValidNumber(confidence)) return NA_LABEL;
  return `${confidence.toFixed(1)}%`;
}

export function formatVoltage(voltage: number | null | undefined): string {
  if (!isValidNumber(voltage)) return NA_LABEL;
  return `${voltage.toFixed(2)} V`;
}

export function formatNumberOrNA(
  value: number | null | undefined,
  fractionDigits = 1,
  suffix = ''
): string {
  if (!isValidNumber(value)) return NA_LABEL;
  const formatted = fractionDigits === 0 ? Math.round(value).toString() : value.toFixed(fractionDigits);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

export function hoursUntilDeadline(deadlineIso: string | null | undefined): number | null {
  if (!deadlineIso) return null;
  const diffMs = new Date(deadlineIso).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return null;
  return Math.round(diffMs / 3600000);
}

export function formatUptime(uptimeSeconds: number | null | undefined): string {
  if (!isValidNumber(uptimeSeconds) || uptimeSeconds < 0) return NA_LABEL;
  const totalSec = Math.floor(uptimeSeconds);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
