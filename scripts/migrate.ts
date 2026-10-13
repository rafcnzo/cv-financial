import postgres from 'postgres';
import { readFile, readdir } from 'node:fs/promises';
const connection = process.env.DATABASE_URL;
if (!connection) throw new Error('Set DATABASE_URL; use node --env-file=.env --import tsx scripts/migrate.ts');
const sql = postgres(connection, {max:1});
try {
  await sql`create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default now())`;
  for (const name of (await readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
    if ((await sql`select 1 from schema_migrations where name=${name}`).length) continue;
    const source = await readFile(`db/migrations/${name}`, 'utf8');
    await sql.begin(async tx => {await tx.unsafe(source); await tx`insert into schema_migrations(name) values(${name})`;});
    console.log(`Applied ${name}`);
  }
} finally { await sql.end(); }
