import { useState } from 'react';
import { useAuth } from './auth';
import { Link } from './router';

export interface NavItem {
  path: string;
  label: string;
  live: boolean;
  icon?: string;
  group?: string;
}

// Single source of truth for the sidebar; `live: false` sections render the
// WP-UI-02 placeholder page until their screen ships.
export const NAV: NavItem[] = [
  { path: '/app/dashboard', label: 'Dashboard', live: true, icon: '📊', group: 'Overview' },
  { path: '/app/intake', label: 'New intake', live: true, icon: '➕', group: 'Operations' },
  { path: '/app/drafts', label: 'Intake drafts', live: true, icon: '📝', group: 'Operations' },
  { path: '/app/review-queue', label: 'Review queue', live: true, icon: '🔎', group: 'Operations' },
  { path: '/app/orders', label: 'Orders', live: true, icon: '🧾', group: 'Operations' },
  { path: '/app/customers', label: 'Customers', live: true, icon: '👥', group: 'Operations' },
  { path: '/app/payments', label: 'Payments', live: true, icon: '💳', group: 'Operations' },
  { path: '/app/kitchen', label: 'Kitchen board', live: true, icon: '🍱', group: 'Operations' },
  { path: '/app/exceptions', label: 'Exceptions', live: true, icon: '⚠️', group: 'Operations' },
  { path: '/app/catalog', label: 'Catalog', live: true, icon: '📦', group: 'Data' },
  { path: '/app/reports', label: 'Reports', live: true, icon: '📈', group: 'Data' },
  { path: '/app/staff', label: 'Staff & roles', live: true, icon: '🔑', group: 'Admin' },
  { path: '/app/settings', label: 'Settings', live: true, icon: '⚙️', group: 'Admin' },
  { path: '/app/audit', label: 'Audit log', live: true, icon: '🛡️', group: 'Admin' },
];

export function sectionLabel(path: string): string {
  return NAV.find((n) => n.path === path)?.label ?? 'Nutrezee';
}

const GROUP_ORDER = ['Overview', 'Operations', 'Data', 'Admin'];

export function Shell({ path, children }: { path: string; children: React.ReactNode }): React.JSX.Element {
  const { me, logout } = useAuth();
  const [signOutError, setSignOutError] = useState(false);

  function onSignOut(): void {
    setSignOutError(false);
    logout().catch(() => setSignOutError(true));
  }

  const initial = (me?.name ?? '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="layout">
      <aside className="sidebar" aria-label="Sections">
        <div className="brand">
          <span className="logo" aria-hidden>🌿</span>
          <span>Nutrezee<span className="sub">Operations</span></span>
        </div>
        <nav>
          {GROUP_ORDER.map((group) => {
            const items = NAV.filter((n) => (n.group ?? 'Operations') === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div className="navGroup">{group}</div>
                {items.map((item) => (
                  <Link key={item.path} to={item.path} className={`navItem${path === item.path ? ' active' : ''}`}>
                    <span className="ico" aria-hidden>{item.icon ?? '•'}</span>
                    <span>{item.label}</span>
                    {item.live ? null : <span className="soonBadge">soon</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="header">
          <h1>{sectionLabel(path)}</h1>
          <div className="who" data-initial={initial}>
            {signOutError ? <span className="error inlineError">Sign out failed — retry</span> : null}
            <span>{me?.name}</span>
            <button type="button" className="linkBtn" onClick={onSignOut}>Sign out</button>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
