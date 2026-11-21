import React from 'react';
import type {
  AlertStatus,
  DataSourceType,
  PotholeStatus,
  SeverityLevel,
  WorkOrderStatus,
} from '../../types';

export const SeverityBadge: React.FC<{
  severity: SeverityLevel | 'Repaired' | null | undefined;
  rawLabel?: string | null;
  showTier?: boolean;
  pulse?: boolean;
}> = ({ severity, rawLabel, showTier = true, pulse = false }) => {
  if (!severity) {
    return (
      <span className="inline-flex h-5 items-center rounded-full border border-[#CBD5E1] bg-[#E5EAF2] px-2.5 font-mono text-[10.5px] font-bold text-[#52627A] whitespace-nowrap shrink-0">
        {rawLabel && rawLabel.trim() ? rawLabel.trim().toUpperCase() : 'N/A'}
      </span>
    );
  }
  if (severity === 'Critical') {
    return (
      <span className="inline-flex h-5 items-center gap-1.5 rounded-full border border-[#FCA5A5] bg-[#FDECEC] px-2.5 font-mono text-[10.5px] font-bold text-[#DC2626] shadow-[inset_1px_1px_2px_rgba(220,38,38,0.12),1px_1px_3px_rgba(163,177,198,0.28)] whitespace-nowrap shrink-0">
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#DC2626] opacity-75" />
          )}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
        </span>
        {showTier ? 'P1 CRITICAL' : 'CRITICAL'}
      </span>
    );
  }
  if (severity === 'High') {
    return (
      <span className="inline-flex h-5 items-center rounded-full border border-[#FDBA74] bg-[#FEF3E6] px-2.5 font-mono text-[10.5px] font-bold text-[#C2410C] shadow-[1px_1px_3px_rgba(163,177,198,0.26)] whitespace-nowrap shrink-0">
        {showTier ? 'P2 HIGH' : 'HIGH'}
      </span>
    );
  }
  if (severity === 'Moderate') {
    return (
      <span className="inline-flex h-5 items-center rounded-full border border-[#FCD34D] bg-[#FEF9E3] px-2.5 font-mono text-[10.5px] font-bold text-[#9A5B04] shadow-[1px_1px_3px_rgba(163,177,198,0.24)] whitespace-nowrap shrink-0">
        {showTier ? 'P3 MODERATE' : 'MODERATE'}
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-[#86EFAC] bg-[#E8F8EE] px-2.5 font-mono text-[10.5px] font-bold text-[#15803D] shadow-[1px_1px_3px_rgba(163,177,198,0.24)] whitespace-nowrap shrink-0">
      REPAIRED
    </span>
  );
};

export const PotholeStatusBadge: React.FC<{
  status: PotholeStatus | null | undefined;
  rawLabel?: string | null;
}> = ({ status, rawLabel }) => {
  if (!status) {
    return (
      <span className="inline-flex h-5 items-center rounded-full border border-[#CBD5E1] bg-[#E5EAF2] px-2.5 font-mono text-[10.5px] font-semibold text-[#52627A] whitespace-nowrap shrink-0">
        {rawLabel && rawLabel.trim() ? rawLabel.trim() : 'N/A'}
      </span>
    );
  }
  const styles: Record<PotholeStatus, string> = {
    Detected: 'border-[#CBD5E1] bg-[#E5EAF2] text-[#334155]',
    Verified: 'border-[#93C5FD] bg-[#E7F0FD] text-[#2857C8]',
    Scheduled: 'border-[#C4B5FD] bg-[#EFEAFA] text-[#6D28D9]',
    'In Progress': 'border-[#5EEAD4] bg-[#E3F5F4] text-[#0F766E]',
    Repaired: 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]',
  };

  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2.5 font-mono text-[10.5px] font-semibold shadow-[1px_1px_2px_rgba(163,177,198,0.22)] whitespace-nowrap shrink-0 ${styles[status]}`}
    >
      {status}
    </span>
  );
};

export const WorkOrderStatusBadge: React.FC<{ status: WorkOrderStatus }> = ({ status }) => {
  const styles: Record<WorkOrderStatus, string> = {
    Queued: 'border-[#CBD5E1] bg-[#E5EAF2] text-[#475569]',
    Dispatched: 'border-[#93C5FD] bg-[#E7F0FD] text-[#2857C8]',
    'In Progress': 'border-[#FDBA74] bg-[#FEF3E6] text-[#C2410C]',
    Verification: 'border-[#5EEAD4] bg-[#E3F5F4] text-[#0F766E]',
    Completed: 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]',
  };
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2.5 font-mono text-[10.5px] font-semibold shadow-[1px_1px_2px_rgba(163,177,198,0.22)] whitespace-nowrap shrink-0 ${styles[status]}`}
    >
      {status}
    </span>
  );
};

export const AlertStatusBadge: React.FC<{ status: AlertStatus }> = ({ status }) => {
  const styles: Record<AlertStatus, string> = {
    Active: 'border-[#FCA5A5] bg-[#FDECEC] text-[#DC2626]',
    Acknowledged: 'border-[#FDBA74] bg-[#FEF3E6] text-[#C2410C]',
    Resolved: 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]',
  };
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2.5 font-mono text-[10.5px] font-bold shadow-[1px_1px_2px_rgba(163,177,198,0.22)] whitespace-nowrap shrink-0 ${styles[status]}`}
    >
      {status}
    </span>
  );
};

export const VerificationBadge: React.FC<{
  verified: boolean | null | undefined;
  showWhenNull?: boolean;
}> = ({ verified, showWhenNull = true }) => {
  if (verified === true) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-full border border-[#86EFAC] bg-[#E8F8EE] px-2 font-mono text-[10px] font-bold text-[#15803D] shadow-[1px_1px_2px_rgba(163,177,198,0.22)] whitespace-nowrap shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
        Verified
      </span>
    );
  }
  if (verified === false) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-full border border-[#FCA5A5] bg-[#FDECEC] px-2 font-mono text-[10px] font-bold text-[#DC2626] shadow-[1px_1px_2px_rgba(163,177,198,0.22)] whitespace-nowrap shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
        Not Verified
      </span>
    );
  }
  if (!showWhenNull) return null;
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-[#CBD5E1] bg-[#E5EAF2] px-2 font-mono text-[10px] font-semibold text-[#52627A] whitespace-nowrap shrink-0">
      N/A
    </span>
  );
};

export const DataSourceTag: React.FC<{ source: DataSourceType; compact?: boolean }> = ({
  source,
  compact = false,
}) => {
  if (source === 'LIVE_ESP32') {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-lg border border-[#99F6E4] bg-[#E3F5F4] px-2 font-mono text-[10px] font-semibold text-[#0F766E] shadow-[inset_1px_1px_2px_rgba(15,118,110,0.08)] whitespace-nowrap shrink-0">
        {compact ? 'LIVE ESP32' : 'LIVE ESP32 SENSOR'}
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-lg neu-inset-sm px-2 font-mono text-[10px] font-semibold text-[#52627A] whitespace-nowrap shrink-0">
      {compact ? 'DEMO SIM' : 'SIMULATED DEMO'}
    </span>
  );
};
