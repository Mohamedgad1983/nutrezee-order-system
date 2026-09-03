import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const consoleRoot = new URL('../../../ops/fleetbase/console/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, consoleRoot), 'utf8');

const dockerfile = read('Dockerfile');
const nginx = read('nginx.conf');

describe('TS-U A45 Fleet-Ops Console production performance', () => {
  it('builds a real production artifact while retaining runtime configuration', () => {
    expect(dockerfile).toContain('ARG ENVIRONMENT=production');
    expect(dockerfile).toContain('ARG DISABLE_RUNTIME_CONFIG=false');
    expect(dockerfile).toContain('ENV DISABLE_RUNTIME_CONFIG=$DISABLE_RUNTIME_CONFIG');
    expect(dockerfile).toContain('test "$ENVIRONMENT" = production');
    expect(dockerfile).toContain('test "$DISABLE_RUNTIME_CONFIG" = false');
    expect(dockerfile).toContain('pnpm build --environment "$ENVIRONMENT"');
    expect(dockerfile).toContain('CONSOLE_RELEASE=0.7.48-a48.1');
    expect(dockerfile).toContain("'%22environment%22%3A%22production%22'");
    expect(dockerfile).toContain("! grep -q '%22environment%22%3A%22development%22'");
  });

  it('preserves the extension theme across production asset fingerprinting', () => {
    expect(dockerfile).toContain("-name 'engine*.css'");
    expect(dockerfile).toContain(
      "theme_alias='/usr/share/nginx/html/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css'",
    );
    expect(dockerfile).toContain('test -s "$theme_alias"');
  });

  it('compresses text assets and caches only fingerprinted resources immutably', () => {
    expect(nginx).toContain('gzip on;');
    expect(nginx).toContain('gzip_comp_level 6;');
    expect(nginx).toContain('application/javascript');
    expect(nginx).toContain('text/css');
    expect(nginx).toContain('public, max-age=31536000, immutable');
    expect(nginx).toMatch(/\[0-9a-f\]\{16,\}/);
    expect(nginx).toContain('no-cache, must-revalidate');
  });

  it('never clears the whole origin cache and keeps runtime manifests uncached', () => {
    expect(nginx).not.toContain('Clear-Site-Data');
    expect(nginx).toContain('location = /fleetbase.config.json');
    expect(nginx).toContain('location = /extensions.json');
    expect(nginx).toContain('no-cache, no-store, must-revalidate');
  });
});
