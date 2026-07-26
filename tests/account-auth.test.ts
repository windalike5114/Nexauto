import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSafeAuthErrorMessage } from "../lib/domain/account/auth-errors";
import {
  getAuthCallbackRedirectTarget,
  getAuthCallbackUrl,
  parsePasswordResetInput,
  parseSignInInput,
  parseSignUpInput
} from "../lib/domain/account/auth.schema";

const accountAuthComponent = readFileSync("components/account-auth.tsx", "utf8");
const checkoutSuccessComponent = readFileSync("components/checkout-success-actions.tsx", "utf8");
const callbackRoute = readFileSync("app/auth/callback/route.ts", "utf8");
const middlewareClient = readFileSync("utils/supabase/middleware.ts", "utf8");

test("sign-up input normalizes email and trims name", () => {
  const input = parseSignUpInput({
    name: "  Frank  ",
    email: "  Buyer@Example.CO.NZ  ",
    password: "secret1",
    confirmPassword: "secret1"
  });

  assert.deepEqual(input, {
    name: "Frank",
    email: "buyer@example.co.nz",
    password: "secret1"
  });
});

test("sign-up validation rejects invalid email, short password, and mismatched confirmation", () => {
  assert.throws(
    () =>
      parseSignUpInput({
        name: "",
        email: "not-an-email",
        password: "123",
        confirmPassword: "456"
      }),
    /valid email|at least 6|Passwords do not match/
  );
});

test("sign-in and reset validation normalize email without changing password", () => {
  const signIn = parseSignInInput({ email: "  USER@Example.co.nz ", password: " Pass Word " });
  const reset = parsePasswordResetInput({ email: "  USER@Example.co.nz " });

  assert.equal(signIn.email, "user@example.co.nz");
  assert.equal(signIn.password, " Pass Word ");
  assert.equal(reset.email, "user@example.co.nz");
});

test("auth callback target only allows safe internal redirects", () => {
  assert.equal(getAuthCallbackRedirectTarget("/account"), "/account");
  assert.equal(getAuthCallbackRedirectTarget("/account?tab=orders"), "/account?tab=orders");
  assert.equal(getAuthCallbackRedirectTarget("https://evil.example"), "/account");
  assert.equal(getAuthCallbackRedirectTarget("//evil.example"), "/account");
  assert.equal(getAuthCallbackRedirectTarget("/\\evil"), "/account");
});

test("auth callback URL points to the exchange route", () => {
  assert.equal(
    getAuthCallbackUrl("https://nexautoparts.co.nz", "/account"),
    "https://nexautoparts.co.nz/auth/callback?next=%2Faccount"
  );
});

test("auth errors are mapped to safe customer-facing messages", () => {
  assert.equal(
    getSafeAuthErrorMessage({ message: "Error sending confirmation email", status: 500 }),
    "We could not send the confirmation email right now. Please try again later."
  );
  assert.equal(
    getSafeAuthErrorMessage({ message: "Invalid login credentials", status: 400 }),
    "Email or password is incorrect."
  );
  assert.equal(
    getSafeAuthErrorMessage({ message: "User already registered", status: 400 }),
    "If this email already has an account, please sign in or use Forgot Password."
  );
});

test("auth callback exchanges code for a session and rejects unsafe next URLs", () => {
  assert.match(callbackRoute, /exchangeCodeForSession\(code\)/);
  assert.match(callbackRoute, /getAuthCallbackRedirectTarget/);
  assert.match(callbackRoute, /invalid-link/);
  assert.doesNotMatch(callbackRoute, /requestUrl\.searchParams\.get\("next"\)\s*\)/);
});

test("account registration entry uses auth callback and safe errors", () => {
  assert.match(accountAuthComponent, /getAuthCallbackUrl\(window\.location\.origin, "\/account"\)/);
  assert.match(accountAuthComponent, /parseSignUpInput/);
  assert.match(accountAuthComponent, /parseSignInInput/);
  assert.match(accountAuthComponent, /parsePasswordResetInput/);
  assert.match(accountAuthComponent, /getSafeAuthErrorMessage/);
  assert.doesNotMatch(accountAuthComponent, /setMessage\(error\.message\)/);
});

test("middleware treats stale Supabase refresh cookies as signed out", () => {
  assert.match(middlewareClient, /try\s*{\s*await supabase\.auth\.getUser\(\);/s);
  assert.match(middlewareClient, /catch\s*{/);
});

test("checkout success registration uses the same account auth validation and callback", () => {
  assert.match(checkoutSuccessComponent, /parseSignUpInput/);
  assert.match(checkoutSuccessComponent, /getAuthCallbackUrl\(window\.location\.origin, "\/account"\)/);
  assert.match(checkoutSuccessComponent, /getSafeAuthErrorMessage/);
  assert.doesNotMatch(checkoutSuccessComponent, /setMessage\(error\.message\)/);
});
