import type { PoolClient } from 'pg';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

export class MessageRefError extends Error {
  constructor(readonly code: 'validation_failed' | 'already_attached') {
    super(code);
  }
}

export interface MessageRefInput {
  senderPhone: string;
  messageAt: string;
  refNote?: string;
}

// M17 manual WhatsApp mode: immutable message reference only. No webhook, no raw
// chat-content table (ASM-003/004).
export class MessageRefService {
  async attachInTx(
    client: PoolClient,
    actor: StaffContext,
    draftId: string,
    input: MessageRefInput,
  ): Promise<string> {
    if (!input.senderPhone || !input.messageAt || Number.isNaN(Date.parse(input.messageAt))) {
      throw new MessageRefError('validation_failed');
    }
    const existing = await client.query(
      'SELECT 1 FROM whatsapp_message_ref WHERE draft_id = $1',
      [draftId],
    );
    if (existing.rowCount && existing.rowCount > 0) throw new MessageRefError('already_attached');
    const id = newId();
    await client.query(
      `INSERT INTO whatsapp_message_ref (id, draft_id, sender_phone, message_at, ref_note, captured_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, draftId, input.senderPhone, input.messageAt, input.refNote ?? null, actor.staffId],
    );
    return id;
  }

  async hasRefInTx(client: PoolClient, draftId: string): Promise<boolean> {
    const { rows } = await client.query(
      'SELECT 1 FROM whatsapp_message_ref WHERE draft_id = $1',
      [draftId],
    );
    return rows.length > 0;
  }
}
