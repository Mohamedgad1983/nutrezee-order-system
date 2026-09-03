import { BatchRunner, type BatchReport, type BatchType, type RowImporter } from './batch-runner';
import { customerImporter, catalogImporter, activePlanImporter, partnerDailyImporter } from './importers';
import {
  PartnerDailyFeedError, canonicalizeDailyDeliveries, validateDeliveryDate,
  type PartnerDailyCompleteness, type PartnerDailyFeedGateway,
} from './partner-daily-feed';
import { CustomerService } from '../m04-customers/customer.service';
import { CatalogService } from '../m05-catalog/catalog.service';
import { SyncRecordService } from '../m18-bridge/sync-record.service';
import { OrderService } from '../m03-orders/order.service';
import { PaymentService } from '../m07-payments/payment.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import type { StaffContext } from '../../platform/auth/session.service';

export class MigrationService {
  constructor(
    private readonly runner: BatchRunner,
    private readonly customers: CustomerService,
    private readonly catalog: CatalogService,
    private readonly sync: SyncRecordService,
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    private readonly settings: SettingsReader,
    private readonly partnerFeed: PartnerDailyFeedGateway | null = null,
  ) {}

  async run(
    actor: StaffContext,
    type: BatchType,
    rows: Array<Record<string, unknown>>,
    apply = false,
  ): Promise<BatchReport> {
    return this.runner.run(actor, type, rows, await this.importer(type), { apply });
  }

  /**
   * WP-OPS-06: fetch one Partner delivery date server-side and run it as a `partner_daily` batch.
   * Dry-run and apply hash the same canonical rows, so the apply gate's same-snapshot rule holds
   * across two fetches only while Partner's feed is unchanged — exactly the guarantee wanted.
   */
  async runPartnerDaily(
    actor: StaffContext,
    deliveryDate: string,
    apply = false,
  ): Promise<PartnerDailyReport> {
    if (!this.partnerFeed) throw new PartnerDailyFeedError('not_configured');
    const date = validateDeliveryDate(deliveryDate);
    const fetched = await this.partnerFeed.fetchDate(date);
    const rows = canonicalizeDailyDeliveries(fetched.rows);
    const report = await this.runner.run(actor, 'partner_daily', rows, await this.importer('partner_daily'), { apply });
    return {
      ...report,
      source: {
        delivery_date: date,
        delivery_rows: fetched.rows.length,
        distinct_orders: rows.length,
        pages: fetched.pages,
        completeness: fetched.completeness,
        orders_without_partner_driver: rows.filter((row) => row.partner_driver_id === null).length,
        cancelled: rows.filter((row) => row.is_cancelled).length,
        on_hold: rows.filter((row) => row.is_on_hold).length,
      },
    };
  }

  async report(batchId: string): Promise<BatchReport> {
    return this.runner.report(batchId);
  }

  async rollback(actor: StaffContext, batchId: string): Promise<void> {
    await this.runner.rollback(actor, batchId);
  }

  private async importer(type: BatchType): Promise<RowImporter> {
    const defaultCountryCode = await this.settings.get<string>('default_phone_country_code', '+966');
    switch (type) {
      case 'customer':
        return customerImporter(this.customers, this.sync, defaultCountryCode);
      case 'catalog':
        return catalogImporter(this.catalog, this.sync);
      case 'active_plans':
        return activePlanImporter(
          this.customers, this.catalog, this.orders, this.payments,
          this.sync, defaultCountryCode,
        );
      case 'partner_daily':
        return partnerDailyImporter(this.customers, this.orders, this.sync, defaultCountryCode);
      default:
        throw new Error(`unsupported import type: ${type}`);
    }
  }
}

export interface PartnerDailyReport extends BatchReport {
  source: {
    delivery_date: string;
    delivery_rows: number;
    distinct_orders: number;
    pages: number;
    completeness: PartnerDailyCompleteness;
    orders_without_partner_driver: number;
    cancelled: number;
    on_hold: number;
  };
}
