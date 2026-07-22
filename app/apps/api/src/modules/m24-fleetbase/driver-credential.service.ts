import type { Pool } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { withTransaction } from '../../platform/db/tx';
import { newId } from '../../platform/ids';
import {
  FleetbaseCredentialClient,
  FleetbaseCredentialClientError,
  type FleetbaseCredentialDriver,
  type FleetbaseCredentialGateway,
} from './fleetbase-credentials.client';

export interface CredentialDriverView {
  id: string;
  name: string;
  phone_hint: string | null;
  status: string | null;
  online: boolean;
}

export class DriverCredentialError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'integration_unavailable' | 'upstream_rejected',
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export class DriverCredentialService {
  private gateway: FleetbaseCredentialGateway | null;

  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    gateway?: FleetbaseCredentialGateway,
  ) {
    this.gateway = gateway ?? null;
  }

  async listDrivers(): Promise<CredentialDriverView[]> {
    const drivers = await this.call(() => this.client().listDrivers());
    return drivers
      .filter((driver) => Boolean(driver.public_id && driver.user_uuid))
      .map((driver) => this.toView(driver))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async rotate(
    actor: StaffContext,
    fleetbaseDriverId: string,
    input: { password?: string; password_confirmation?: string },
  ): Promise<{ rotation_id: string; status: 'completed' }> {
    this.validateDriverId(fleetbaseDriverId);
    const password = this.validatePassword(input);
    const driver = await this.call(() => this.client().findDriver(fleetbaseDriverId));
    if (!driver || driver.public_id !== fleetbaseDriverId || !driver.user_uuid) {
      throw new DriverCredentialError('not_found');
    }

    const rotationId = newId();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO driver_credential_rotation
           (id, fleetbase_driver_id, status, requested_by, created_by)
         VALUES ($1,$2,'requested',$3,$3)`,
        [rotationId, fleetbaseDriverId, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'delivery.driver_password_rotation_requested',
        actor: this.actor(actor),
        entityType: 'driver_credential_rotation',
        entityId: rotationId,
        relatedRefs: { fleetbase_driver_id: fleetbaseDriverId },
        after: { status: 'requested' },
        severity: 'high',
      });
    });

    try {
      await this.call(() => this.client().changePassword(driver.user_uuid as string, password));
    } catch (error) {
      const code = error instanceof DriverCredentialError ? error.code : 'integration_unavailable';
      await this.finish(actor, rotationId, fleetbaseDriverId, 'failed', code);
      throw error;
    }
    // Keep completion recording outside the upstream catch. If the local audit store fails
    // after Fleetbase succeeds, the ledger remains "requested" instead of falsely saying
    // the password change failed. Reapplying the same password is safe and idempotent.
    await this.finish(actor, rotationId, fleetbaseDriverId, 'completed');
    return { rotation_id: rotationId, status: 'completed' };
  }

  private client(): FleetbaseCredentialGateway {
    if (!this.gateway) this.gateway = FleetbaseCredentialClient.fromEnv();
    return this.gateway;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DriverCredentialError) throw error;
      if (error instanceof FleetbaseCredentialClientError) {
        if (error.status === 404) throw new DriverCredentialError('not_found');
        if ([400, 401, 403, 422].includes(error.status)) {
          throw new DriverCredentialError('upstream_rejected', { reason: 'credential_service_denied' });
        }
      }
      throw new DriverCredentialError('integration_unavailable');
    }
  }

  private validateDriverId(id: string): void {
    if (!/^driver_[A-Za-z0-9]+$/.test(id)) {
      throw new DriverCredentialError('validation_failed', { field: 'driver_id' });
    }
  }

  private validatePassword(input: { password?: string; password_confirmation?: string }): string {
    const password = input.password ?? '';
    if (password !== (input.password_confirmation ?? '')) {
      throw new DriverCredentialError('validation_failed', { field: 'password_confirmation' });
    }
    if (
      password.length < 12 || password.length > 128
      || !/[a-z]/.test(password) || !/[A-Z]/.test(password)
      || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)
    ) {
      throw new DriverCredentialError('validation_failed', { field: 'password' });
    }
    return password;
  }

  private toView(driver: FleetbaseCredentialDriver): CredentialDriverView {
    const phone = driver.phone?.replace(/\D/g, '') ?? '';
    return {
      id: driver.public_id as string,
      name: driver.name?.trim() || 'Driver',
      phone_hint: phone.length >= 2 ? `••${phone.slice(-2)}` : null,
      status: driver.status ?? null,
      online: driver.online === true,
    };
  }

  private async finish(
    actor: StaffContext,
    rotationId: string,
    fleetbaseDriverId: string,
    status: 'completed' | 'failed',
    failureCode?: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE driver_credential_rotation
            SET status=$2, failure_code=$3, completed_at=now(), updated_at=now(), updated_by=$4,
                version=version+1
          WHERE id=$1 AND status='requested'`,
        [rotationId, status, failureCode ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: status === 'completed'
          ? 'delivery.driver_password_rotated'
          : 'delivery.driver_password_rotation_failed',
        actor: this.actor(actor),
        entityType: 'driver_credential_rotation',
        entityId: rotationId,
        relatedRefs: { fleetbase_driver_id: fleetbaseDriverId },
        before: { status: 'requested' },
        after: { status, ...(failureCode ? { failure_code: failureCode } : {}) },
        severity: 'high',
      });
    });
  }

  private actor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }
}
