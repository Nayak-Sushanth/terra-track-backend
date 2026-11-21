import React, { useEffect, useState } from 'react';
import { User, LogOut, ShieldCheck, CheckCircle2, Mail } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useAuth } from '../../contexts/AuthContext';

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ open, onClose }) => {
  const { session, updateOwnProfile, logout, resendVerificationEmail } = useAuth();
  const [fullName, setFullName] = useState(session?.fullName || '');
  const [department, setDepartment] = useState(session?.department || '');
  const [districtScope, setDistrictScope] = useState(session?.districtScope || '');
  const [phone, setPhone] = useState(session?.phone || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session && open) {
      setFullName(session.fullName);
      setDepartment(session.department);
      setDistrictScope(session.districtScope);
      setPhone(session.phone);
      setNotice(null);
    }
  }, [session, open]);

  if (!session) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await updateOwnProfile({ fullName, department, districtScope, phone });
      setNotice('Profile saved. Role permissions remain managed exclusively by Admin & backend.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      await resendVerificationEmail();
      setNotice('Verification email dispatched via Firebase Authentication.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to send verification email.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Operator Profile & Session"
      subtitle="Manage your contact details and verify your authoritative backend role."
      maxWidthClass="max-w-lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={async () => {
              onClose();
              await logout();
            }}
            className="neu-btn inline-flex h-9 items-center gap-1.5 px-3.5 text-[12px] font-semibold text-[#DC2626]"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="neu-btn h-9 px-3.5 text-[12px] font-medium text-[#17243A]"
            >
              Close
            </button>
            <button
              type="submit"
              form="user-profile-form"
              disabled={saving}
              className="neu-btn-primary h-9 px-4 text-[12px] font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Verified Identity Summary */}
        <div className="neu-inset p-3.5 space-y-2 font-mono text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-sans text-[12px] font-bold text-[#17243A]">
              <User className="h-4 w-4 text-[#356AE6]" />
              {session.email}
            </span>
            <span
              className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold ${
                session.mode === 'firebase'
                  ? 'border-[#99F6E4] bg-[#E3F5F4] text-[#0F766E]'
                  : 'border-[#CBD5E1] bg-[#EEF2F7] text-[#52627A]'
              }`}
            >
              {session.mode === 'firebase' ? 'FIREBASE AUTH' : 'DEMO SANDBOX'}
            </span>
          </div>
          <div className="flex justify-between text-[#52627A]">
            <span>Verified UID</span>
            <span className="text-[#17243A] font-medium">{session.uid}</span>
          </div>
          <div className="flex justify-between text-[#52627A]">
            <span>Authoritative Role (Read-Only)</span>
            <span className="inline-flex items-center gap-1 font-bold text-[#356AE6]">
              <ShieldCheck className="h-3.5 w-3.5" />
              {session.role}
            </span>
          </div>
          {session.mode === 'firebase' && !session.emailVerified && (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-[#FDBA74] bg-[#FEF3E6] px-3 py-2 font-sans text-[11px] text-[#9A3412]">
              <span>Email address not yet verified</span>
              <button
                type="button"
                onClick={handleResendVerification}
                className="inline-flex items-center gap-1 font-semibold text-[#C2410C] hover:underline"
              >
                <Mail className="h-3 w-3" /> Send Verification
              </button>
            </div>
          )}
        </div>

        <form id="user-profile-form" onSubmit={handleSave} className="space-y-3.5">
          <div>
            <label className="label-caps block text-[#52627A]">Full Name</label>
            <input
              required
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Contact Phone / Radio</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1-415-555-0100"
              className="neu-input mt-1.5 h-9 w-full px-3 font-mono text-[12px]"
            />
          </div>
        </form>

        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-[#86EFAC] bg-[#E8F8EE] p-3 text-[12px] text-[#166534]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
