type AuthErrorLike = {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
};

export function getSafeAuthErrorMessage(error: unknown, fallback = "We could not complete that request. Please try again.") {
  const authError = normalizeAuthError(error);
  const message = authError.message.toLowerCase();
  const code = (authError.code ?? "").toLowerCase();

  if (authError.status === 429 || message.includes("rate limit") || message.includes("too many")) {
    return "Too many attempts. Please wait a moment before trying again.";
  }

  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return "Email or password is incorrect.";
  }

  if (message.includes("email not confirmed") || message.includes("not confirmed")) {
    return "Please confirm your email address before signing in.";
  }

  if (message.includes("already registered") || message.includes("already exists") || code.includes("user_already_exists")) {
    return "If this email already has an account, please sign in or use Forgot Password.";
  }

  if (message.includes("password") && (message.includes("weak") || message.includes("short"))) {
    return "Password is too weak. Please choose a longer password.";
  }

  if (message.includes("email") && message.includes("invalid")) {
    return "Enter a valid email address.";
  }

  if (message.includes("error sending confirmation email")) {
    return "We could not send the confirmation email right now. Please try again later.";
  }

  return fallback;
}

export function normalizeAuthError(error: unknown): Required<Pick<AuthErrorLike, "message">> & AuthErrorLike {
  if (error && typeof error === "object") {
    const value = error as AuthErrorLike;
    return {
      name: value.name,
      status: value.status,
      code: value.code,
      message: typeof value.message === "string" && value.message.trim() ? value.message : "Authentication request failed."
    };
  }

  if (typeof error === "string" && error.trim()) {
    return { message: error };
  }

  return { message: "Authentication request failed." };
}
