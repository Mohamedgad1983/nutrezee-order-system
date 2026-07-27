import { useEffect, useState } from 'react';

// Deliberately tiny pathname router (no dependency): the SPA owns /app/* while
// the API owns its root prefixes (/auth, /drafts, ... — see docker/nginx.admin.conf).

export function navigate(to: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
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
      href={to}
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
