import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { HealthController } from './platform/health/health.controller';
import { AuthController } from './platform/auth/auth.controller';
import { StaffController } from './platform/staff/staff.controller';
import { getPool } from './platform/config/database';
import { AuditReadQueue, AuditService } from './platform/audit/audit.service';
import { OutboxDispatcher, OutboxService } from './platform/outbox/outbox.service';
import { IdempotencyService } from './platform/idempotency/idempotency.service';
import { SettingsReader } from './platform/settings/settings-reader';
import { SessionService } from './platform/auth/session.service';
import { AccessService } from './platform/rbac/access.service';
import { RoleAdminService } from './platform/rbac/role-admin.service';
import { StaffService } from './platform/staff/staff.service';
import { SettingsService } from './platform/settings/settings.service';
import { SettingsController } from './platform/settings/settings.controller';
import { TransitionEngine } from './platform/transition/transition-engine';
import { CustomerService } from './modules/m04-customers/customer.service';
import { CatalogService } from './modules/m05-catalog/catalog.service';
import { DraftController } from './modules/m01-intake/draft.controller';
import { DraftService } from './modules/m01-intake/draft.service';
import { ReviewController } from './modules/m02-review/review.controller';
import { ReviewService } from './modules/m02-review/review.service';
import { OrderController } from './modules/m03-orders/order.controller';
import { OrderService } from './modules/m03-orders/order.service';
import { PaymentController } from './modules/m07-payments/payment.controller';
import { PaymentService } from './modules/m07-payments/payment.service';
import { KitchenController } from './modules/m08-kitchen/kitchen.controller';
import { KitchenService } from './modules/m08-kitchen/kitchen.service';
import { MessageRefService } from './modules/m17-whatsapp/message-ref.service';

// WP-01 platform wiring. Business modules (m01-intake … m19-migration) attach from
// WP-04 onward; the transition engine arrives with WP-03 (M16).
export const POOL = 'POOL';

@Module({
  controllers: [
    HealthController, AuthController, StaffController, SettingsController,
    DraftController, ReviewController, OrderController, PaymentController, KitchenController,
  ],
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
    {
      provide: StaffService,
      useFactory: (pool: Pool, audit: AuditService) => new StaffService(pool, audit),
      inject: [POOL, AuditService],
    },
    {
      provide: RoleAdminService,
      useFactory: (pool: Pool, audit: AuditService, access: AccessService) =>
        new RoleAdminService(pool, audit, access),
      inject: [POOL, AuditService, AccessService],
    },
    {
      provide: TransitionEngine,
      useFactory: (pool: Pool, audit: AuditService, outbox: OutboxService) =>
        new TransitionEngine(pool, audit, outbox),
      inject: [POOL, AuditService, OutboxService],
    },
    {
      provide: SettingsService,
      useFactory: (
        pool: Pool, audit: AuditService, outbox: OutboxService,
        reader: SettingsReader, engine: TransitionEngine,
      ) => new SettingsService(pool, audit, outbox, reader, [() => engine.invalidate()]),
      inject: [POOL, AuditService, OutboxService, SettingsReader, TransitionEngine],
    },
    {
      provide: CustomerService,
      useFactory: (
        pool: Pool, audit: AuditService, readQueue: AuditReadQueue,
        outbox: OutboxService, settings: SettingsReader,
      ) => new CustomerService(pool, audit, readQueue, outbox, settings),
      inject: [POOL, AuditService, AuditReadQueue, OutboxService, SettingsReader],
    },
    {
      provide: CatalogService,
      useFactory: (pool: Pool, audit: AuditService, settings: SettingsReader) =>
        new CatalogService(pool, audit, settings),
      inject: [POOL, AuditService, SettingsReader],
    },
    MessageRefService,
    {
      provide: DraftService,
      useFactory: (
        pool: Pool, audit: AuditService, outbox: OutboxService, settings: SettingsReader,
        idempotency: IdempotencyService, transitions: TransitionEngine,
        customers: CustomerService, catalog: CatalogService, refs: MessageRefService,
      ) => new DraftService(pool, audit, outbox, settings, idempotency, transitions, customers, catalog, refs),
      inject: [
        POOL, AuditService, OutboxService, SettingsReader, IdempotencyService, TransitionEngine,
        CustomerService, CatalogService, MessageRefService,
      ],
    },
    {
      provide: ReviewService,
      useFactory: (
        pool: Pool, audit: AuditService, outbox: OutboxService,
        settings: SettingsReader, drafts: DraftService,
      ) => new ReviewService(pool, audit, outbox, settings, drafts),
      inject: [POOL, AuditService, OutboxService, SettingsReader, DraftService],
    },
    {
      provide: OrderService,
      useFactory: (
        pool: Pool, audit: AuditService, outbox: OutboxService,
        settings: SettingsReader, transitions: TransitionEngine,
        drafts: DraftService, reviews: ReviewService,
        customers: CustomerService, catalog: CatalogService,
      ) => new OrderService(pool, audit, outbox, settings, transitions, drafts, reviews, customers, catalog),
      inject: [
        POOL, AuditService, OutboxService, SettingsReader, TransitionEngine,
        DraftService, ReviewService, CustomerService, CatalogService,
      ],
    },
    {
      provide: KitchenService,
      useFactory: (
        pool: Pool, audit: AuditService, outbox: OutboxService,
        transitions: TransitionEngine, orders: OrderService,
        catalog: CatalogService, customers: CustomerService,
      ) => new KitchenService(pool, audit, outbox, transitions, orders, catalog, customers),
      inject: [
        POOL, AuditService, OutboxService, TransitionEngine,
        OrderService, CatalogService, CustomerService,
      ],
    },
    {
      provide: PaymentService,
      useFactory: (
        pool: Pool, audit: AuditService, outbox: OutboxService,
        transitions: TransitionEngine, orders: OrderService,
      ) => new PaymentService(pool, audit, outbox, transitions, orders),
      inject: [POOL, AuditService, OutboxService, TransitionEngine, OrderService],
    },
  ],
})
export class AppModule {}
