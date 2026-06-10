import { BatchRunner, type BatchReport, type BatchType, type RowImporter } from './batch-runner';
import { customerImporter, catalogImporter, activePlanImporter } from './importers';
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
  ) {}

  async run(
    actor: StaffContext,
    type: BatchType,
    rows: Array<Record<string, unknown>>,
    apply = false,
  ): Promise<BatchReport> {
    return this.runner.run(actor, type, rows, await this.importer(type), { apply });
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
      default:
        throw new Error(`unsupported import type: ${type}`);
    }
  }
}
