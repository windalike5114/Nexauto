import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Phase 5D admin actions keep central authorization and audit trail", () => {
  const actions = readFileSync("app/admin/actions.ts", "utf8");

  assert.match(actions, /export async function updateFulfillmentAction/);
  assert.match(actions, /export async function retryOrderEmailAction/);
  assert.match(actions, /export async function retryStripeWebhookAction/);
  assert.match(actions, /requireAdminAccess\(\)/);
  assert.match(actions, /writeSystemAuditEvent/);
  assert.match(actions, /actorType: "admin"/);
  assert.match(actions, /admin_fulfilment_updated/);
  assert.match(actions, /admin_email_retry/);
  assert.match(actions, /admin_webhook_retry/);
});

test("fulfilment mutation remains bounded to existing connector fields and statuses", () => {
  const actions = readFileSync("app/admin/actions.ts", "utf8");

  assert.match(actions, /fulfilmentStatuses = new Set\(\["pending", "selected", "packed", "fulfilled", "issue"\]\)/);
  assert.match(actions, /driver_connector/);
  assert.match(actions, /passenger_connector/);
  assert.match(actions, /rear_connector/);
  assert.match(actions, /connector_status/);
  assert.match(actions, /admin_note/);
  assert.doesNotMatch(actions, /tracking_number|courier|carrier|shipped_at|delivered_at/);
});

test("email and webhook retry buttons are scoped to retryable states", () => {
  const emailCard = readFileSync("components/admin/order-detail/admin-order-email-card.tsx", "utf8");
  const webhookCard = readFileSync("components/admin/order-detail/admin-order-webhook-card.tsx", "utf8");
  const detailPage = readFileSync("app/admin/orders/[id]/page.tsx", "utf8");

  assert.match(emailCard, /status === "failed" \|\| status === "failed_retryable"/);
  assert.match(webhookCard, /status === "failed_retryable"/);
  assert.match(detailPage, /retryOrderEmailAction/);
  assert.match(detailPage, /retryStripeWebhookAction/);
  assert.doesNotMatch(emailCard, /delivered/);
  assert.doesNotMatch(webhookCard, /status === "processed"/);
});

test("Phase 5D does not add new database schema or customer-facing checkout mutations", () => {
  const status = readFileSync("app/admin/actions.ts", "utf8");

  assert.doesNotMatch(status, /from\("orders"\)\.update\(\{/);
  assert.doesNotMatch(status, /from\("products"\)[\s\S]+retryStripeWebhookAction/);
});
