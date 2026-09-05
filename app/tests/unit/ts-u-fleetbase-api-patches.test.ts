import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// TS-U guard for the owner-authorized Fleetbase vendor patch A60 (ops/fleetbase/api-patches/a60).
// The diff, the checksum manifest and the compose fragment must name the same five files and the
// patch must keep to read paths (no writes, no orderConfig eager load that would change output).
const root = join(__dirname, '..', '..', '..', 'ops', 'fleetbase', 'api-patches', 'a60');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

const FILES = [
  'fleetops-api/server/src/Http/Controllers/Api/v1/OrderController.php',
  'fleetops-api/server/src/Http/Controllers/Internal/v1/OrderController.php',
  'fleetops-api/server/src/Http/Resources/v1/Index/Payload.php',
  'fleetops-api/server/src/Models/Order.php',
  'fleetops-api/server/src/Models/Place.php',
];

describe('TS-U fleetbase api patch a60', () => {
  const diff = read('a60.diff');
  const sums = read('checksums.md5');
  const compose = read('compose.fragment.yml');

  it('patches exactly the five declared files', () => {
    for (const file of FILES) {
      expect(diff).toContain(`+++ b/${file}`);
      expect(sums).toMatch(new RegExp(`^[0-9a-f]{32} [0-9a-f]{32} ${file.replace(/[.]/g, '\\.')}$`, 'm'));
      expect(compose).toContain(`/opt/fleetbase/patches/a60/${file}:/fleetbase/api/vendor/fleetbase/${file}:ro`);
    }
    expect(diff.match(/^\+\+\+ b\//gm)).toHaveLength(FILES.length);
  });

  it('adds the eager-load list without touching orderConfig or write paths', () => {
    expect(diff).toContain('public static function apiListRelations(): array');
    expect(diff).toContain("'trackingNumber.owner'");
    expect(diff).toContain('Contact::class => [\'photo\', \'user\']');
    expect(diff).not.toMatch(/^\+.*'orderConfig'/m);
    expect(diff).not.toMatch(/^\+.*(->save\(|->update\(|->delete\(|DB::)/m);
    expect(diff).toContain('public static function onQueryRecord($query, $request): void');
    expect(diff).toContain('$query->with(Order::apiListRelations());');
  });

  it('memoises place avatar options for 60 s and makes index counts lazy', () => {
    expect(diff).toContain("static $a60Memo = null;");
    expect(diff).toContain("'expires' => microtime(true) + 60");
    expect(diff).toContain('fn () => $this->entities()->count()');
    expect(diff).toContain('fn () => $this->waypoints()->count()');
  });

  it('ships an installer that verifies both checksum sets', () => {
    const install = read('install.sh');
    expect(install).toContain('md5sum -c');
    expect(install).toContain('patch -p1');
    expect(install).toContain('checksums.md5');
  });
});
