import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootUrl = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, rootUrl), 'utf8');

describe('TS-U A28 single operations admin boundary', () => {
  it('ships only the normal Nutrezee admin bundle', () => {
    const packageJson = JSON.parse(read('app/apps/admin/package.json')) as {
      scripts?: Record<string, string>;
    };
    const dockerfile = read('docker/Dockerfile.admin');
    const nginx = read('docker/nginx.admin.conf');

    expect(packageJson.scripts?.['build:ops']).toBeUndefined();
    expect(dockerfile).not.toContain('dist-ops');
    expect(nginx).not.toContain('/nz-admin');
  });

  it('does not retain the removed subpath runtime or Caddy mount snippet', () => {
    expect(existsSync(new URL('app/apps/admin/src/runtimePaths.ts', rootUrl))).toBe(false);
    expect(existsSync(new URL('ops/fleetbase/caddy-nutrezee-admin.snippet', rootUrl))).toBe(false);
  });
});
