import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path: string) {
  return readFileSync(path, "utf8");
}

test("account orchestrator imports focused account sections", () => {
  const source = read("components/account-auth.tsx");

  for (const moduleName of [
    "account-shell",
    "auth-panel",
    "dashboard-section",
    "orders-section",
    "rewards-section",
    "settings-section",
    "vehicles-section",
    "addresses-section"
  ]) {
    assert.match(source, new RegExp(`@/components/account/${moduleName}`));
  }
});

test("account orchestrator no longer owns large inline UI sections", () => {
  const source = read("components/account-auth.tsx");

  for (const functionName of [
    "AuthCard",
    "DashboardSection",
    "OrdersSection",
    "RewardsSection",
    "VehiclesSection",
    "SettingsSection",
    "Panel",
    "TextInput"
  ]) {
    assert.doesNotMatch(source, new RegExp(`function ${functionName}\\b`));
  }
});

test("account sections keep non-implemented actions visibly disabled", () => {
  const orders = read("components/account/orders-section.tsx");
  const vehicles = read("components/account/vehicles-section.tsx");

  assert.match(orders, /<button type="button" disabled/);
  assert.match(vehicles, /<button type="button" disabled/);
});

test("auth panel keeps required auth modes and confirmation state", () => {
  const source = read("components/account/auth-panel.tsx");

  assert.match(source, /Sign in/);
  assert.match(source, /Create account/);
  assert.match(source, /Forgot password\?/);
  assert.match(source, /Confirm password/);
  assert.match(source, /ConfirmationRequired/);
});

test("account shell stays presentational", () => {
  const source = read("components/account/account-shell.tsx");

  assert.match(source, /children/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /createClient/);
});
