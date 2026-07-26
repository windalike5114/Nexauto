import { z } from "zod";

const passwordMinimumLength = 6;

const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(passwordMinimumLength, `Password must be at least ${passwordMinimumLength} characters.`);

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.")
});

export const signUpSchema = z
  .object({
    name: z.string().trim().max(120, "Name is too long.").optional().default(""),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password.")
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match."
      });
    }
  })
  .transform((value) => ({
    name: value.name.trim() || null,
    email: value.email,
    password: value.password
  }));

export const passwordResetSchema = z.object({
  email: emailSchema
});

export function parseSignInInput(input: unknown) {
  return signInSchema.parse(input);
}

export function parseSignUpInput(input: unknown) {
  return signUpSchema.parse(input);
}

export function parsePasswordResetInput(input: unknown) {
  return passwordResetSchema.parse(input);
}

export function getFirstValidationMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Please check the form and try again.";
  }

  return "Please check the form and try again.";
}

export function getAuthCallbackRedirectTarget(value: string | null) {
  if (!value) return "/account";
  if (!value.startsWith("/")) return "/account";
  if (value.startsWith("//")) return "/account";
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) return "/account";
  return value;
}

export function getAuthCallbackUrl(origin: string, next: string = "/account") {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", getAuthCallbackRedirectTarget(next));
  return url.toString();
}
