import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const OBSOLETE_TYPES = [
  "wipertech_direct_sellable_front_pair_missing",
  "wipertech_direct_published_front_conflict"
];

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("fitment_review_queue").select("*")
    .in("issue_type", OBSOLETE_TYPES).in("review_status", ["open", "in_progress"]).range(from, from + 999);
  if (error) throw error;
  rows.push(...data);
  if (data.length < 1000) break;
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.resolve("tmp/production-backups", `wipertech-obsolete-reviews-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, "fitment_review_queue.json"), JSON.stringify(rows, null, 2));

const now = new Date().toISOString();
const { error: updateError } = await db.from("fitment_review_queue").update({
  review_status: "dismissed",
  resolution_notes: "Superseded by WIPERTECH_AUTHORITATIVE_LENGTH_2026_10_23: authoritative lengths may replace current data and do not require an existing sellable product.",
  reviewed_by: "Codex WiperTech authoritative importer",
  reviewed_at: now,
  updated_at: now
}).in("issue_type", OBSOLETE_TYPES).in("review_status", ["open", "in_progress"]);
if (updateError) throw updateError;

const { count, error: countError } = await db.from("fitment_review_queue").select("*", { count: "exact", head: true })
  .in("issue_type", OBSOLETE_TYPES).in("review_status", ["open", "in_progress"]);
if (countError) throw countError;
if (count !== 0) throw new Error(`Obsolete review verification failed: ${count} groups remain open.`);
console.log(JSON.stringify({ dismissedGroups: rows.length, backupDir, remainingOpenObsoleteGroups: count }, null, 2));

function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
