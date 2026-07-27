export const OPS_ADMIN_BASE = '/nz-admin';
export const OPS_API_BASE = '/nz';

export function adminBaseForPathname(pathname: string): string {
  return pathname === OPS_ADMIN_BASE || pathname.startsWith(`${OPS_ADMIN_BASE}/`)
    ? OPS_ADMIN_BASE
    : '';
}

export function stripAdminBase(pathname: string): string {
  const base = adminBaseForPathname(pathname);
  if (!base) return pathname;
  const stripped = pathname.slice(base.length);
  return stripped || '/';
}

export function adminUrl(path: string, pathname: string): string {
  const base = adminBaseForPathname(pathname);
  return `${base}${path}`;
}

export function apiUrl(path: string, pathname: string): string {
  return adminBaseForPathname(pathname) ? `${OPS_API_BASE}${path}` : path;
}
