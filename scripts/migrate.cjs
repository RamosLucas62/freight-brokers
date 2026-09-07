const { spawnSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL before migrating.'); process.exit(1); }
const root = join(__dirname, '..');
const check = process.argv.includes('--check');
const files = ['schema.sql', ...readdirSync(join(root, 'db/migrations')).filter(f => f.endsWith('.sql')).sort().map(f => 'migrations/' + f)];
let sql = 'BEGIN;\nSELECT pg_advisory_xact_lock(71934628);\nCREATE TABLE IF NOT EXISTS public.audit_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());\nREVOKE ALL ON public.audit_schema_migrations FROM PUBLIC,anon,authenticated;\n';
for (const file of files) {
 const name = file.replace(/'/g, "''");
 sql += `SELECT NOT EXISTS (SELECT 1 FROM public.audit_schema_migrations WHERE name='${name}') AS apply_migration \\gset\n\\if :apply_migration\n`;
 sql += readFileSync(join(root, 'db', file), 'utf8') + `\nINSERT INTO public.audit_schema_migrations(name) VALUES ('${name}');\n\\endif\n`;
}
if (check) sql += readFileSync(join(root, 'tests/db/tenant-isolation.sql'), 'utf8') + '\n' + readFileSync(join(root, 'tests/db/customer-portal.sql'), 'utf8') + '\n' + readFileSync(join(root, 'tests/db/global-admin.sql'), 'utf8') + '\n' + readFileSync(join(root, 'tests/db/notifications.sql'), 'utf8') + '\nROLLBACK;\n';
else sql += '\nCOMMIT;\n';
// libpq does not expand a URI supplied through PGDATABASE consistently.
// Split it into environment fields so credentials never appear in process arguments.
let connection;
try {
 const uri = new URL(process.env.DATABASE_URL);
 if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.hostname) throw new Error();
 connection = { PGHOST: uri.hostname, PGPORT: uri.port || '5432',
  PGUSER: decodeURIComponent(uri.username), PGPASSWORD: decodeURIComponent(uri.password),
  PGDATABASE: decodeURIComponent(uri.pathname.slice(1)) };
} catch { console.error('DATABASE_URL must be a valid PostgreSQL connection URI.'); process.exit(1); }
const loopback = ['localhost','127.0.0.1','::1'].includes(connection.PGHOST);
const result = spawnSync('psql', ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1'], {
 input: sql, encoding: 'utf8', env: { ...process.env, ...connection, PGCONNECT_TIMEOUT: '15', PGSSLMODE: loopback ? 'disable' : 'require' },
});
if (result.status !== 0 || result.error) {
 // Do not print the connection URI or credentials embedded in driver diagnostics.
 const safe = String(result.stderr ?? result.error?.message ?? '').replaceAll(process.env.DATABASE_URL, '[database]');
 console.error(safe);process.exit(result.status || 1);
}
console.log(check ? 'Migration and database isolation checks passed; transaction rolled back.' : 'Migrations applied successfully.');
