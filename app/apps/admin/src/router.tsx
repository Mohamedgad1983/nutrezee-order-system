import { useEffect, useState } from 'react';
import { adminUrl, stripAdminBase } from './runtimePaths';

// Deliberately tiny pathname router (no dependency): the SPA owns /app/* while
// the API owns its root prefixes (/auth, /drafts, ... — see docker/nginx.admin.conf).
// On ops.nutreeze.com the same SPA is mounted at /nz-admin/* and the API at /nz/*.

function currentPath(): string {
  return stripAdminBase(window.location.pathname);
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
  const resolved = adminUrl(to, window.location.pathname);
  if (opts?.replace) {
    window.history.replaceState(null, '', resolved);
  } else {
    window.history.pushState(null, '', resolved);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPop = (): void => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export function Redirect({ to }: { to: string }): null {
  useEffect(() => {
    // Replace, never push: a pushed redirect makes the back button bounce
    // between the source and target forever.
    navigate(to, { replace: true });
  }, [to]);
  return null;
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a
      href={adminUrl(to, window.location.pathname)}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
