import { LogIn, UserPlus } from "lucide-react";
import type { AccountMode, AuthPanelProps } from "@/components/account/account-types";

export function AuthPanel({
  mode,
  setMode,
  name,
  setName,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  loading,
  message,
  submit
}: AuthPanelProps) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-black/10 bg-white p-6 shadow-panel">
      <div className="grid grid-cols-2 rounded border border-black/10 bg-zinc-50 p-1">
        <AuthModeButton active={mode === "sign-in"} icon={<LogIn className="h-4 w-4" />} label="Sign in" onClick={() => setMode("sign-in")} />
        <AuthModeButton active={mode === "sign-up"} icon={<UserPlus className="h-4 w-4" />} label="Create" onClick={() => setMode("sign-up")} />
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode === "sign-up" ? <AccountTextInput id="name" label="Name" value={name} onChange={setName} autoComplete="name" /> : null}
        <AccountTextInput id="email" label="Email" type="email" value={email} onChange={setEmail} required autoComplete="email" />
        {mode !== "reset-password" ? (
          <>
            <AccountTextInput id="password" label="Password" type="password" value={password} onChange={setPassword} required minLength={6} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
            {mode === "sign-up" ? (
              <AccountTextInput id="confirm-password" label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} required minLength={6} autoComplete="new-password" />
            ) : null}
          </>
        ) : null}
        <button type="submit" disabled={loading} className="h-12 w-full rounded bg-signal px-5 font-black text-white hover:bg-red-700 disabled:bg-zinc-300">
          {loading ? "Working..." : mode === "reset-password" ? "Send reset link" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="mt-4 flex justify-center">
        {mode === "reset-password" ? (
          <button type="button" onClick={() => setMode("sign-in")} className="text-sm font-black text-steel hover:text-ink">
            Back to sign in
          </button>
        ) : (
          <button type="button" onClick={() => setMode("reset-password")} className="text-sm font-black text-steel hover:text-ink">
            Forgot password?
          </button>
        )}
      </div>

      {mode === "sign-up" && message.includes("check your email") ? <ConfirmationRequired message={message} /> : null}
      {message && !(mode === "sign-up" && message.includes("check your email")) ? <p className="mt-4 rounded bg-zinc-50 p-3 text-sm font-bold text-steel">{message}</p> : null}
    </div>
  );
}

export function ConfirmationRequired({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold leading-6 text-emerald-900">
      {message}
    </div>
  );
}

export function AccountTextInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  disabled = false,
  minLength,
  placeholder,
  autoComplete
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  minLength?: number;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="text-sm font-black" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        disabled={disabled}
        minLength={minLength}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded border border-black/10 px-3 outline-none focus:border-ink disabled:bg-zinc-100 disabled:text-steel"
      />
    </div>
  );
}

function AuthModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-10 items-center justify-center gap-2 rounded text-sm font-black ${active ? "bg-ink text-white" : "text-steel"}`}>
      {icon}
      {label}
    </button>
  );
}

export type { AccountMode };
