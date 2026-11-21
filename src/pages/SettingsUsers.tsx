import React, { useState } from 'react';
import {
  Users,
  Sliders,
  Database,
  Plus,
  CheckCircle2,
  Shield,
  Cpu,
  RefreshCw,
  KeyRound,
  AlertCircle,
} from 'lucide-react';
import { Modal } from '../components/common/Modal';
import {
  FIREBASE_INTEGRATION_CONTRACT,
  FIRESTORE_COLLECTIONS,
  getFirebaseReadinessSummary,
} from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatRelativeTime } from '../utilities/formatters';
import type {
  MunicipalUser,
  PriorityEngineWeights,
  SystemSettings,
  TerraWorkspaceState,
  UserRole,
} from '../types';

interface SettingsUsersProps {
  workspace: TerraWorkspaceState;
  onUpdateSettings: (patch: Partial<SystemSettings>) => Promise<void>;
  onCreateUser: (payload: Omit<MunicipalUser, 'id' | 'lastLogin'>) => Promise<void>;
  onUpdateUserRole: (id: string, role: UserRole) => Promise<void>;
  onToggleUserStatus: (id: string) => Promise<void>;
}

const ROLE_MATRIX: Array<{ role: UserRole; permissions: string }> = [
  {
    role: 'Admin',
    permissions:
      'Full governance: user & RBAC role assignment, system settings, priority weights, ESP32 provisioning/OTA, all CRUD operations, and terminal state override.',
  },
  {
    role: 'Municipal Officer',
    permissions:
      'Operational triage: verify/update potholes, run DBSCAN & H3 spatial analysis, create & assign repair tasks, manage maintenance teams, resolve alerts & SOS, export reports.',
  },
  {
    role: 'Field Maintenance Team',
    permissions:
      'Field execution: view GIS map, hotspots, devices & alerts; update repair task progress & field notes; append immutable repair history; trigger & acknowledge field SOS; edit own contact profile (cannot change role).',
  },
];

export const SettingsUsers: React.FC<SettingsUsersProps> = ({
  workspace,
  onUpdateSettings,
  onCreateUser,
  onUpdateUserRole,
  onToggleUserStatus,
}) => {
  const { session, connectivity, missingFirebaseVars, retestFirestoreConnection } = useAuth();
  const isAdmin = session?.role === 'Admin';

  const [activeTab, setActiveTab] = useState<'users' | 'engine' | 'integrations'>('users');
  const [addUserOpen, setAddUserOpen] = useState(false);

  // Add user state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('Field Maintenance Team');
  const [department, setDepartment] = useState('Pavement Engineering');
  const [districtScope, setDistrictScope] = useState('All Municipal Districts');
  const [userError, setUserError] = useState<string | null>(null);

  // Engine weights state
  const [weights, setWeights] = useState<PriorityEngineWeights>(
    workspace.settings.priorityWeights
  );
  const [triggerG, setTriggerG] = useState(workspace.settings.mpu6050TriggerThresholdG);
  const [mlCutoff, setMlCutoff] = useState(workspace.settings.mlConfidenceCutoffPct);
  const [demoMode, setDemoMode] = useState(workspace.settings.demoModeEnabled);
  const [savingEngine, setSavingEngine] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const weightSum =
    weights.severityWeight +
    weights.peakGWeight +
    weights.arterialWeight +
    weights.clusterDensityWeight +
    weights.ageWeight;

  const firebaseReadiness = getFirebaseReadinessSummary();

  const handleSaveEngine = async () => {
    setSavingEngine(true);
    setSavedNotice(null);
    setEngineError(null);
    try {
      await onUpdateSettings({
        priorityWeights: weights,
        mpu6050TriggerThresholdG: triggerG,
        mlConfidenceCutoffPct: mlCutoff,
        demoModeEnabled: demoMode,
      });
      setSavedNotice(
        'Priority Calculation Engine weights & sensor thresholds updated across all potholes.'
      );
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Failed to update settings.');
    } finally {
      setSavingEngine(false);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError(null);
    try {
      await onCreateUser({
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        department: department.trim(),
        districtScope: districtScope.trim(),
        status: 'Active',
      });
      setFullName('');
      setEmail('');
      setAddUserOpen(false);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Unable to create user.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Tab Navigation */}
      <div className="neu-tab-track inline-flex flex-wrap gap-1">
        {(
          [
            ['users', 'Users & RBAC Permissions', Users],
            ['engine', 'Priority Engine & ML Thresholds', Sliders],
            ['integrations', 'Firebase, Firestore & Device API', Database],
          ] as const
        ).map(([tabId, label, Icon]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold whitespace-nowrap cursor-pointer ${
              activeTab === tabId ? 'neu-tab-active' : 'neu-tab-inactive'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Users & 3-Role RBAC Management */}
      {activeTab === 'users' && (
        <div className="space-y-5">
          {!isAdmin && (
            <div className="flex items-start gap-2.5 rounded-[14px] border border-[#FDBA74] bg-[#FFF4E6] p-3.5 text-[12px] text-[#9A3412] shadow-[4px_4px_10px_rgba(163,177,198,0.35),-3px_-3px_8px_rgba(255,255,255,0.82)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />
              <span>
                You are signed in as <strong className="font-mono">{session?.role}</strong>. User
                directory listing and role assignment are restricted on the backend and in Firestore
                rules strictly to <strong className="font-mono">Admin</strong>.
              </span>
            </div>
          )}

          {userError && (
            <div className="rounded-[12px] border border-[#FCA5A5] bg-[#FEECEC] p-3 text-[12px] font-medium text-[#DC2626] shadow-[inset_2px_2px_5px_rgba(220,38,38,0.12)]">
              {userError}
            </div>
          )}

          <div className="neu-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b neu-divider bg-[#E3E8F1]/45 px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[#17243A]">
                  Municipal Operator Directory ({workspace.users.length})
                </h2>
                <p className="text-[11px] text-[#718096]">
                  Authoritative roles enforced by Express RBAC middleware and Firestore{' '}
                  <span className="font-mono">/users/{'{uid}'}</span> rules
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setAddUserOpen(true)}
                  className="neu-btn-primary inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Municipal User
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b neu-divider bg-[#E3E8F1]/65 text-[#52627A]">
                    <th className="label-caps px-3.5">User</th>
                    <th className="label-caps px-3">Authoritative Role</th>
                    <th className="label-caps px-3">Department & Scope</th>
                    <th className="label-caps px-3">Status</th>
                    <th className="label-caps px-3 text-right">Last Session</th>
                    {isAdmin && <th className="label-caps px-3.5 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
                  {workspace.users.map((user) => (
                    <tr key={user.id} className="h-12 transition-colors hover:bg-[#F5F8FC]/80">
                      <td className="px-3.5">
                        <div className="font-semibold text-[#17243A]">{user.fullName}</div>
                        <div className="font-mono text-[11px] text-[#718096]">{user.email}</div>
                      </td>
                      <td className="px-3">
                        {isAdmin ? (
                          <select
                            value={user.role}
                            onChange={async (e) => {
                              setUserError(null);
                              try {
                                await onUpdateUserRole(user.id, e.target.value as UserRole);
                              } catch (err) {
                                setUserError(
                                  err instanceof Error ? err.message : 'Role update denied.'
                                );
                              }
                            }}
                            className="neu-input h-7.5 px-2.5 text-[11px] font-medium"
                          >
                            <option value="Admin">Admin</option>
                            <option value="Municipal Officer">Municipal Officer</option>
                            <option value="Field Maintenance Team">Field Maintenance Team</option>
                          </select>
                        ) : (
                          <span className="font-mono text-[11px] font-semibold text-[#17243A]">
                            {user.role}
                          </span>
                        )}
                      </td>
                      <td className="px-3">
                        <div className="text-[#334155]">{user.department}</div>
                        <div className="text-[11px] text-[#718096]">{user.districtScope}</div>
                      </td>
                      <td className="px-3">
                        <span
                          className={`inline-flex h-5 items-center rounded-full border px-2 font-mono text-[10px] font-semibold shadow-[inset_1px_1px_2px_rgba(255,255,255,0.75)] ${
                            user.status === 'Active'
                              ? 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]'
                              : 'border-[#FCA5A5] bg-[#FEECEC] text-[#DC2626]'
                          }`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-3 text-right font-mono text-[11px] text-[#718096]">
                        {formatRelativeTime(user.lastLogin)}
                      </td>
                      {isAdmin && (
                        <td className="px-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => onToggleUserStatus(user.id)}
                            className="neu-btn h-7 px-2.5 text-[11px] font-medium cursor-pointer"
                          >
                            {user.status === 'Active' ? 'Suspend' : 'Activate'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {workspace.users.length === 0 && (
                    <tr>
                      <td
                        colSpan={isAdmin ? 6 : 5}
                        className="py-10 text-center text-[#718096]"
                      >
                        No municipal operator records loaded from Firestore /users.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="neu-card p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#17243A]">
              <Shield className="h-4 w-4 text-[#356AE6]" />
              Three-Tier Municipal RBAC Policy (Backend + Firestore Rules)
            </h3>
            <div className="mt-3 divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
              {ROLE_MATRIX.map((r) => (
                <div key={r.role} className="grid grid-cols-1 gap-1 py-2.5 md:grid-cols-12">
                  <div className="md:col-span-3 font-semibold text-[#17243A]">{r.role}</div>
                  <div className="md:col-span-9 text-[#52627A]">{r.permissions}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Priority Calculation Engine & ML Thresholds */}
      {activeTab === 'engine' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7 neu-card p-5 space-y-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#17243A]">
                Municipal Priority Calculation Engine Weights
              </h2>
              <p className="text-[12px] text-[#718096]">
                Adjust how severity, MPU6050 peak G-force, road arterial class, DBSCAN density, and
                unresolved age contribute to the 0–100 priority index.
              </p>
            </div>

            <div className="space-y-3.5">
              {(
                [
                  ['severityWeight', 'ML Severity Classification Weight'],
                  ['peakGWeight', 'MPU6050 Z-Axis Peak G-Force Weight'],
                  ['arterialWeight', 'Road Arterial / Traffic Class Weight'],
                  ['clusterDensityWeight', 'DBSCAN Spatial Cluster Density Weight'],
                  ['ageWeight', 'Unresolved Exposure Age Weight'],
                ] as Array<[keyof PriorityEngineWeights, string]>
              ).map(([key, label]) => (
                <div key={key} className="neu-inset-sm px-3 py-2.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-[#334155]">{label}</span>
                    <span className="font-mono font-semibold text-[#17243A]">
                      {weights[key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    disabled={!isAdmin}
                    min={0}
                    max={60}
                    step={5}
                    value={weights[key]}
                    onChange={(e) =>
                      setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                    className="mt-1.5 w-full accent-[#356AE6] disabled:opacity-50"
                  />
                </div>
              ))}
            </div>

            <div className="neu-inset-sm flex items-center justify-between px-3.5 py-2.5 font-mono text-[12px]">
              <span className="text-[#52627A]">Combined Formula Total</span>
              <span
                className={
                  weightSum === 100
                    ? 'font-bold text-[#15803D]'
                    : 'font-bold text-[#EA580C]'
                }
              >
                {weightSum}% {weightSum !== 100 ? '(Auto-normalized on save)' : '(Exact 100%)'}
              </span>
            </div>
          </div>

          <div className="lg:col-span-5 neu-card p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-3.5">
              <div>
                <h2 className="text-[14px] font-semibold text-[#17243A]">
                  MPU6050 & ML Classifier Gate Thresholds
                </h2>
                <p className="text-[12px] text-[#718096]">
                  Controls admission of ESP32 Pothole events into the municipal triage queue.
                </p>
              </div>

              <div>
                <label className="label-caps block text-[#52627A]">
                  Minimum Z-Axis Trigger (g)
                </label>
                <input
                  type="number"
                  disabled={!isAdmin}
                  step="0.1"
                  min="1.2"
                  max="4.0"
                  value={triggerG}
                  onChange={(e) => setTriggerG(Number(e.target.value))}
                  className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
                />
              </div>

              <div>
                <label className="label-caps block text-[#52627A]">
                  ML Pothole Confidence Cutoff (%)
                </label>
                <input
                  type="number"
                  disabled={!isAdmin}
                  step="1"
                  min="60"
                  max="99"
                  value={mlCutoff}
                  onChange={(e) => setMlCutoff(Number(e.target.value))}
                  className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
                />
              </div>

              <label className="neu-inset-sm flex cursor-pointer items-center justify-between p-3">
                <div>
                  <div className="text-[12px] font-semibold text-[#17243A]">
                    DEMO MODE Flag
                  </div>
                  <div className="text-[11px] text-[#718096]">
                    Clearly separates simulated sandbox telemetry from live ESP32 data.
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!isAdmin || Boolean(workspace.isLiveFirestore)}
                  checked={demoMode}
                  onChange={(e) => setDemoMode(e.target.checked)}
                  className="h-4 w-4 accent-[#356AE6] disabled:opacity-50"
                />
              </label>

              {savedNotice && (
                <div className="flex items-start gap-2 rounded-[11px] border border-[#86EFAC] bg-[#E8F8EE] p-2.5 text-[12px] text-[#15803D]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{savedNotice}</span>
                </div>
              )}

              {engineError && (
                <div className="rounded-[11px] border border-[#FCA5A5] bg-[#FEECEC] p-2.5 text-[12px] text-[#DC2626]">
                  {engineError}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={!isAdmin || savingEngine}
              onClick={handleSaveEngine}
              className="neu-btn-primary h-9.5 w-full text-[12px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {!isAdmin
                ? 'Admin Role Required to Modify Engine'
                : savingEngine
                  ? 'Recalculating Municipal Priorities...'
                  : 'Save & Recalculate All Priorities'}
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: Firebase, Cloud Firestore (10 Collections) & Separate Device API */}
      {activeTab === 'integrations' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="neu-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#17243A]">
                  <Database className="h-4 w-4 text-[#356AE6]" />
                  Firebase & Cloud Firestore
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    connectivity.status === 'connected'
                      ? 'border-[#86EFAC] bg-[#E8F8EE] text-[#15803D]'
                      : 'border-[#FDBA74] bg-[#FFF4E6] text-[#EA580C]'
                  }`}
                >
                  {connectivity.status.toUpperCase()}
                </span>
              </div>
              <p className="text-[12px] text-[#52627A]">{connectivity.message}</p>
              <div className="neu-inset-sm p-3 font-mono text-[11px] space-y-1 text-[#334155]">
                <div>Project ID: {FIREBASE_INTEGRATION_CONTRACT.projectId}</div>
                <div>Region / DB: {FIREBASE_INTEGRATION_CONTRACT.region} · {FIREBASE_INTEGRATION_CONTRACT.databaseId}</div>
                <div>Collections Bound: {firebaseReadiness.collectionsCount}</div>
                {missingFirebaseVars.length > 0 && (
                  <div className="text-[#DC2626]">
                    Missing Env: {missingFirebaseVars.join(', ')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={retestFirestoreConnection}
                className="neu-btn inline-flex h-8.5 w-full items-center justify-center gap-1.5 text-[12px] font-semibold cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-[#356AE6]" />
                Re-Test Live Firestore Connection
              </button>
            </div>

            <div className="neu-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#17243A]">
                  <KeyRound className="h-4 w-4 text-[#0F8B8D]" />
                  Separate ESP32 Device API Auth
                </div>
                <span className="rounded-full border border-[#5EEAD4] bg-[#E6FAF7] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#0F8B8D]">
                  ISOLATED
                </span>
              </div>
              <p className="text-[12px] text-[#52627A]">
                Hardware telemetry routes require a dedicated server-verified{' '}
                <span className="font-mono text-[#17243A]">X-Device-API-Key</span> header, completely separated from
                municipal user Firebase ID tokens.
              </p>
              <div className="neu-inset-sm p-3 font-mono text-[11px] space-y-1 text-[#334155]">
                <div>POST /api/telemetry/ingest (X-Device-API-Key)</div>
                <div>POST /api/device/sos (X-Device-API-Key)</div>
                <div>POST /api/simulator/telemetry (Demo User Auth)</div>
              </div>
            </div>

            <div className="neu-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#17243A]">
                  <Cpu className="h-4 w-4 text-[#356AE6]" />
                  Firestore Security Rules
                </div>
                <span className="rounded-full border border-[#86EFAC] bg-[#E8F8EE] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#15803D]">
                  LINTED
                </span>
              </div>
              <p className="text-[12px] text-[#52627A]">
                Hardened <span className="font-mono text-[#17243A]">firestore.rules</span> enforces default-deny,
                authoritative <span className="font-mono text-[#17243A]">/users/{'{uid}'}</span> role checks,
                zero self-role escalation, and schema validation across all 10 collections.
              </p>
              <div className="neu-inset-sm p-3 font-mono text-[11px] text-[#334155]">
                Deploy command: firebase deploy --only firestore:rules --project terra-track-53004
              </div>
            </div>
          </div>

          <div className="neu-card p-4">
            <h3 className="text-[13px] font-semibold text-[#17243A]">
              Configured Firestore Collections ({Object.values(FIRESTORE_COLLECTIONS).length} Bound Collections)
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5 font-mono text-[11px]">
              {Object.values(FIRESTORE_COLLECTIONS).map((col) => (
                <div
                  key={col}
                  className="neu-inset-sm px-3 py-2 text-[#17243A] font-medium"
                >
                  /{col}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal (Admin only) */}
      <Modal
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        title="Add Municipal Operator Account"
        subtitle="Provisions an operator profile in the municipal directory."
        footer={
          <>
            <button
              type="button"
              onClick={() => setAddUserOpen(false)}
              className="neu-btn h-8 px-3.5 text-[12px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-user-form"
              className="neu-btn-primary h-8 px-3.5 text-[12px] font-semibold cursor-pointer"
            >
              Create Account
            </button>
          </>
        }
      >
        <form id="add-user-form" onSubmit={handleCreateUserSubmit} className="space-y-3.5">
          <div>
            <label className="label-caps block text-[#52627A]">Full Name</label>
            <input
              required
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g., Jordan Reyes, PE"
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Municipal Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="j.reyes@metro-publicworks.gov"
              className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps block text-[#52627A]">Authoritative Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="neu-input mt-1.5 h-9 w-full px-2.5 text-[12px]"
              >
                <option value="Admin">Admin</option>
                <option value="Municipal Officer">Municipal Officer</option>
                <option value="Field Maintenance Team">Field Maintenance Team</option>
              </select>
            </div>
            <div>
              <label className="label-caps block text-[#52627A]">Department</label>
              <input
                required
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
              />
            </div>
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">District Scope</label>
            <input
              required
              type="text"
              value={districtScope}
              onChange={(e) => setDistrictScope(e.target.value)}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
