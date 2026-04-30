import { z } from 'zod';

export const dataProvenanceSchema = z.object({
  source: z.enum(['kis', 'kiwoom', 'opendart', 'krx', 'manual']),
  asOf: z.string().min(1),
  latencyClass: z.enum(['realtime', 'delayed', 'eod', 'filing']),
  reconciled: z.boolean()
});

export const quoteSnapshotSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  price: z.number().finite(),
  change: z.number().finite(),
  changePct: z.number().finite(),
  currency: z.string().min(1),
  provenance: dataProvenanceSchema
});

export type QuoteSnapshotSchema = z.infer<typeof quoteSnapshotSchema>;
