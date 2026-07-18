// m24-fleetbase — inbound webhook receiver for Fleetbase order status updates.
// Public endpoint (Fleetbase calls it), secured by HMAC-SHA256 over the RAW body in the
// "Signature" header (Fleetbase's literal header name). Fails CLOSED if the secret is unset.
import { Body, Controller, HttpCode, Post, Req, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { FleetbaseService } from './fleetbase.service';
import { verifyWebhookSignature } from './fleetbase.client';

interface FleetbaseWebhookEnvelope {
  id?: string;
  api_version?: string;
  event?: string;
  created_at?: string;
  data?: { id?: string; internal_id?: string; status?: string; [k: string]: unknown };
}

@Controller('integrations')
export class FleetbaseController {
  constructor(private readonly svc: FleetbaseService) {}

  @Post('fleetbase/webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Body() body: FleetbaseWebhookEnvelope) {
    const secret = process.env.FLEETBASE_WEBHOOK_SECRET;
    if (!secret) {
      // Not configured yet → reject rather than accept unverified status writes.
      throw new ServiceUnavailableException('fleetbase webhook not configured');
    }
    const raw: Buffer | undefined = (req as unknown as { rawBody?: Buffer }).rawBody;
    const sig = (req.headers['signature'] as string | undefined) ?? undefined;
    const ok = verifyWebhookSignature(raw ?? Buffer.from(JSON.stringify(body ?? {})), sig, secret);
    if (!ok) throw new UnauthorizedException('invalid signature');

    const event = body?.event ?? 'unknown';
    const data = body?.data ?? {};
    const result = await this.svc.applyWebhookEvent(event, {
      id: data.id,
      internal_id: data.internal_id,
      status: data.status,
    });
    return { ok: true, event, matched: result.matched, state: result.state };
  }
}
