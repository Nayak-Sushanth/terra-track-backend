import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  AlertTriangle,
  Cpu,
  Radio,
  Wrench,
  UploadCloud,
  Plus,
  MapPin,
  Satellite,
  BatteryCharging,
  Wifi,
} from 'lucide-react';
import { MetricTile } from '../components/common/MetricTile';
import { Modal } from '../components/common/Modal';
import { DataSourceTag } from '../components/common/Badges';
import {
  displayOrNA,
  formatLatLngPair,
  formatRelativeTime,
  formatShortTimestamp,
  formatUptime,
  formatVoltage,
} from '../utilities/formatters';
import type { Esp32Device, TerraWorkspaceState } from '../types';

interface DeviceManagementProps {
  workspace: TerraWorkspaceState;
  onDeviceAction: (id: string, action: 'ping' | 'calibrate' | 'ota') => Promise<void>;
  onRegisterDevice: (payload: {
    id: string;
    vehicleLabel: string;
    mountType: Esp32Device['mountType'];
    district: string;
    firmwareVersion: string;
  }) => Promise<void>;
  onLocateCoordOnMap: (lat: number, lng: number) => void;
}

export const DeviceManagement: React.FC<DeviceManagementProps> = ({
  workspace,
  onDeviceAction,
  onRegisterDevice,
  onLocateCoordOnMap,
}) => {
  const [statusFilter, setStatusFilter] = useState<'All' | 'Online' | 'Degraded' | 'Offline'>('All');
  const [selectedId, setSelectedId] = useState<string>(workspace.devices[0]?.id || '');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  // Register device form state
  const [newNodeId, setNewNodeId] = useState('');
  const [newVehicle, setNewVehicle] = useState('');
  const [newMount, setNewMount] = useState<Esp32Device['mountType']>('Municipal Patrol Van');
  const [newDistrict, setNewDistrict] = useState('Bengaluru Central');
  const [newFirmware, setNewFirmware] = useState('2.4.1-mpu-ml');

  const filteredDevices = useMemo(
    () =>
      workspace.devices.filter((d) =>
        statusFilter === 'All' ? true : d.status === statusFilter
      ),
    [workspace.devices, statusFilter]
  );

  const selectedDevice = useMemo(
    () =>
      workspace.devices.find((d) => d.id === selectedId) ||
      filteredDevices[0] ||
      null,
    [workspace.devices, selectedId, filteredDevices]
  );

  const onlineCount = workspace.devices.filter((d) => d.status === 'Online').length;
  const healthWarningDevicesCount = workspace.devices.filter(
    (d) => (d.healthWarnings?.length ?? 0) > 0 || d.gpsFix === 'No Fix' || d.mpu6050Status === 'Fault'
  ).length;

  const totalPackets = useMemo(() => {
    const valid = workspace.devices
      .map((d) => d.packetsToday)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0);
  }, [workspace.devices]);

  const avgSats = useMemo(() => {
    const active = workspace.devices.filter(
      (d) => typeof d.satellites === 'number' && Number.isFinite(d.satellites) && d.satellites > 0
    );
    if (active.length === 0) return null;
    return (
      active.reduce((s, d) => s + (d.satellites as number), 0) / active.length
    ).toFixed(1);
  }, [workspace.devices]);

  const handleRunAction = async (action: 'ping' | 'calibrate' | 'ota') => {
    if (!selectedDevice) return;
    setActionBusy(action);
    setActionFeedback(null);
    try {
      await onDeviceAction(selectedDevice.id, action);
      const label =
        action === 'ping'
          ? `Heartbeat ping acknowledged by ${selectedDevice.id}.`
          : action === 'calibrate'
            ? `MPU6050 6-axis zero-offset calibrated on ${selectedDevice.id}.`
            : `OTA firmware v2.4.2-mpu-ml staged and applied to ${selectedDevice.id}.`;
      setActionFeedback(label);
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Action unavailable for this device.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onRegisterDevice({
      id: newNodeId.trim() || `ESP32-VAN-${10 + workspace.devices.length}`,
      vehicleLabel: newVehicle.trim() || 'Municipal Fleet Unit',
      mountType: newMount,
      district: newDistrict,
      firmwareVersion: newFirmware,
    });
    setNewNodeId('');
    setNewVehicle('');
    setRegisterOpen(false);
  };

  const hasDeviceCoords = (dev: Esp32Device): boolean =>
    typeof dev.lat === 'number' &&
    typeof dev.lng === 'number' &&
    Number.isFinite(dev.lat) &&
    Number.isFinite(dev.lng) &&
    !(dev.lat === 0 && dev.lng === 0);

  return (
    <div className="space-y-5">
      {/* Fleet KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Online ESP32 Nodes"
          value={`${onlineCount} / ${workspace.devices.length}`}
          delta={`${workspace.devices.filter((d) => d.status === 'Degraded').length} degraded · ${workspace.devices.filter((d) => d.status === 'Offline').length} offline`}
          deltaTone="telemetry"
        />
        <MetricTile
          label="Device Health Warnings"
          value={healthWarningDevicesCount}
          delta={healthWarningDevicesCount > 0 ? 'GPS / MPU6050 Fault' : 'All Sensors Nominal'}
          deltaTone={healthWarningDevicesCount > 0 ? 'negative' : 'positive'}
        />
        <MetricTile
          label="Avg GPS Satellite Lock"
          value={avgSats !== null ? `${avgSats} sats` : 'N/A'}
          delta="NEO-6M/8M GNSS"
          deltaTone="positive"
        />
        <MetricTile
          label="MPU6050 Packets Ingested"
          value={totalPackets !== null ? totalPackets.toLocaleString() : 'N/A'}
          delta={`${workspace.devices.filter((d) => d.mpu6050Status === 'Calibrated').length} / ${workspace.devices.length} IMU healthy`}
          deltaTone="neutral"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="neu-tab-track inline-flex flex-wrap items-center gap-1">
          {(['All', 'Online', 'Degraded', 'Offline'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`h-7 px-3 text-[12px] font-semibold cursor-pointer ${
                statusFilter === st ? 'neu-tab-active' : 'neu-tab-inactive'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {!workspace.isLiveFirestore && (
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="neu-btn-primary inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Register ESP32 Node
          </button>
        )}
      </div>

      {/* Fleet Table + Selected Hardware Diagnostics Panel */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7 neu-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="h-10 border-b neu-divider bg-[#E3E8F1]/65 text-[#52627A]">
                  <th className="label-caps px-3">Device ID</th>
                  <th className="label-caps px-3">Status</th>
                  <th className="label-caps px-3">GPS Status</th>
                  <th className="label-caps px-3">MPU6050</th>
                  <th className="label-caps px-3 text-right">Battery</th>
                  <th className="label-caps px-3">Firmware</th>
                  <th className="label-caps px-3 text-right">Last Comm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
                {filteredDevices.map((dev) => {
                  const isSelected = selectedDevice?.id === dev.id;
                  const warnings = dev.healthWarnings ?? [];
                  const gpsDisplay = dev.rawGpsStatus ?? dev.gpsFix ?? 'N/A';
                  const mpuDisplay = dev.rawMpu6050Status ?? dev.mpu6050Status ?? 'N/A';
                  const statusDisplay = dev.rawStatus ?? dev.status ?? 'N/A';
                  const gpsFault = dev.gpsFix === 'No Fix';
                  const mpuFault =
                    dev.mpu6050Status === 'Fault' || dev.mpu6050Status === 'Drift Warning';

                  return (
                    <tr
                      key={dev.id}
                      onClick={() => {
                        setSelectedId(dev.id);
                        setActionFeedback(null);
                      }}
                      className={`h-12 cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#356AE6]/10' : 'hover:bg-[#F5F8FC]/80'
                      }`}
                    >
                      <td className="px-3">
                        <div className="flex items-center gap-1.5 font-mono font-semibold text-[#17243A]">
                          <span>{dev.id}</span>
                          {warnings.length > 0 && (
                            <span
                              title={warnings.join(' · ')}
                              className="inline-flex items-center gap-0.5 rounded-full border border-[#FCA5A5] bg-[#FEECEC] px-1.5 py-0.5 text-[9px] font-bold text-[#DC2626]"
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {warnings.length}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#718096]">
                          {displayOrNA(dev.vehicleLabel)}
                        </div>
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 font-mono text-[10px] font-semibold shadow-[inset_1px_1px_2px_rgba(255,255,255,0.75)] ${
                            dev.status === 'Online'
                              ? 'border-[#5EEAD4] bg-[#E6FAF7] text-[#0F8B8D]'
                              : dev.status === 'Degraded'
                                ? 'border-[#FDBA74] bg-[#FFF4E6] text-[#EA580C]'
                                : dev.status === 'Offline'
                                  ? 'border-[#FCA5A5] bg-[#FEECEC] text-[#B91C1C]'
                                  : 'border-[#CBD5E1] bg-[#E9EDF3] text-[#52627A]'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              dev.status === 'Online'
                                ? 'bg-[#0F8B8D]'
                                : dev.status === 'Degraded'
                                  ? 'bg-[#EA580C]'
                                  : dev.status === 'Offline'
                                    ? 'bg-[#DC2626]'
                                    : 'bg-[#64748B]'
                            }`}
                          />
                          {statusDisplay}
                        </span>
                      </td>
                      <td className="px-3 font-mono text-[11px] whitespace-nowrap">
                        <span
                          className={
                            gpsFault
                              ? 'font-bold text-[#DC2626]'
                              : dev.gpsFix === '3D Fix'
                                ? 'font-medium text-[#15803D]'
                                : 'text-[#52627A]'
                          }
                        >
                          {gpsDisplay}
                        </span>
                        {dev.satellites !== null && (
                          <span className="ml-1 text-[#718096]">({dev.satellites})</span>
                        )}
                      </td>
                      <td className="px-3 font-mono text-[11px] whitespace-nowrap">
                        <span
                          className={
                            mpuFault
                              ? 'font-bold text-[#DC2626]'
                              : dev.mpu6050Status === 'Calibrated'
                                ? 'font-medium text-[#15803D]'
                                : 'text-[#52627A]'
                          }
                        >
                          {mpuDisplay}
                        </span>
                      </td>
                      <td className="px-3 text-right font-mono text-[11px] text-[#334155] whitespace-nowrap">
                        {formatVoltage(dev.batteryVoltage)}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-[#334155] whitespace-nowrap">
                        {displayOrNA(dev.firmwareVersion)}
                      </td>
                      <td className="px-3 text-right font-mono text-[11px] text-[#718096] whitespace-nowrap">
                        {formatRelativeTime(dev.lastHeartbeat)}
                      </td>
                    </tr>
                  );
                })}
                {filteredDevices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#718096]">
                      No ESP32 devices found in Cloud Firestore matching the active status filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Node Hardware Diagnostics */}
        <div className="xl:col-span-5 neu-card p-4 space-y-4">
          {selectedDevice ? (
            <>
              <div className="flex items-start justify-between gap-2 border-b neu-divider pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg neu-inset-sm">
                      <Cpu className="h-4 w-4 text-[#0F8B8D]" />
                    </div>
                    <span className="font-mono text-[14px] font-bold text-[#17243A]">
                      {selectedDevice.id}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-[#52627A]">
                    {displayOrNA(selectedDevice.vehicleLabel)} ·{' '}
                    {displayOrNA(selectedDevice.mountType)}
                  </div>
                </div>
                <DataSourceTag source={selectedDevice.dataSource} compact />
              </div>

              {/* Health Warnings Banner when GPS or MPU6050 is disconnected/faulty */}
              {(selectedDevice.healthWarnings?.length ?? 0) > 0 && (
                <div className="neu-sos-panel p-3 text-[12px] text-[#991B1B]">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="h-4 w-4 text-[#DC2626]" />
                    Hardware Health Warnings ({selectedDevice.healthWarnings!.length})
                  </div>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-mono text-[11px] text-[#7F1D1D]">
                    {selectedDevice.healthWarnings!.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Hardware Telemetry Specs */}
              <div className="grid grid-cols-2 gap-2.5 font-mono text-[11px]">
                <div className="neu-inset-sm p-2.5">
                  <div className="flex items-center gap-1 text-[#718096]">
                    <Satellite className="h-3 w-3 text-[#356AE6]" /> GPS Status
                  </div>
                  <div
                    className={`mt-0.5 font-semibold ${
                      selectedDevice.gpsFix === 'No Fix' ? 'text-[#DC2626]' : 'text-[#17243A]'
                    }`}
                  >
                    {selectedDevice.rawGpsStatus ?? selectedDevice.gpsFix ?? 'N/A'}
                    {selectedDevice.satellites !== null
                      ? ` (${selectedDevice.satellites} sats)`
                      : ''}
                  </div>
                </div>
                <div className="neu-inset-sm p-2.5">
                  <div className="flex items-center gap-1 text-[#718096]">
                    <Cpu className="h-3 w-3 text-[#0F8B8D]" /> MPU6050 Status
                  </div>
                  <div
                    className={`mt-0.5 font-semibold ${
                      selectedDevice.mpu6050Status === 'Fault' ||
                      selectedDevice.mpu6050Status === 'Drift Warning'
                        ? 'text-[#DC2626]'
                        : 'text-[#17243A]'
                    }`}
                  >
                    {selectedDevice.rawMpu6050Status ?? selectedDevice.mpu6050Status ?? 'N/A'}
                  </div>
                </div>
                <div className="neu-inset-sm p-2.5">
                  <div className="flex items-center gap-1 text-[#718096]">
                    <BatteryCharging className="h-3 w-3 text-[#1E9E63]" /> Battery Voltage
                  </div>
                  <div className="mt-0.5 font-semibold text-[#17243A]">
                    {formatVoltage(selectedDevice.batteryVoltage)}
                  </div>
                </div>
                <div className="neu-inset-sm p-2.5">
                  <div className="flex items-center gap-1 text-[#718096]">
                    <Wifi className="h-3 w-3 text-[#0F8B8D]" /> Signal RSSI / SOS
                  </div>
                  <div className="mt-0.5 font-semibold text-[#17243A]">
                    {selectedDevice.signalRssi !== null
                      ? `${selectedDevice.signalRssi} dBm`
                      : 'N/A'}{' '}
                    · {displayOrNA(selectedDevice.manualSosButtonState)}
                  </div>
                </div>
              </div>

              <div className="neu-inset-sm space-y-1 px-3 py-2 font-mono text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#718096]">
                    FW: <strong className="text-[#17243A]">{displayOrNA(selectedDevice.firmwareVersion)}</strong>
                  </span>
                  <span className="text-[#52627A]">
                    {formatLatLngPair(selectedDevice.lat, selectedDevice.lng)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[#718096]">
                  <span>
                    Uptime:{' '}
                    <strong className="text-[#17243A]">
                      {formatUptime(selectedDevice.deviceUptimeSec)}
                    </strong>
                  </span>
                  <span>
                    Detections:{' '}
                    <strong className="text-[#17243A]">
                      {selectedDevice.detectionCount !== null &&
                      selectedDevice.detectionCount !== undefined
                        ? selectedDevice.detectionCount.toLocaleString()
                        : 'N/A'}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[#718096]">
                  <span>Last Communication:</span>
                  <span className="font-semibold text-[#17243A]">
                    {formatShortTimestamp(selectedDevice.lastHeartbeat)}
                  </span>
                </div>
              </div>

              {/* MPU6050 3-Axis Telemetry Stream Chart */}
              <div>
                <div className="label-caps mb-2 text-[#52627A]">
                  MPU6050 3-Axis Accelerometer Telemetry (g-force)
                </div>
                <div className="neu-inset h-[160px] w-full p-2.5">
                  {selectedDevice.recentAccelSamples.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={selectedDevice.recentAccelSamples}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 177, 198, 0.35)" />
                        <XAxis
                          dataKey="t"
                          tick={{ fontSize: 10, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#EEF2F7',
                            borderRadius: 12,
                            border: '1px solid rgba(255, 255, 255, 0.78)',
                            boxShadow:
                              '5px 5px 12px rgba(163, 177, 198, 0.45), -4px -4px 10px rgba(255, 255, 255, 0.85)',
                            fontSize: 11,
                            fontFamily: 'JetBrains Mono',
                            color: '#17243A',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="az"
                          name="Z-Axis (g)"
                          stroke="#356AE6"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ax"
                          name="X-Axis (g)"
                          stroke="#0F8B8D"
                          strokeWidth={1.5}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ay"
                          name="Y-Axis (g)"
                          stroke="#EA580C"
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-[11px] text-[#718096]">
                      N/A — No recent accelerometer samples stored for {selectedDevice.id}
                    </div>
                  )}
                </div>
              </div>

              {actionFeedback && (
                <div className="rounded-[11px] border border-[#86EFAC] bg-[#E8F8EE] px-3 py-2 text-[12px] font-medium text-[#15803D] shadow-[inset_2px_2px_4px_rgba(21,128,61,0.12),inset_-2px_-2px_4px_rgba(255,255,255,0.75)]">
                  {actionFeedback}
                </div>
              )}

              {/* Remote Hardware Commands */}
              <div className="grid grid-cols-2 gap-2.5 border-t neu-divider pt-3.5">
                {!workspace.isLiveFirestore && (
                  <>
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() => handleRunAction('ping')}
                      className="neu-btn inline-flex h-8.5 items-center justify-center gap-1.5 px-2.5 text-[12px] font-medium cursor-pointer disabled:opacity-60"
                    >
                      <Radio className="h-3.5 w-3.5 text-[#0F8B8D]" />
                      {actionBusy === 'ping' ? 'Pinging...' : 'Ping Node'}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() => handleRunAction('calibrate')}
                      className="neu-btn inline-flex h-8.5 items-center justify-center gap-1.5 px-2.5 text-[12px] font-medium cursor-pointer disabled:opacity-60"
                    >
                      <Wrench className="h-3.5 w-3.5 text-[#356AE6]" />
                      {actionBusy === 'calibrate' ? 'Calibrating...' : 'Calibrate IMU'}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() => handleRunAction('ota')}
                      className="neu-btn inline-flex h-8.5 items-center justify-center gap-1.5 px-2.5 text-[12px] font-medium cursor-pointer disabled:opacity-60"
                    >
                      <UploadCloud className="h-3.5 w-3.5 text-[#356AE6]" />
                      {actionBusy === 'ota' ? 'Updating...' : 'Push OTA FW'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={!hasDeviceCoords(selectedDevice)}
                  onClick={() => {
                    if (hasDeviceCoords(selectedDevice)) {
                      onLocateCoordOnMap(selectedDevice.lat as number, selectedDevice.lng as number);
                    }
                  }}
                  className={`neu-btn-primary inline-flex h-8.5 items-center justify-center gap-1.5 px-2.5 text-[12px] font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                    workspace.isLiveFirestore ? 'col-span-2' : ''
                  }`}
                >
                  <MapPin className="h-3.5 w-3.5" />
                  {hasDeviceCoords(selectedDevice)
                    ? 'Locate on Map'
                    : 'No Reliable GPS Coordinates'}
                </button>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-[12px] text-[#718096]">
              Select an ESP32 device node to inspect MPU6050 and GPS diagnostics.
            </div>
          )}
        </div>
      </div>

      {/* Register ESP32 Node Modal */}
      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Register New ESP32 + MPU6050 Hardware Node"
        subtitle="Provision a vehicle-mounted road telemetry unit into the municipal fleet."
        footer={
          <>
            <button
              type="button"
              onClick={() => setRegisterOpen(false)}
              className="neu-btn h-8 px-3.5 text-[12px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="register-device-form"
              className="neu-btn-primary h-8 px-3.5 text-[12px] font-semibold cursor-pointer"
            >
              Provision Device
            </button>
          </>
        }
      >
        <form id="register-device-form" onSubmit={handleRegisterSubmit} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps block text-[#52627A]">Hardware Node ID</label>
              <input
                required
                type="text"
                value={newNodeId}
                onChange={(e) => setNewNodeId(e.target.value)}
                placeholder="ESP32-VAN-09"
                className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
              />
            </div>
            <div>
              <label className="label-caps block text-[#52627A]">Firmware Build</label>
              <input
                required
                type="text"
                value={newFirmware}
                onChange={(e) => setNewFirmware(e.target.value)}
                className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
              />
            </div>
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Vehicle / Unit Label</label>
            <input
              required
              type="text"
              value={newVehicle}
              onChange={(e) => setNewVehicle(e.target.value)}
              placeholder="e.g., PW Patrol Van 09"
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps block text-[#52627A]">Vehicle Mount Type</label>
              <select
                value={newMount ?? 'Municipal Patrol Van'}
                onChange={(e) => setNewMount(e.target.value as Esp32Device['mountType'])}
                className="neu-input mt-1.5 h-9 w-full px-2.5 text-[12px]"
              >
                <option value="Municipal Patrol Van">Municipal Patrol Van</option>
                <option value="Public Transit Bus">Public Transit Bus</option>
                <option value="Road Inspection Truck">Road Inspection Truck</option>
                <option value="Utility Fleet">Utility Fleet</option>
              </select>
            </div>
            <div>
              <label className="label-caps block text-[#52627A]">Assigned Ward</label>
              <input
                required
                type="text"
                value={newDistrict}
                onChange={(e) => setNewDistrict(e.target.value)}
                className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
