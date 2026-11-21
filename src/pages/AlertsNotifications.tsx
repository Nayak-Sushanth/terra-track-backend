import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  Bell,
  CheckCheck,
  MapPin,
  Radio,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { MetricTile } from '../components/common/MetricTile';
import { Modal } from '../components/common/Modal';
import {
  AlertStatusBadge,
  DataSourceTag,
  SeverityBadge,
} from '../components/common/Badges';
import {
  displayOrNA,
  formatLatLngPair,
  formatRelativeTime,
  formatShortTimestamp,
} from '../utilities/formatters';
import type {
  AlertCategory,
  AlertRecord,
  AlertStatus,
  TerraWorkspaceState,
} from '../types';

interface AlertsNotificationsProps {
  workspace: TerraWorkspaceState;
  onUpdateAlertStatus: (id: string, status: AlertStatus) => Promise<void>;
  onAcknowledgeAll: () => Promise<void>;
  onTriggerManualSos: (payload: {
    deviceId: string;
    roadName: string;
    lat: number;
    lng: number;
    operatorName: string;
    message?: string;
  }) => Promise<void>;
  onLocateCoordOnMap: (lat: number, lng: number) => void;
}

export const AlertsNotifications: React.FC<AlertsNotificationsProps> = ({
  workspace,
  onUpdateAlertStatus,
  onAcknowledgeAll,
  onTriggerManualSos,
  onLocateCoordOnMap,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'All' | Exclude<AlertCategory, 'MANUAL_SOS'>>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | AlertStatus>('All');
  const [sosModalOpen, setSosModalOpen] = useState(false);

  // Manual SOS test simulator form (Demo Mode only)
  const [sosDeviceId, setSosDeviceId] = useState(workspace.devices[0]?.id || 'ESP32-VAN-01');
  const [sosRoadName, setSosRoadName] = useState('MG Road Emergency Pullout, Bengaluru');
  const [sosOperator, setSosOperator] = useState('Municipal Patrol Unit');
  const [sosMessage, setSosMessage] = useState('');
  const [submittingSos, setSubmittingSos] = useState(false);

  const manualSosEvents = useMemo(
    () => workspace.alerts.filter((a) => a.isManualSos),
    [workspace.alerts]
  );

  const activeSosEvents = useMemo(
    () => manualSosEvents.filter((a) => a.status !== 'Resolved'),
    [manualSosEvents]
  );

  const automatedNotifications = useMemo(
    () =>
      workspace.alerts.filter((a) => {
        if (a.isManualSos) return false;
        if (categoryFilter !== 'All' && a.category !== categoryFilter) return false;
        if (statusFilter !== 'All' && a.status !== statusFilter) return false;
        return true;
      }),
    [workspace.alerts, categoryFilter, statusFilter]
  );

  const handleSubmitTestSos = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSos(true);
    try {
      const dev = workspace.devices.find((d) => d.id === sosDeviceId);
      await onTriggerManualSos({
        deviceId: sosDeviceId,
        roadName: sosRoadName,
        lat: dev?.lat ?? 12.9716,
        lng: dev?.lng ?? 77.5946,
        operatorName: sosOperator,
        message:
          sosMessage ||
          `Simulated physical manual SOS push-button event on ${sosDeviceId} near ${sosRoadName}.`,
      });
      setSosMessage('');
      setSosModalOpen(false);
    } finally {
      setSubmittingSos(false);
    }
  };

  const categoryLabel = (cat: AlertCategory) => {
    const map: Record<AlertCategory, string> = {
      MANUAL_SOS: 'Manual SOS Button',
      CRITICAL_POTHOLE: 'Eligible Pothole Alert',
      HOTSPOT_THRESHOLD: 'Hotspot Threshold',
      SLA_BREACH: 'SLA Warning',
      DEVICE_FAULT: 'ESP32 / Sensor Fault',
    };
    return map[cat];
  };

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Active Manual SOS Events"
          value={activeSosEvents.length}
          delta="Independent Physical Button"
          deltaTone={activeSosEvents.length > 0 ? 'negative' : 'positive'}
          subtext={`${manualSosEvents.length} total logged`}
        />
        <MetricTile
          label="Unacknowledged System Alerts"
          value={workspace.alerts.filter((a) => !a.isManualSos && a.status === 'Active').length}
          delta="Deduplicated Alert Feed"
          deltaTone="neutral"
        />
        <MetricTile
          label="Eligible Pothole Alerts"
          value={workspace.alerts.filter((a) => a.category === 'CRITICAL_POTHOLE').length}
          delta="Synced from potholes"
          deltaTone="negative"
        />
        <MetricTile
          label="ESP32 Hardware Alerts"
          value={workspace.alerts.filter((a) => a.category === 'DEVICE_FAULT' && a.status !== 'Resolved').length}
          delta="Synced from device_alerts"
          deltaTone="telemetry"
        />
      </div>

      {/* CHANNEL 1: Independent Physical Manual SOS Emergency Channel */}
      <section className="neu-sos-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DC2626]/20 bg-[#FEE2E2]/55 px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FEE2E2] shadow-[inset_2px_2px_5px_rgba(220,38,38,0.18),inset_-2px_-2px_5px_rgba(255,255,255,0.8)]">
              <ShieldAlert className="h-4.5 w-4.5 text-[#DC2626]" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-[#991B1B]">
                Independent Manual SOS Emergency Channel
              </h2>
              <p className="text-[12px] text-[#7F1D1D]">
                Triggered exclusively by the physical manual SOS push-button on ESP32 patrol units
                — decoupled from MPU6050 vibration ML classification.
              </p>
            </div>
          </div>
          {!workspace.isLiveFirestore && (
            <button
              type="button"
              onClick={() => setSosModalOpen(true)}
              className="neu-btn-danger inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Radio className="h-3.5 w-3.5" />
              Trigger Test Manual SOS (Demo)
            </button>
          )}
        </div>

        <div className="divide-y divide-[#DC2626]/15">
          {manualSosEvents.length === 0 ? (
            <div className="bg-[#EEF2F7]/80 py-8 text-center text-[12px] text-[#718096]">
              No manual SOS emergency alerts recorded.
            </div>
          ) : (
            manualSosEvents.map((sos: AlertRecord) => (
              <div
                key={sos.id}
                className={`flex flex-col gap-3 px-4 py-3.5 transition-colors lg:flex-row lg:items-center lg:justify-between ${
                  sos.status === 'Active' ? 'bg-[#FEF2F2]/70' : 'bg-[#EEF2F7]/85'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-bold text-[#DC2626]">
                      {sos.id}
                    </span>
                    <AlertStatusBadge status={sos.status} />
                    <DataSourceTag source={sos.dataSource} compact />
                    <span className="font-mono text-[11px] text-[#718096]">
                      {formatShortTimestamp(sos.timestamp)} ({formatRelativeTime(sos.timestamp)})
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold text-[#17243A]">{sos.title}</div>
                  <p className="text-[12px] text-[#334155]">{sos.message}</p>
                  <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-[#52627A]">
                    <span>Node: {displayOrNA(sos.deviceId)}</span>
                    <span>Operator: {displayOrNA(sos.operatorName)}</span>
                    <span>GPS: {formatLatLngPair(sos.lat, sos.lng)}</span>
                    {sos.acknowledgedBy && <span>Handled by: {sos.acknowledgedBy}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {sos.lat !== null && sos.lng !== null && (
                    <button
                      type="button"
                      onClick={() => onLocateCoordOnMap(sos.lat as number, sos.lng as number)}
                      className="neu-btn inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium cursor-pointer"
                    >
                      <MapPin className="h-3.5 w-3.5 text-[#DC2626]" />
                      Locate Unit
                    </button>
                  )}
                  {sos.status === 'Active' && (
                    <button
                      type="button"
                      onClick={() => onUpdateAlertStatus(sos.id, 'Acknowledged')}
                      className="neu-btn-primary inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold cursor-pointer"
                    >
                      Acknowledge & Dispatch
                    </button>
                  )}
                  {sos.status !== 'Resolved' && (
                    <button
                      type="button"
                      onClick={() => onUpdateAlertStatus(sos.id, 'Resolved')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[11px] border border-[#86EFAC] bg-[#E8F8EE] px-3 text-[12px] font-semibold text-[#15803D] shadow-[3px_3px_7px_rgba(163,177,198,0.42),-3px_-3px_7px_rgba(255,255,255,0.85)] transition-all hover:bg-[#DCFCE7] active:shadow-[inset_2px_2px_5px_rgba(21,128,61,0.2)] cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Resolve & Re-Arm
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* CHANNEL 2: Automated Road Intelligence & Telemetry Notifications */}
      <section className="neu-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b neu-divider bg-[#E3E8F1]/45 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl neu-inset-sm">
              <Bell className="h-4 w-4 text-[#356AE6]" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-[#17243A]">
                Automated Road Hazard & Device Alerts
              </h2>
              <p className="text-[11px] text-[#718096]">
                Deduplicated real-time alerts from Firestore `device_alerts` and eligible `potholes`
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(
                  e.target.value as 'All' | Exclude<AlertCategory, 'MANUAL_SOS'>
                )
              }
              className="neu-input h-8 px-2.5 text-[12px]"
            >
              <option value="All">All Categories</option>
              <option value="CRITICAL_POTHOLE">Eligible Pothole Alerts</option>
              <option value="HOTSPOT_THRESHOLD">Hotspot Thresholds</option>
              <option value="SLA_BREACH">SLA Warnings</option>
              <option value="DEVICE_FAULT">ESP32 Hardware Faults</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | AlertStatus)}
              className="neu-input h-8 px-2.5 text-[12px]"
            >
              <option value="All">All States</option>
              <option value="Active">Active</option>
              <option value="Acknowledged">Acknowledged</option>
              <option value="Resolved">Resolved</option>
            </select>
            <button
              type="button"
              onClick={onAcknowledgeAll}
              className="neu-btn inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium cursor-pointer"
            >
              <CheckCheck className="h-3.5 w-3.5 text-[#356AE6]" />
              Acknowledge All
            </button>
          </div>
        </div>

        <div className="divide-y divide-[rgba(163,177,198,0.28)]">
          {automatedNotifications.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-col gap-2.5 px-4 py-3.5 transition-colors hover:bg-[#F5F8FC]/75 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold text-[#17243A]">
                    {alert.eventId ?? alert.id}
                  </span>
                  {alert.severity !== 'Info' && (
                    <SeverityBadge severity={alert.severity} showTier={false} />
                  )}
                  <AlertStatusBadge status={alert.status} />
                  <span className="font-mono text-[11px] text-[#52627A]">
                    {categoryLabel(alert.category)}
                  </span>
                  <span className="font-mono text-[11px] text-[#718096]">
                    · {formatRelativeTime(alert.timestamp)}
                  </span>
                </div>
                <div className="text-[13px] font-semibold text-[#17243A]">{alert.title}</div>
                <div className="text-[12px] text-[#52627A]">{alert.message}</div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#718096]">
                  <span>Device: {displayOrNA(alert.deviceId)}</span>
                  <span>Time: {formatShortTimestamp(alert.timestamp)}</span>
                  {alert.sourceCollection && <span>Collection: /{alert.sourceCollection}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {alert.lat !== null && alert.lng !== null && (
                  <button
                    type="button"
                    onClick={() => onLocateCoordOnMap(alert.lat as number, alert.lng as number)}
                    className="neu-btn inline-flex h-7 items-center gap-1 px-2.5 text-[11px] font-medium text-[#356AE6] cursor-pointer"
                  >
                    <MapPin className="h-3 w-3" />
                    Map
                  </button>
                )}
                {alert.status === 'Active' && (
                  <button
                    type="button"
                    onClick={() => onUpdateAlertStatus(alert.id, 'Acknowledged')}
                    className="neu-btn h-7 px-2.5 text-[11px] font-semibold cursor-pointer"
                  >
                    Acknowledge
                  </button>
                )}
                {alert.status !== 'Resolved' && (
                  <button
                    type="button"
                    onClick={() => onUpdateAlertStatus(alert.id, 'Resolved')}
                    className="h-7 rounded-[10px] bg-[#17243A] px-3 text-[11px] font-semibold text-white shadow-[3px_3px_7px_rgba(23,36,58,0.28),-2px_-2px_6px_rgba(255,255,255,0.75)] transition-all hover:bg-[#233452] active:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.4)] cursor-pointer"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
          {automatedNotifications.length === 0 && (
            <div className="py-10 text-center text-[12px] text-[#718096]">
              No automated notifications match the selected category and status filters.
            </div>
          )}
        </div>
      </section>

      {/* Trigger Manual SOS Modal */}
      <Modal
        open={sosModalOpen}
        onClose={() => setSosModalOpen(false)}
        title="Simulate Physical Manual SOS Button Press (DEMO MODE)"
        subtitle="Creates an independent SOS emergency alert decoupled from road vibration ML events."
        footer={
          <>
            <button
              type="button"
              onClick={() => setSosModalOpen(false)}
              className="neu-btn h-8 px-3.5 text-[12px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="manual-sos-form"
              disabled={submittingSos}
              className="neu-btn-danger inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold cursor-pointer disabled:opacity-60"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {submittingSos ? 'Dispatching SOS...' : 'Dispatch Manual SOS'}
            </button>
          </>
        }
      >
        <form id="manual-sos-form" onSubmit={handleSubmitTestSos} className="space-y-3.5">
          <div>
            <label className="label-caps block text-[#52627A]">ESP32 Patrol Unit</label>
            <select
              value={sosDeviceId}
              onChange={(e) => setSosDeviceId(e.target.value)}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            >
              {workspace.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} — {displayOrNA(d.vehicleLabel)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Location Description</label>
            <input
              required
              type="text"
              value={sosRoadName}
              onChange={(e) => setSosRoadName(e.target.value)}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Field Operator Name</label>
            <input
              required
              type="text"
              value={sosOperator}
              onChange={(e) => setSosOperator(e.target.value)}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Emergency Details (Optional)</label>
            <textarea
              rows={2}
              value={sosMessage}
              onChange={(e) => setSosMessage(e.target.value)}
              placeholder="e.g., Roadway sinkhole collapse blocking two lanes; requesting immediate barrier crew."
              className="neu-input mt-1.5 w-full p-2.5 text-[12px]"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
