import { Module } from '@nestjs/common';
import { HealthController } from './platform/health/health.controller';

// WP-00 shell. Business modules (m01-intake … m19-migration) and the platform
// services (auth, rbac-guard, masking-interceptor, audit, outbox, transition-engine,
// settings, idempotency) are added from WP-01 per phase_5_master_prompt.md STEP 2.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
