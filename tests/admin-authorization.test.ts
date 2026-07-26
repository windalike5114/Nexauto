import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAdminAccessContext, isSignedOutSupabaseAuthError, normalizeAdminEmail, parseAdminEmailAllowlist } from "../lib/application/admin/check-admin-access";
import { AdminConfigurationError, AdminForbiddenError, AdminUnauthenticatedError } from "../lib/domain/admin/admin-access.errors";

test("admin email normalization trims and lowercases", () => {
  assert.equal(normalizeAdminEmail("  OWNER@NexAutoParts.CO.NZ  "), "owner@nexautoparts.co.nz");
});

test("ADMIN_EMAILS parser trims, lowercases, removes blanks, and deduplicates", () => {
  assert.deepEqual(parseAdminEmailAllowlist(" owner@nexautoparts.co.nz, OWNER@nexautoparts.co.nz, , fulfil@nexautoparts.co.nz "), [
    "owner@nexautoparts.co.nz",
    "fulfil@nexautoparts.co.nz"
  ]);
});

test("empty ADMIN_EMAILS fails closed", () => {
  assert.throws(() => createAdminAccessContext({ id: "auth-1", email: "owner@nexautoparts.co.nz" }, " , "), AdminConfigurationError);
});

test("unauthenticated admin access is denied", () => {
  assert.throws(() => createAdminAccessContext({ id: null, email: null }, "owner@nexautoparts.co.nz"), AdminUnauthenticatedError);
});

test("authenticated non-admin is denied without exposing allowlist", () => {
  assert.throws(() => createAdminAccessContext({ id: "auth-1", email: "buyer@example.co.nz" }, "owner@nexautoparts.co.nz"), AdminForbiddenError);
});

test("allowlisted admin receives normalized access context", () => {
  assert.deepEqual(createAdminAccessContext({ id: "auth-1", email: " Owner@NexAutoParts.co.nz " }, "owner@nexautoparts.co.nz"), {
    authUserId: "auth-1",
    email: "owner@nexautoparts.co.nz",
    role: "admin"
  });
});

test("Supabase missing or stale auth sessions are treated as signed out", () => {
  assert.equal(isSignedOutSupabaseAuthError({ name: "AuthSessionMissingError", message: "Auth session missing!" }), true);
  assert.equal(isSignedOutSupabaseAuthError({ message: "JWT expired" }), true);
  assert.equal(isSignedOutSupabaseAuthError({ status: 401 }), true);
  assert.equal(isSignedOutSupabaseAuthError({ message: "fetch failed" }), false);
});

test("admin pages, details, and actions use central guard boundary", () => {
  const page = readFileSync("app/admin/page.tsx", "utf8");
  const detail = readFileSync("app/admin/orders/[id]/page.tsx", "utf8");
  const actions = readFileSync("app/admin/actions.ts", "utf8");
  const queries = readFileSync("lib/queries/admin.ts", "utf8");

  assert.match(page, /checkAdminAccess/);
  assert.match(detail, /loadAdminOrderDetailData/);
  assert.doesNotMatch(detail, /notFound/);
  assert.match(actions, /requireAdminAccess/);
  assert.match(queries, /checkCentralAdminAccess/);
  assert.match(queries, /requireCentralAdminAccess/);
  assert.doesNotMatch(queries, /process\.env\.ADMIN_EMAILS[\s\S]+split\(","\)/);
});

test("internal recovery endpoints keep separate machine authorization", () => {
  const internalAuth = readFileSync("lib/application/recovery/internal-auth.ts", "utf8");

  assert.match(internalAuth, /INTERNAL_RECOVERY_SECRET/);
  assert.match(internalAuth, /CRON_SECRET/);
});
