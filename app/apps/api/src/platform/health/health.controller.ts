import { Controller, Get } from '@nestjs/common';

// Read-only by definition — GET never mutates state (target_architecture guardrail 1).
@Controller('health')
export class HealthController {
  @Get()
  health(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'nutrezee-api' };
  }
}
