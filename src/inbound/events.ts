import { z } from 'zod';
import { parseAuditRecipient } from '../db/tenants.repo.js';
const addresses = z.array(z.string().max(320)).max(100).default([]);
export const ReceivedEvent = z.object({
 type: z.literal('email.received'),
 data: z.object({ email_id: z.string().uuid(), to: addresses, cc: addresses, bcc: addresses }),
});
export type ReceivedEvent = z.infer<typeof ReceivedEvent>;
export function recipientAliases(event: ReceivedEvent): string[] {
 const aliases = new Set<string>();
 for (const address of [...event.data.to,...event.data.cc,...event.data.bcc]) {
  try { aliases.add(parseAuditRecipient(address)); } catch { /* Addresses outside the audit domain are not routed. */ }
 }
 // received_for is derived from Received headers. Do not trust it as an independent routing authority.
 return [...aliases];
}
