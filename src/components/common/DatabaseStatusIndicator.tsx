import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  ShieldAlert,
  WifiOff,
  X,
} from 'lucide-react';
import { formatRelativeTime, formatShortTimestamp } from '../../utilities/formatters';
import type { DatabaseConnectionStatus, LiveCollectionSyncState } from '../../types';

interface DatabaseStatusIndicatorProps {
  syncState: LiveCollectionSyncState;
  onReconnect?: () => void;
}

const STATUS_META: Record<
  DatabaseConnectionStatus,
  {
    label: string;
    pillClass: string;
    dotClass: string;
  }
> = {
  CONNECTED: {
    label: 'CONNECTED',
    pillClass: 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]',
    dotClass: 'bg-[#16A34A]',
  },
  CONNECTING: {
    label: 'CONNECTING',
    pillClass: 'border-[#93C5FD] bg-[#E7F0FD] text-[#2857C8]',
    dotClass: 'bg-[#356AE6]',
  },
  DISCONNECTED: {
    label: 'DISCONNECTED',
    pillClass: 'border-[#FDBA74] bg-[#FEF3E6] text-[#C2410C]',
    dotClass: 'bg-[#EA580C]',
  },
  PERMISSION_ERROR: {
    label: 'PERMISSION ERROR',
    pillClass: 'border-[#FCA5A5] bg-[#FDECEC] text-[#DC2626]',
    dotClass: 'bg-[#DC2626]',
  },
  ERROR: {
    label: 'ERROR',
    pillClass: 'border-[#FCA5A5] bg-[#FDECEC] text-[#DC2626]',
    dotClass: 'bg-[#DC2626]',
  },
};

export const DatabaseStatusIndicator: React.FC<DatabaseStatusIndicatorProps> = ({
  syncState,
  onReconnect,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const meta = STATUS_META[syncState.connectionStatus] || STATUS_META.CONNECTING;
  const coreCollections = Object.values(syncState.collections).filter((c) => c.required);
  const optionalCollections = Object.values(syncState.collections).filter((c) => !c.required);

  const renderIcon = () => {
    if (syncState.connectionStatus === 'CONNECTING') {
      return <Loader2 className="h-3 w-3 animate-spin shrink-0" />;
    }
    if (syncState.connectionStatus === 'CONNECTED') {
      return <CheckCircle2 className="h-3 w-3 shrink-0" />;
    }
    if (syncState.connectionStatus === 'DISCONNECTED') {
      return <WifiOff className="h-3 w-3 shrink-0" />;
    }
    if (syncState.connectionStatus === 'PERMISSION_ERROR') {
      return <ShieldAlert className="h-3 w-3 shrink-0" />;
    }
    return <AlertTriangle className="h-3 w-3 shrink-0" />;
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 font-mono text-[10.5px] font-bold shadow-[2px_2px_6px_rgba(163,177,198,0.32),-2px_-2px_5px_rgba(255,255,255,0.8)] transition-all whitespace-nowrap shrink-0 cursor-pointer ${meta.pillClass}`}
        title={`Cloud Firestore (${syncState.projectId} / ${syncState.databaseId}) — ${meta.label}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
        {renderIcon()}
        <span className="hidden md:inline">DB:</span>
        <span>{meta.label}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-[650] w-[340px] rounded-2xl border border-white/80 bg-[#EEF2F7] p-4 shadow-[10px_10px_24px_rgba(23,36,58,0.18),-6px_-6px_14px_rgba(255,255,255,0.85)] text-left">
          <div className="flex items-start justify-between gap-2 border-b neu-divider pb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg neu-inset-sm">
                <Database className="h-3.5 w-3.5 text-[#356AE6]" />
              </div>
              <div>
                <div className="text-[12px] font-bold text-[#17243A]">
                  Cloud Firestore Real-Time Sync
                </div>
                <div className="font-mono text-[10px] text-[#718096]">
                  {syncState.projectId} · {syncState.databaseId}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="neu-btn flex h-6 w-6 items-center justify-center text-[#52627A]"
              aria-label="Close database diagnostics"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 neu-inset-sm space-y-1.5 p-2.5 font-mono text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#718096]">Status</span>
              <span className="font-bold text-[#17243A]">{meta.label}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#718096]">Last Sync</span>
              <span className="font-semibold text-[#17243A]">
                {syncState.lastSyncedAt
                  ? `${formatShortTimestamp(syncState.lastSyncedAt)} (${formatRelativeTime(syncState.lastSyncedAt)})`
                  : 'Waiting for snapshot...'}
              </span>
            </div>
            {syncState.fromCache && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#718096]">Source</span>
                <span className="font-semibold text-[#C2410C]">Local Cache (Offline)</span>
              </div>
            )}
          </div>

          {syncState.lastError && (
            <div className="mt-2.5 rounded-xl border border-[#FCA5A5] bg-[#FDECEC] p-2.5 font-mono text-[10.5px] leading-relaxed text-[#991B1B]">
              <div className="font-bold">Last Database Error</div>
              <div className="mt-0.5 break-words">{syncState.lastError}</div>
            </div>
          )}

          <div className="mt-3">
            <div className="label-caps mb-1.5 text-[#718096]">
              Core Live Collections ({coreCollections.filter((c) => c.status === 'connected').length}/
              {coreCollections.length})
            </div>
            <div className="space-y-1 font-mono text-[10.5px]">
              {coreCollections.map((col) => (
                <div
                  key={col.name}
                  className="flex items-center justify-between rounded-lg bg-[#E4E9F2]/65 px-2.5 py-1"
                >
                  <span className="font-semibold text-[#17243A] truncate">{col.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[#52627A]">{col.docCount} docs</span>
                    <span
                      className={`font-bold uppercase ${
                        col.status === 'connected'
                          ? 'text-[#15803D]'
                          : col.status === 'connecting'
                            ? 'text-[#2857C8]'
                            : col.status === 'offline'
                              ? 'text-[#C2410C]'
                              : 'text-[#DC2626]'
                      }`}
                    >
                      {col.status === 'permission-denied' ? 'DENIED' : col.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {optionalCollections.length > 0 && (
            <div className="mt-2.5 flex items-center justify-between font-mono text-[10px] text-[#718096]">
              <span>Operational Collections</span>
              <span>
                {optionalCollections.filter((c) => c.status === 'connected').length}/
                {optionalCollections.length} active
              </span>
            </div>
          )}

          {onReconnect && (
            <div className="mt-3 border-t neu-divider pt-2.5">
              <button
                type="button"
                onClick={() => {
                  onReconnect();
                }}
                className="neu-btn inline-flex h-8 w-full items-center justify-center gap-1.5 text-[11px] font-semibold text-[#17243A] hover:text-[#356AE6] cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-[#356AE6]" />
                Reconnect Firestore Listeners
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
