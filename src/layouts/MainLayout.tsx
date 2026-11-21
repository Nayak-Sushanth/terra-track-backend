import React, { useState } from 'react';
import {
  LayoutDashboard,
  Map as MapIcon,
  AlertOctagon,
  Hexagon,
  Wrench,
  Bell,
  Cpu,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Radio,
  ShieldAlert,
  LogOut,
  UserCog,
} from 'lucide-react';
import { NAVIGATION_ITEMS } from '../config/appConfig';
import { DatabaseStatusIndicator } from '../components/common/DatabaseStatusIndicator';
import type { AuthenticatedSession, LiveCollectionSyncState, ScreenId } from '../types';

const SCREEN_ICONS: Record<ScreenId, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  map: MapIcon,
  potholes: AlertOctagon,
  hotspots: Hexagon,
  repairs: Wrench,
  alerts: Bell,
  devices: Cpu,
  analytics: BarChart3,
  settings: Settings,
};

interface MainLayoutProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  session: AuthenticatedSession;
  demoModeEnabled: boolean;
  liveSyncState?: LiveCollectionSyncState;
  onReconnectFirestore?: () => void;
  activeSosCount: number;
  activeAlertsCount: number;
  onOpenSimulator: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  activeScreen,
  onNavigate,
  session,
  demoModeEnabled,
  liveSyncState,
  onReconnectFirestore,
  activeSosCount,
  activeAlertsCount,
  onOpenSimulator,
  onOpenProfile,
  onLogout,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeNav =
    NAVIGATION_ITEMS.find((item) => item.id === activeScreen) || NAVIGATION_ITEMS[0];

  const groupedSections: Array<'Operations' | 'Intelligence' | 'System'> = [
    'Operations',
    'Intelligence',
    'System',
  ];

  const initials = session.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('') || 'OP';

  const renderSidebarNav = (isMobile = false) => (
    <div className="flex h-full flex-col neu-sidebar text-[#17243A]">
      {/* Brand header inside soft elevated navigation panel */}
      <div
        className={`flex h-16 items-center border-b neu-divider px-3.5 ${
          collapsed && !isMobile ? 'justify-center' : 'justify-between'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            onNavigate('overview');
            setMobileMenuOpen(false);
          }}
          className="flex items-center gap-3 text-left min-w-0 group"
        >
          <div className="neu-btn-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-[13px] font-bold tracking-tight text-white">
            TT
          </div>
          {(!collapsed || isMobile) && (
            <div className="min-w-0">
              <div className="text-[15px] font-bold tracking-[-0.02em] text-[#17243A] leading-tight truncate group-hover:text-[#356AE6] transition-colors">
                TERRA Track
              </div>
              <div className="font-mono text-[10px] text-[#718096] leading-tight truncate mt-0.5">
                Municipal GIS · IoT
              </div>
            </div>
          )}
        </button>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="neu-btn flex h-8 w-8 items-center justify-center text-[#52627A] hover:text-[#17243A]"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          !collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="neu-btn flex h-8 w-8 items-center justify-center text-[#52627A] hover:text-[#356AE6]"
              title="Collapse sidebar to utility dock"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )
        )}
      </div>

      {collapsed && !isMobile && (
        <div className="flex justify-center border-b neu-divider py-2.5">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="neu-btn flex h-8 w-8 items-center justify-center text-[#52627A] hover:text-[#356AE6]"
            title="Expand navigation sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Navigation Sections (All 9 Screens Preserved) */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary Navigation">
        {groupedSections.map((section) => {
          const items = NAVIGATION_ITEMS.filter((item) => item.section === section);
          return (
            <div key={section}>
              {(!collapsed || isMobile) && (
                <div className="label-caps px-2.5 pb-2 text-[#718096]">{section}</div>
              )}
              <div className="space-y-1.5">
                {items.map((item) => {
                  const Icon = SCREEN_ICONS[item.id];
                  const isActive = item.id === activeScreen;
                  const showAlertBadge = item.id === 'alerts' && activeAlertsCount > 0;
                  const hasActiveSos = item.id === 'alerts' && activeSosCount > 0;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.id);
                        setMobileMenuOpen(false);
                      }}
                      title={collapsed && !isMobile ? item.label : undefined}
                      className={`group relative flex w-full items-center gap-3 px-3 py-2.5 text-[13px] whitespace-nowrap ${
                        isActive
                          ? 'neu-nav-active font-semibold'
                          : 'neu-nav-item font-medium'
                      } ${collapsed && !isMobile ? 'justify-center px-0' : ''}`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          isActive
                            ? 'text-[#356AE6]'
                            : hasActiveSos
                              ? 'text-[#DC2626]'
                              : 'text-[#718096] group-hover:text-[#356AE6]'
                        }`}
                      />
                      {(!collapsed || isMobile) && (
                        <>
                          <span className="flex-1 truncate text-left">{item.label}</span>
                          {showAlertBadge && (
                            <span
                              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-bold ${
                                hasActiveSos
                                  ? 'bg-[#DC2626] text-white shadow-[0_2px_6px_rgba(220,38,38,0.38)]'
                                  : isActive
                                    ? 'bg-[#356AE6] text-white'
                                    : 'neu-inset-sm text-[#17243A]'
                              }`}
                            >
                              {activeAlertsCount}
                            </span>
                          )}
                        </>
                      )}
                      {collapsed && !isMobile && showAlertBadge && (
                        <span
                          className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${
                            hasActiveSos ? 'bg-[#DC2626]' : 'bg-[#356AE6]'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom Authenticated Operator Profile & Sign-Out Footer */}
      <div className="border-t neu-divider p-3">
        {!collapsed || isMobile ? (
          <div className="neu-inset p-3 space-y-2.5">
            <button
              type="button"
              onClick={onOpenProfile}
              className="w-full text-left group"
              title="Open operator profile settings"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-[#17243A] group-hover:text-[#356AE6] transition-colors">
                  {session.fullName}
                </span>
                <span className="font-mono text-[10px] font-bold text-[#0F766E] shrink-0">
                  {session.mode === 'firebase' ? 'AUTH' : 'DEMO'}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[#718096]">
                {session.role}
              </div>
            </button>
            <div className="flex items-center gap-2 border-t neu-divider pt-2.5">
              <button
                type="button"
                onClick={onOpenProfile}
                className="neu-btn inline-flex h-7 flex-1 items-center justify-center gap-1.5 px-2 text-[11px] font-semibold text-[#17243A]"
              >
                <UserCog className="h-3.5 w-3.5 text-[#356AE6]" />
                Profile
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="neu-btn inline-flex h-7 items-center justify-center gap-1 px-2.5 text-[11px] font-semibold text-[#DC2626] hover:text-[#B91C1C]"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="neu-btn flex h-9 w-9 items-center justify-center font-mono text-[11px] font-bold text-[#356AE6]"
              title={`${session.fullName} (${session.role}) — Profile`}
            >
              {initials}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="neu-btn flex h-8 w-9 items-center justify-center text-[#DC2626]"
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#E9EDF3] text-[#17243A]">
      {/* Desktop Persistent Elevated Neumorphic Sidebar (252px or 68px dock) */}
      <aside
        className={`hidden lg:block shrink-0 z-20 transition-[width] duration-150 ${
          collapsed ? 'w-[68px]' : 'w-[252px]'
        }`}
      >
        {renderSidebarNav(false)}
      </aside>

      {/* Mobile / Tablet Slide-over Navigation */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[900] flex lg:hidden bg-[#17243A]/35 backdrop-blur-[2px]"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="h-full w-[264px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {renderSidebarNav(true)}
          </div>
        </div>
      )}

      {/* Main Command Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Contextual Elevated Top Bar */}
        <header className="neu-header z-10 flex h-16 shrink-0 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="neu-btn flex h-9 w-9 items-center justify-center text-[#17243A] lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-[17px] font-bold tracking-[-0.02em] text-[#17243A]">
                  {activeNav.label}
                </h1>
                {session.mode === 'demo' || demoModeEnabled ? (
                  <span className="hidden sm:inline-flex h-5 items-center rounded-lg neu-inset-sm px-2 font-mono text-[10px] font-semibold text-[#52627A] whitespace-nowrap shrink-0">
                    DEMO MODE · {session.role.toUpperCase()}
                  </span>
                ) : (
                  <span className="hidden sm:inline-flex h-5 items-center rounded-lg border border-[#99F6E4] bg-[#E3F5F4] px-2 font-mono text-[10px] font-semibold text-[#0F766E] whitespace-nowrap shrink-0">
                    FIREBASE AUTH · {session.role.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="hidden md:block truncate text-[12px] text-[#718096] mt-0.5">
                {activeNav.description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {session.mode === 'firebase' && liveSyncState && (
              <DatabaseStatusIndicator
                syncState={liveSyncState}
                onReconnect={onReconnectFirestore}
              />
            )}

            {activeSosCount > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('alerts')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#FCA5A5] bg-[#FDECEC] px-3 text-[12px] font-bold text-[#DC2626] shadow-[3px_3px_8px_rgba(220,38,38,0.18),-3px_-3px_7px_rgba(255,255,255,0.85)] hover:bg-[#FCE0E0] active:shadow-[inset_2px_2px_5px_rgba(220,38,38,0.2)] transition-all whitespace-nowrap shrink-0"
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                <span>{activeSosCount} Active Manual SOS</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSimulator}
              className="neu-btn-primary inline-flex h-9 items-center gap-2 px-3.5 text-[12px] font-semibold whitespace-nowrap shrink-0"
            >
              <Radio className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Simulate ESP32 Packet</span>
              <span className="sm:hidden">Simulate</span>
            </button>
          </div>
        </header>

        {/* Scrollable Soft Cool-Grey Workspace Canvas */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
};
