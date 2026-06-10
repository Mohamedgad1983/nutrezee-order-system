import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { HealthController } from './platform/health/health.controller';
import { AuthController } from './platform/auth/auth.controller';
import { getPool } from './platform/config/database';
import { AuditReadQueue, AuditService } from './platform/audit/audit.service';
import { OutboxDispatcher, OutboxService } from './platform/outbox/outbox.service';
import { IdempotencyService } from './platform/idempotency/idempotency.service';
import { SettingsReader } from './platform/settings/settings-reader';
import { SessionService } from './platform/auth/session.service';
import { AccessService } from './platform/rbac/access.service';

// WP-01 platform wiring. Business modules (m01-intake … m19-migration) attach from
// WP-04 onward; the transition engine arrives with WP-03 (M16).
export const POOL = 'POOL';

@Module({
  controllers: [HealthController, AuthController],
  providers: [
    { provide: POOL, useFactory: (): Pool => getPool() },
    AuditService,
    { provide: SettingsReader, useFactory: (pool: Pool) => new SettingsReader(pool), inject: [POOL] },
    {
      provide: AuditReadQueue,
      useFactory: (pool: Pool, audit: AuditService) => new AuditReadQueue(pool, audit),
      inject: [POOL, AuditService],
    },
    OutboxService,
    { provide: OutboxDispatcher, useFactory: (pool: Pool) => new OutboxDispatcher(pool), inject: [POOL] },
    IdempotencyService,
    {
      provide: SessionService,
      useFactory: (pool: Pool, audit: AuditService, settings: SettingsReader) =>
        new SessionService(pool, audit, settings),
      inject: [POOL, AuditService, SettingsReader],
    },
    {
      provide: AccessService,
      useFactory: (pool: Pool, audit: AuditService, settings: SettingsReader) =>
        new AccessService(pool, audit, settings),
      inject: [POOL, AuditService, SettingsReader],
    },
  ],
})
export class AppModule {}
