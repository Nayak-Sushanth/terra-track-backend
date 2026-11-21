import React from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { UserRole } from '../../types';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  screenTitle: string;
  onFallbackNavigate?: () => void;
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  allowedRoles,
  screenTitle,
  onFallbackNavigate,
  children,
}) => {
  const { session } = useAuth();

  if (!session) {
    return null;
  }

  if (session.status === 'Suspended') {
    return (
      <div className="neu-sos-panel mx-auto max-w-lg p-7 text-center space-y-3">
        <ShieldAlert className="mx-auto h-9 w-9 text-[#DC2626]" />
        <h2 className="text-[16px] font-bold text-[#17243A]">Account Suspended</h2>
        <p className="text-[12px] text-[#52627A]">
          Your municipal account (<span className="font-mono">{session.email}</span>) is currently
          suspended. Contact a TERRA Track Admin to restore access.
        </p>
      </div>
    );
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return (
      <div className="neu-card mx-auto max-w-lg p-7 space-y-4">
        <div className="flex items-center gap-2.5 text-[#DC2626]">
          <ShieldAlert className="h-5 w-5" />
          <h2 className="text-[15px] font-bold text-[#17243A]">
            Role Access Restricted — {screenTitle}
          </h2>
        </div>
        <p className="text-[12px] text-[#52627A] leading-relaxed">
          Your authoritative server-verified role is{' '}
          <span className="font-mono font-semibold text-[#17243A]">{session.role}</span>. This view
          requires one of:{' '}
          <span className="font-mono font-semibold text-[#356AE6]">
            {allowedRoles.join(', ')}
          </span>
          .
        </p>
        {onFallbackNavigate && (
          <button
            type="button"
            onClick={onFallbackNavigate}
            className="neu-btn-primary inline-flex h-9 items-center gap-1.5 px-4 text-[12px] font-semibold"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Return to Overview Dashboard
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;
};
