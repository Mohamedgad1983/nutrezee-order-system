import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
}

function gitFromRoot(args: string[]): string {
  const repoRoot = git(['rev-parse', '--show-toplevel']).trim();
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

describe('output and local-secret git safety', () => {
  it('keeps extraction output, local config and env files ignored', () => {
    const repoRoot = git(['rev-parse', '--show-toplevel']).trim();
    const ignored = execFileSync('git', [
      'check-ignore',
      '-v',
      'migration-output/run/raw/customers.json',
      'tools/legacy-migration/migration-output/run/raw/customers.json',
      'tools/legacy-migration/config.json',
      'tools/legacy-migration/.env.migration',
      'tools/legacy-migration/admin.legacy-secrets.json',
    ], { cwd: repoRoot, encoding: 'utf8' });

    expect(ignored).toContain('migration-output/run/raw/customers.json');
    expect(ignored).toContain('tools/legacy-migration/migration-output/run/raw/customers.json');
    expect(ignored).toContain('tools/legacy-migration/config.json');
    expect(ignored).toContain('tools/legacy-migration/.env.migration');
    expect(ignored).toContain('tools/legacy-migration/admin.legacy-secrets.json');
  });

  it('does not track local output or secret-bearing config names', () => {
    const tracked = gitFromRoot(['ls-files', 'tools/legacy-migration']);
    expect(tracked).not.toMatch(/(^|\/)migration-output\//);
    expect(tracked).not.toMatch(/(^|\/)config\.json$/m);
    expect(tracked).not.toMatch(/(^|\/)\.env(\.|$)/m);
    expect(tracked).not.toMatch(/legacy-secrets\.json$/m);
  });
});
