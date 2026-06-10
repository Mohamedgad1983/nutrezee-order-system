import { ForbiddenException } from '@nestjs/common';
import type { StaffContext } from '../auth/session.service';
import { AccessService } from './access.service';

// Operation-level RBAC check for controllers (backend_foundation §3 item 3).
// Staged enforcement: only deny mode rejects; log/warn modes record would-deny
// (AccessService audits) and let the call proceed during the rollout ramp.
export async function requirePermission(
  access: AccessService,
  ctx: StaffContext,
  permission: string,
): Promise<void> {
  const d = await access.decide(ctx.roles, permission, ctx.staffId);
  if (d.enforced) {
    throw new ForbiddenException({ error_code: 'role_denied', permission });
  }
}
