import React, { useMemo, useState } from 'react';
import { Plus, Users, Wrench } from 'lucide-react';
import { MetricTile } from '../components/common/MetricTile';
import { Modal } from '../components/common/Modal';
import { WorkOrderStatusBadge } from '../components/common/Badges';
import {
  displayOrNA,
  formatCurrency,
  formatShortTimestamp,
  hoursUntilDeadline,
} from '../utilities/formatters';
import type {
  RepairWorkOrder,
  TerraWorkspaceState,
  WorkOrderStatus,
} from '../types';

interface RepairManagementProps {
  workspace: TerraWorkspaceState;
  prefillOrder: {
    title: string;
    roadName: string;
    district: string;
    potholeIds: string[];
    clusterId: string | null;
    priority: 'P1' | 'P2' | 'P3';
  } | null;
  onClearPrefill: () => void;
  onCreateRepairOrder: (
    payload: Omit<RepairWorkOrder, 'id' | 'createdAt' | 'completedAt' | 'dataSource'>
  ) => Promise<void>;
  onUpdateRepairOrder: (
    id: string,
    patch: Partial<Pick<RepairWorkOrder, 'status' | 'assignedCrewId' | 'priority' | 'notes'>>
  ) => Promise<void>;
}

const KANBAN_COLUMNS: WorkOrderStatus[] = [
  'Queued',
  'Dispatched',
  'In Progress',
  'Verification',
  'Completed',
];

export const RepairManagement: React.FC<RepairManagementProps> = ({
  workspace,
  prefillOrder,
  onClearPrefill,
  onCreateRepairOrder,
  onUpdateRepairOrder,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'board' | 'crews'>('table');
  const [statusFilter, setStatusFilter] = useState<'All' | WorkOrderStatus>('All');
  const [createOpen, setCreateOpen] = useState(Boolean(prefillOrder));

  // New Work Order form state
  const [title, setTitle] = useState(prefillOrder?.title || '');
  const [roadName, setRoadName] = useState(prefillOrder?.roadName || '');
  const [district, setDistrict] = useState(prefillOrder?.district || 'Central Civic Ward');
  const [selectedPotholeIds, setSelectedPotholeIds] = useState<string[]>(
    prefillOrder?.potholeIds || []
  );
  const [priority, setPriority] = useState<'P1' | 'P2' | 'P3'>(
    prefillOrder?.priority || 'P1'
  );
  const [assignedCrewId, setAssignedCrewId] = useState<string>(
    workspace.crews[0]?.id || ''
  );
  const [asphaltTons, setAsphaltTons] = useState(2.5);
  const [estimatedCost, setEstimatedCost] = useState(4200);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sync if prefill arrives from another screen
  React.useEffect(() => {
    if (prefillOrder) {
      setTitle(prefillOrder.title);
      setRoadName(prefillOrder.roadName);
      setDistrict(prefillOrder.district);
      setSelectedPotholeIds(prefillOrder.potholeIds);
      setPriority(prefillOrder.priority);
      setAsphaltTons(Number((prefillOrder.potholeIds.length * 1.4).toFixed(1)));
      setEstimatedCost(prefillOrder.potholeIds.length * 2250);
      setCreateOpen(true);
    }
  }, [prefillOrder]);

  const openOrders = useMemo(
    () => workspace.repairs.filter((r) => r.status !== 'Completed'),
    [workspace.repairs]
  );

  const slaAtRiskCount = useMemo(
    () =>
      openOrders.filter((r) => {
        const hrs = hoursUntilDeadline(r.slaDeadline);
        return hrs !== null && hrs <= 24;
      }).length,
    [openOrders]
  );

  const totalBudgetCommitted = useMemo(() => {
    const valid = openOrders
      .map((r) => r.estimatedCostUsd)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return null;
    return valid.reduce((sum, v) => sum + v, 0);
  }, [openOrders]);

  const totalAsphaltCommitted = useMemo(() => {
    const valid = openOrders
      .map((r) => r.estimatedAsphaltTons)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return null;
    return valid.reduce((sum, v) => sum + v, 0);
  }, [openOrders]);

  const filteredRepairs = useMemo(
    () =>
      workspace.repairs.filter((r) =>
        statusFilter === 'All' ? true : r.status === statusFilter
      ),
    [workspace.repairs, statusFilter]
  );

  const availablePotholes = useMemo(
    () => workspace.potholes.filter((p) => p.status !== 'Repaired'),
    [workspace.potholes]
  );

  const handleCloseModal = () => {
    setCreateOpen(false);
    onClearPrefill();
  };

  const handleTogglePotholeSelection = (pid: string) => {
    setSelectedPotholeIds((prev) =>
      prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid]
    );
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const slaHours = priority === 'P1' ? 24 : priority === 'P2' ? 72 : 168;
      await onCreateRepairOrder({
        title: title || `${roadName || 'Municipal Corridor'} Repair Order`,
        roadName: roadName || 'Municipal Corridor',
        district,
        potholeIds: selectedPotholeIds,
        clusterId: prefillOrder?.clusterId ?? null,
        priority,
        status: assignedCrewId ? 'Dispatched' : 'Queued',
        assignedCrewId: assignedCrewId || null,
        scheduledDate: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        slaDeadline: new Date(Date.now() + slaHours * 3600 * 1000).toISOString(),
        estimatedAsphaltTons: Number(asphaltTons),
        estimatedCostUsd: Number(estimatedCost),
        notes,
      });
      setTitle('');
      setRoadName('');
      setSelectedPotholeIds([]);
      setNotes('');
      handleCloseModal();
    } finally {
      setSubmitting(false);
    }
  };

  const getCrewName = (crewId: string | null) =>
    workspace.crews.find((c) => c.id === crewId)?.name || 'Unassigned';

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Open Repair Work Orders"
          value={openOrders.length}
          delta={`${workspace.repairs.filter((r) => r.status === 'In Progress').length} active on site`}
          deltaTone="telemetry"
        />
        <MetricTile
          label="SLA Critical (<24h)"
          value={slaAtRiskCount}
          delta="Municipal P1 SLA"
          deltaTone={slaAtRiskCount > 0 ? 'negative' : 'positive'}
        />
        <MetricTile
          label="Active Maintenance Crews"
          value={`${workspace.crews.filter((c) => c.status !== 'Off Shift').length} / ${workspace.crews.length}`}
          delta={`${workspace.crews.filter((c) => c.status === 'Available').length} ready for dispatch`}
          deltaTone="positive"
        />
        <MetricTile
          label="Committed Repair Budget"
          value={formatCurrency(totalBudgetCommitted)}
          delta={
            totalAsphaltCommitted !== null
              ? `${totalAsphaltCommitted.toFixed(1)} tons asphalt`
              : 'Asphalt est.: N/A'
          }
          deltaTone="neutral"
        />
      </div>

      {/* View Switcher & Primary CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="neu-tab-track inline-flex gap-1">
            {(
              [
                ['table', 'Work Orders Grid'],
                ['board', 'Dispatch Kanban'],
                ['crews', 'Maintenance Crews'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`h-8 px-3.5 text-[12px] font-semibold whitespace-nowrap ${
                  viewMode === mode ? 'neu-tab-active' : 'neu-tab-inactive'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {viewMode === 'table' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | WorkOrderStatus)}
              className="neu-input h-9 px-3 text-[12px]"
            >
              <option value="All">All Statuses</option>
              {KANBAN_COLUMNS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="neu-btn-primary inline-flex h-9 items-center gap-1.5 px-3.5 text-[12px] font-semibold"
        >
          <Plus className="h-3.5 w-3.5" />
          New Repair Work Order
        </button>
      </div>

      {/* View 1: Work Orders Data Grid */}
      {viewMode === 'table' && (
        <div className="neu-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="h-10 border-b neu-divider bg-[#E3E8F1]/65 text-[#52627A]">
                  <th className="label-caps px-3.5">Work Order</th>
                  <th className="label-caps px-3.5">Corridor & Potholes</th>
                  <th className="label-caps px-3.5">Priority</th>
                  <th className="label-caps px-3.5">Assigned Crew</th>
                  <th className="label-caps px-3.5">Lifecycle Status</th>
                  <th className="label-caps px-3.5 text-right">SLA Window</th>
                  <th className="label-caps px-3.5 text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
                {filteredRepairs.map((order) => {
                  const hrsLeft = hoursUntilDeadline(order.slaDeadline);
                  return (
                    <tr key={order.id} className="h-12 hover:bg-[#F5F8FC]/80 transition-colors">
                      <td className="px-3.5 font-mono font-bold text-[#17243A] whitespace-nowrap">
                        <div>{order.id}</div>
                        <div className="text-[10px] font-normal text-[#718096]">
                          {formatShortTimestamp(order.createdAt)}
                        </div>
                      </td>
                      <td className="px-3.5">
                        <div className="font-semibold text-[#17243A]">{order.title}</div>
                        <div className="font-mono text-[11px] text-[#718096]">
                          {order.district} · {order.potholeIds.length} pothole(s)
                          {order.clusterId ? ` · ${order.clusterId}` : ''}
                        </div>
                      </td>
                      <td className="px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex h-5 items-center rounded-full border px-2.5 font-mono text-[10.5px] font-bold ${
                            order.priority === 'P1'
                              ? 'border-[#FCA5A5] bg-[#FDECEC] text-[#DC2626]'
                              : order.priority === 'P2'
                                ? 'border-[#FDBA74] bg-[#FEF3E6] text-[#C2410C]'
                                : 'border-[#FCD34D] bg-[#FEF9E3] text-[#9A5B04]'
                          }`}
                        >
                          {order.priority}
                        </span>
                      </td>
                      <td className="px-3.5">
                        <select
                          value={order.assignedCrewId || ''}
                          onChange={(e) =>
                            onUpdateRepairOrder(order.id, {
                              assignedCrewId: e.target.value || null,
                            })
                          }
                          className="neu-input h-8 px-2.5 text-[11px]"
                        >
                          <option value="">Unassigned</option>
                          {workspace.crews.map((crew) => (
                            <option key={crew.id} value={crew.id}>
                              {crew.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3.5">
                        <select
                          value={order.status}
                          onChange={(e) =>
                            onUpdateRepairOrder(order.id, {
                              status: e.target.value as WorkOrderStatus,
                            })
                          }
                          className="neu-input h-8 px-2.5 font-mono text-[11px]"
                        >
                          {KANBAN_COLUMNS.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3.5 text-right font-mono whitespace-nowrap">
                        {order.status === 'Completed' ? (
                          <span className="font-semibold text-[#15803D]">Verified</span>
                        ) : hrsLeft === null ? (
                          <span className="text-[#718096]">N/A</span>
                        ) : (
                          <span
                            className={
                              hrsLeft <= 18
                                ? 'font-bold text-[#DC2626]'
                                : 'text-[#52627A]'
                            }
                          >
                            {hrsLeft > 0 ? `${hrsLeft}h left` : `${Math.abs(hrsLeft)}h overdue`}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 text-right font-mono font-bold text-[#17243A] whitespace-nowrap">
                        {formatCurrency(order.estimatedCostUsd)}
                      </td>
                    </tr>
                  );
                })}
                {filteredRepairs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#718096]">
                      No repair work orders recorded. Create a new repair order to schedule maintenance.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* View 2: Dispatch Kanban Board */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {KANBAN_COLUMNS.map((col) => {
            const colOrders = workspace.repairs.filter((r) => r.status === col);
            return (
              <div
                key={col}
                className="neu-inset p-3 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between border-b neu-divider pb-2.5">
                  <WorkOrderStatusBadge status={col} />
                  <span className="font-mono text-[11px] font-bold text-[#52627A]">
                    {colOrders.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {colOrders.map((order) => {
                    const nextIdx = KANBAN_COLUMNS.indexOf(order.status) + 1;
                    const nextStatus = KANBAN_COLUMNS[nextIdx];
                    return (
                      <div
                        key={order.id}
                        className="neu-surface-sm p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold text-[#17243A]">{order.id}</span>
                          <span className="font-bold text-[#DC2626]">{order.priority}</span>
                        </div>
                        <div className="text-[12px] font-bold text-[#17243A] leading-snug">
                          {order.title}
                        </div>
                        <div className="text-[11px] text-[#718096]">
                          {getCrewName(order.assignedCrewId)}
                        </div>
                        <div className="flex items-center justify-between font-mono text-[10px] text-[#52627A]">
                          <span>{order.potholeIds.length} potholes</span>
                          <span className="font-semibold text-[#17243A]">{formatCurrency(order.estimatedCostUsd)}</span>
                        </div>
                        {nextStatus && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateRepairOrder(order.id, { status: nextStatus })
                            }
                            className="neu-btn mt-1 h-7 w-full text-[11px] font-semibold text-[#356AE6]"
                          >
                            Advance → {nextStatus}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {colOrders.length === 0 && (
                    <div className="py-6 text-center text-[11px] text-[#718096]">No orders</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View 3: Maintenance Crews Roster */}
      {viewMode === 'crews' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspace.crews.map((crew) => {
            const assignedOrders = workspace.repairs.filter(
              (r) => r.assignedCrewId === crew.id && r.status !== 'Completed'
            );
            return (
              <div
                key={crew.id}
                className="neu-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[11px] text-[#718096]">{crew.id}</div>
                    <div className="text-[15px] font-bold text-[#17243A]">{crew.name}</div>
                  </div>
                  <span
                    className={`inline-flex h-5 items-center rounded-full border px-2.5 font-mono text-[10px] font-bold ${
                      crew.status === 'Available'
                        ? 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]'
                        : crew.status === 'On Site'
                          ? 'border-[#5EEAD4] bg-[#E3F5F4] text-[#0F766E]'
                          : 'border-[#93C5FD] bg-[#E7F0FD] text-[#2857C8]'
                    }`}
                  >
                    {crew.status}
                  </span>
                </div>
                <div className="neu-inset grid grid-cols-2 gap-2.5 p-3 text-[11px]">
                  <div>
                    <span className="text-[#718096]">Lead:</span>{' '}
                    <span className="font-semibold text-[#17243A]">{crew.leadEngineer}</span>
                  </div>
                  <div>
                    <span className="text-[#718096]">District:</span>{' '}
                    <span className="font-semibold text-[#17243A]">{crew.district}</span>
                  </div>
                  <div className="font-mono">
                    <span className="text-[#718096]">Unit:</span> {crew.vehicleUnit}
                  </div>
                  <div className="font-mono">
                    <span className="text-[#718096]">Radio:</span> {crew.contactRadio}
                  </div>
                </div>
                <div className="flex items-center justify-between text-[12px] pt-0.5">
                  <span className="inline-flex items-center gap-1.5 text-[#52627A]">
                    <Users className="h-3.5 w-3.5 text-[#356AE6]" />{' '}
                    {crew.membersCount !== null ? `${crew.membersCount} crew members` : 'N/A crew members'}
                  </span>
                  <span className="font-mono font-bold text-[#17243A]">
                    {assignedOrders.length} active work orders
                  </span>
                </div>
              </div>
            );
          })}
          {workspace.crews.length === 0 && (
            <div className="col-span-full neu-card py-10 text-center text-[12px] text-[#718096]">
              No maintenance crews recorded in Firestore <span className="font-mono">maintenance_teams</span>.
            </div>
          )}
        </div>
      )}

      {/* New Work Order Modal */}
      <Modal
        open={createOpen}
        onClose={handleCloseModal}
        title="Create Municipal Repair Work Order"
        subtitle="Link verified potholes and assign a road maintenance crew with SLA tracking."
        maxWidthClass="max-w-xl"
        footer={
          <>
            <button
              type="button"
              onClick={handleCloseModal}
              className="neu-btn h-9 px-3.5 text-[12px] font-medium text-[#17243A]"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-work-order-form"
              disabled={submitting}
              className="neu-btn-primary inline-flex h-9 items-center gap-1.5 px-4 text-[12px] font-semibold"
            >
              <Wrench className="h-3.5 w-3.5" />
              {submitting ? 'Dispatching...' : 'Create & Dispatch Order'}
            </button>
          </>
        }
      >
        <form id="create-work-order-form" onSubmit={handleCreateSubmit} className="space-y-3.5">
          <div>
            <label className="label-caps block text-[#52627A]">Work Order Title</label>
            <input
              required
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Market St Transit Lane Hot-Mix Patch"
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label-caps block text-[#52627A]">Road Corridor</label>
              <input
                required
                type="text"
                value={roadName}
                onChange={(e) => setRoadName(e.target.value)}
                placeholder="e.g., Market St & 7th St"
                className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
              />
            </div>
            <div>
              <label className="label-caps block text-[#52627A]">District / Ward</label>
              <input
                required
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label-caps block text-[#52627A]">Assign Maintenance Crew</label>
              <select
                value={assignedCrewId}
                onChange={(e) => setAssignedCrewId(e.target.value)}
                className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
              >
                <option value="">Queue Without Crew</option>
                {workspace.crews.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-caps block text-[#52627A]">SLA Priority Tier</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}
                className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
              >
                <option value="P1">P1 — Critical (24h SLA)</option>
                <option value="P2">P2 — High (72h SLA)</option>
                <option value="P3">P3 — Standard (7d SLA)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label-caps block text-[#52627A]">
              Linked Pothole Records ({selectedPotholeIds.length} selected)
            </label>
            <div className="neu-inset mt-1.5 max-h-32 overflow-y-auto divide-y divide-[rgba(163,177,198,0.28)]">
              {availablePotholes.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center justify-between px-3 py-2 text-[12px] hover:bg-[#EEF2F7]/70"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedPotholeIds.includes(p.id)}
                      onChange={() => handleTogglePotholeSelection(p.id)}
                      className="accent-[#356AE6]"
                    />
                    <span className="font-mono font-bold text-[#17243A]">
                      {p.eventId ?? p.id}
                    </span>
                    <span className="text-[#52627A]">{displayOrNA(p.roadName)}</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#718096]">
                    {p.severity ?? p.rawSeverity ?? 'N/A'} ·{' '}
                    {p.priorityScore !== null ? p.priorityScore : 'N/A'}
                  </span>
                </label>
              ))}
              {availablePotholes.length === 0 && (
                <div className="px-3 py-4 text-center text-[11px] text-[#718096]">
                  No open pothole records available to link.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps block text-[#52627A]">Est. Asphalt (Tons)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                value={asphaltTons}
                onChange={(e) => setAsphaltTons(Number(e.target.value))}
                className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
              />
            </div>
            <div>
              <label className="label-caps block text-[#52627A]">Est. Cost (USD)</label>
              <input
                type="number"
                step="100"
                min="500"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(Number(e.target.value))}
                className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
              />
            </div>
          </div>

          <div>
            <label className="label-caps block text-[#52627A]">Dispatch Instructions</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Lane closure requirements, cold/hot mix spec, post-patch IRI verification..."
              className="neu-input mt-1.5 w-full p-2.5 text-[12px]"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
