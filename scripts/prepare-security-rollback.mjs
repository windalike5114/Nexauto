import fs from 'node:fs';
import crypto from 'node:crypto';
const dir = 'outputs/security-remediation-20261027';
const data = JSON.parse(fs.readFileSync(`${dir}/production-before.json`,'utf8').replace(/^\uFEFF/,''));
const quote = value => '"' + value.replaceAll('"','""') + '"';
const literal = value => "'" + value.replaceAll("'","''") + "'";
const role = value => value === 'PUBLIC' ? 'PUBLIC' : quote(value);
const affected = new Set(['PUBLIC','anon','authenticated']);
const sql = [
  '-- NOT AUTOMATIC: restores previously vulnerable public permissions.',
  '-- Keep as an exact evidence-based emergency rollback. New approval required to reopen access.',
  'begin;', "set local lock_timeout = '3s';", "set local statement_timeout = '30s';"
];
for (const table of data.tables) {
  if (table.schema !== 'public' || !/^(?:order_claim_events|stripe_webhook_events|vehicle_catalog_\w+)$/.test(table.name)) throw new Error('Unexpected table in snapshot');
  const name = `${quote(table.schema)}.${quote(table.name)}`;
  sql.push(`revoke all privileges on table ${name} from PUBLIC, anon, authenticated;`);
  if (['r','p'].includes(table.kind)) sql.push(`alter table ${name} ${table.rls ? 'enable' : 'disable'} row level security;`);
  for (const grant of table.grants || []) if (affected.has(grant.role)) {
    if (!/^[A-Z]+$/.test(grant.privilege)) throw new Error('Unexpected privilege');
    sql.push(`grant ${grant.privilege} on table ${name} to ${role(grant.role)}${grant.grantable ? ' with grant option' : ''};`);
  }
}
for (const fn of data.functions) {
  if (!/^public\.[a-z_][a-z_0-9]*\([a-z, ]+\)$/.test(fn.signature)) throw new Error('Unexpected signature');
  sql.push(`revoke execute on function ${fn.signature} from PUBLIC, anon, authenticated;`);
  for (const grant of fn.grants || []) if (affected.has(grant.role)) sql.push(`grant execute on function ${fn.signature} to ${role(grant.role)}${grant.grantable ? ' with grant option' : ''};`);
  const searchPath = (fn.config || []).find(value=>value.startsWith('search_path='));
  sql.push(searchPath ? `alter function ${fn.signature} set search_path to ${literal(searchPath.slice(12))};` : `alter function ${fn.signature} reset search_path;`);
}
sql.push('commit;');
fs.writeFileSync(`${dir}/rollback-original-permissions.sql`,sql.join('\n')+'\n');
const manifest = Object.fromEntries(['production-before.json','production-before.csv','rollback-original-permissions.sql'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(`${dir}/${file}`)).digest('hex')]));
fs.writeFileSync(`${dir}/backup-manifest.json`,JSON.stringify({snapshotAt:data.checked_at,tableCount:data.tables.length,functionCount:data.functions.length,sha256:manifest},null,2));
console.log(JSON.stringify({tableCount:data.tables.length,functionCount:data.functions.length,hashesSaved:true}));
