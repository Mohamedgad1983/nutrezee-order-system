import { useState } from 'react';
import { useAuth } from './auth';
import { Link } from './router';

export interface NavItem {
  path: string;
  label: string;
  live: boolean;
}

// Single source of truth for the sidebar; `live: false` sections render the
// WP-UI-02 placeholder page until their screen ships.
export const NAV: NavItem[] = [
  { path: '/app/intake', label: 'New intake', live: true },
  { path: '/app/drafts', label: 'Intake drafts', live: true },
  { path: '/app/review-queue', label: 'Review queue', live: true },
  { path: '/app/orders', label: 'Orders', live: true },
  { path: '/app/payments', label: 'Payments', live: true },
  { path: '/app/kitchen', label: 'Kitchen board', live: true },
  { path: '/app/exceptions', label: 'Exceptions', live: false },
  { path: '/app/reports', label: 'Reports', live: false },
  { path: '/app/staff', label: 'Staff & roles', live: false },
  { path: '/app/settings', label: 'Settings', live: false },
  { path: '/app/audit', label: 'Audit log', live: false },
];

export function sectionLabel(path: string): string {
  return NAV.find((n) => n.path === path)?.label ?? 'Nutrezee';
}

export function Shell({ path, children }: { path: string; children: React.ReactNode }): React.JSX.Element {
  const { me, logout } = useAuth();
  const [signOutError, setSignOutError] = useState(false);

  function onSignOut(): void {
    setSignOutError(false);
    logout().catch(() => setSignOutError(true));
  }

  return (
    <div className="layout">
      <aside className="sidebar" aria-label="Sections">
        <div className="brand">Nutrezee</div>
        <nav>
          {NAV.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`navItem${path === item.path ? ' active' : ''}`}
            >
              <span>{item.label}</span>
              {item.live ? null : <span className="soonBadge">soon</span>}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="header">
          <h1>{sectionLabel(path)}</h1>
          <div className="who">
            {signOutError ? <span className="error inlineError">Sign out failed — retry</span> : null}
            <span>{me?.name}</span>
            <button type="button" className="linkBtn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
