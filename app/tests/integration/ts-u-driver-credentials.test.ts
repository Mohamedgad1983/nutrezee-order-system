import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import {
  DriverCredentialService,
} from '../../apps/api/src/modules/m24-fleetbase/driver-credential.service';
import {
  FleetbaseCredentialClientError,
  type FleetbaseCredentialDriver,
  type FleetbaseCredentialGateway,
} from '../../apps/api/src/modules/m24-fleetbase/fleetbase-credentials.client';

class FakeGateway implements FleetbaseCredentialGateway {
  drivers: FleetbaseCredentialDriver[] = [{
    id: '1',
    uuid: 'driver-uuid-1',
    public_id: 'driver_AAAAAA',
    user_uuid: 'user-sensitive-uuid',
    name: 'Driver One',
    phone: '+96560000001',
    status: 'available',
    online: true,
  }];
  passwordChanges: Array<{ userUuid: string; password: string }> = [];
  failure: FleetbaseCredentialClientError | null = null;

  async listDrivers(): Promise<FleetbaseCredentialDriver[]> { return this.drivers; }
  async findDriver(id: string): Promise<FleetbaseCredentialDriver | null> {
    return this.drivers.find((driver) => driver.public_id === id) ?? null;
  }
  async changePassword(userUuid: string, password: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.passwordChanges.push({ userUuid, password });
  }
}

let pool: Pool;
let gateway: FakeGateway;
let service: DriverCredentialService;
const actor: StaffContext = {
  staffId: 'staff-logistics',
  name: 'Logistics Manager',
  email: 'logistics@example.test',
  locale: 'en',
  roles: ['logistics_manager'],
  sessionId: 'session-logistics',
};

beforeAll(async () => {
  pool = await freshDb();
  await pool.query(
    `INSERT INTO staff_user (id,name_en,email,created_by)
     VALUES ($1,$2,$3,'test')`,
    [actor.staffId, actor.name, actor.email],
  );
  gateway = new FakeGateway();
  service = new DriverCredentialService(pool, new AuditService(), gateway);
}, 60_000);

afterAll(async () => { await pool.end(); });

describe('WP-OPS-02 driver credential rotation', () => {
  it('seeds a dedicated Logistics Manager role and narrow permission only', async () => {
    const { rows } = await pool.query(
      `SELECT r.code, array_agg(p.code ORDER BY p.code) AS permissions
         FROM role r
         LEFT JOIN role_permission rp ON rp.role_id=r.id
         LEFT JOIN permission p ON p.id=rp.permission_id
        WHERE r.code IN ('logistics_manager','ops_manager','admin','super_admin')
        GROUP BY r.code ORDER BY r.code`,
    );
    const byRole = Object.fromEntries(rows.map((row) => [row.code, row.permissions]));
    expect(byRole.logistics_manager).toContain('delivery.driver.credentials.rotate');
    expect(byRole.super_admin).toContain('delivery.driver.credentials.rotate');
    expect(byRole.ops_manager).not.toContain('delivery.driver.credentials.rotate');
    expect(byRole.admin).not.toContain('delivery.driver.credentials.rotate');
    const mode = await pool.query(`SELECT value->>'logistics_manager' AS mode FROM setting WHERE key='rbac_enforcement_mode'`);
    expect(mode.rows[0].mode).toBe('deny');
  });

  it('returns only the minimum driver view and masks the phone', async () => {
    const list = await service.listDrivers();
    expect(list).toEqual([{
      id: 'driver_AAAAAA',
      name: 'Driver One',
      phone_hint: '••01',
      status: 'available',
      online: true,
    }]);
    expect(JSON.stringify(list)).not.toContain('user-sensitive-uuid');
    expect(JSON.stringify(list)).not.toContain('+96560000001');
  });

  it('derives the Fleetbase user from the driver and records secret-free HIGH audits', async () => {
    const password = 'Strong!Pass2026';
    const result = await service.rotate(actor, 'driver_AAAAAA', {
      password,
      password_confirmation: password,
    });
    expect(result.status).toBe('completed');
    expect(gateway.passwordChanges).toEqual([{ userUuid: 'user-sensitive-uuid', password }]);

    const ledger = await pool.query(
      `SELECT fleetbase_driver_id,status,failure_code FROM driver_credential_rotation WHERE id=$1`,
      [result.rotation_id],
    );
    expect(ledger.rows[0]).toMatchObject({
      fleetbase_driver_id: 'driver_AAAAAA',
      status: 'completed',
      failure_code: null,
    });
    const audit = await pool.query(
      `SELECT event_type,severity,related_refs,before,after
         FROM audit_event WHERE entity_id=$1 ORDER BY occurred_at`,
      [result.rotation_id],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'delivery.driver_password_rotation_requested',
      'delivery.driver_password_rotated',
    ]);
    expect(audit.rows.every((row) => row.severity === 'high')).toBe(true);
    const persisted = JSON.stringify({ ledger: ledger.rows, audit: audit.rows });
    expect(persisted).not.toContain(password);
    expect(persisted).not.toContain('user-sensitive-uuid');
  });

  it('rejects weak/mismatched passwords and arbitrary user identifiers before any write', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM driver_credential_rotation`);
    await expect(service.rotate(actor, 'user_sensitive_uuid', {
      password: 'Strong!Pass2026',
      password_confirmation: 'Strong!Pass2026',
    })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.rotate(actor, 'driver_AAAAAA', {
      password: 'short',
      password_confirmation: 'different',
    })).rejects.toMatchObject({ code: 'validation_failed' });
    const after = await pool.query(`SELECT count(*)::int AS n FROM driver_credential_rotation`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('does not rotate when the requested public id is not a Fleetbase driver', async () => {
    await expect(service.rotate(actor, 'driver_BBBBBB', {
      password: 'Another!Pass2026',
      password_confirmation: 'Another!Pass2026',
    })).rejects.toMatchObject({ code: 'not_found' });
    expect(gateway.passwordChanges).toHaveLength(1);
  });

  it('persists a secret-free failed outcome when Fleetbase rejects the service token', async () => {
    gateway.failure = new FleetbaseCredentialClientError(403, 'fleetbase_http_403');
    const password = 'Failed!Pass2026';
    await expect(service.rotate(actor, 'driver_AAAAAA', {
      password,
      password_confirmation: password,
    })).rejects.toMatchObject({ code: 'upstream_rejected' });
    gateway.failure = null;

    const { rows } = await pool.query(
      `SELECT id,status,failure_code FROM driver_credential_rotation
        WHERE fleetbase_driver_id='driver_AAAAAA' ORDER BY requested_at DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({ status: 'failed', failure_code: 'upstream_rejected' });
    const audit = await pool.query(
      `SELECT event_type,after FROM audit_event WHERE entity_id=$1 ORDER BY occurred_at`,
      [rows[0].id],
    );
    expect(audit.rows.at(-1)?.event_type).toBe('delivery.driver_password_rotation_failed');
    expect(JSON.stringify({ rows, audit: audit.rows })).not.toContain(password);
  });
});
