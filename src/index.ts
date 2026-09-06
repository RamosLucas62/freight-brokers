import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { runAuditPipeline } from './pipeline/audit.pipeline.js';
import { extractor } from './extraction/index.js';
import { getCarrier } from './carrier/index.js';
import type { AuditContext } from './types/carrier.types.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const args = process.argv.slice(2).filter(arg => arg !== '--dry-run');
  if (!dryRun && (process.env.EXTRACTOR_PROVIDER === 'stub' || (process.env.CARRIER_PROVIDER ?? 'stub') === 'stub')) {
    throw new Error('Simulated providers require --dry-run. Configure live providers before saving an audit.');
  }

  if (args.length === 0) {
    console.error('Usage: npm start -- <file1.pdf> [file2.pdf] ...');
    process.exit(1);
  }

  const ctx: AuditContext = {
    run_id:        uuidv4(),
    carrierCache:  new Map(),
    cacheTtlHours: Number(process.env.CARRIER_CACHE_TTL_HOURS ?? '4'),
  };

  if (!Number.isFinite(ctx.cacheTtlHours) || ctx.cacheTtlHours <= 0) throw new Error('CARRIER_CACHE_TTL_HOURS must be positive.');

  console.error(`[audit] run_id=${ctx.run_id}, files=${args.length}`);

  const report = await runAuditPipeline({
    tenantId: process.env.AUDIT_TENANT_ID ?? (dryRun ? '00000000-0000-4000-8000-000000000001' : ''),
    filePaths:  args,
    ctx,
    extractor,
    getCarrier,
    ...(dryRun ? { store: { assertActive: async () => {}, history: async () => [], commit: async () => {} } } : {}),
  });
  if (dryRun) report.warnings = [...(report.warnings ?? []), 'DRY RUN: no audit saved and no historical invoices loaded.'];

  // Output report as JSON to stdout
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error('[audit] Fatal error:', err);
  process.exit(1);
});
