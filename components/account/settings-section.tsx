import type { FormEvent } from "react";
import { Settings } from "lucide-react";
import { AccountTextInput } from "@/components/account/auth-panel";
import { Panel } from "@/components/account/account-ui";

export function SettingsSection({
  email,
  name,
  setName,
  password,
  setPassword,
  newsletter,
  setNewsletter,
  loading,
  saveSettings
}: {
  email: string;
  name: string;
  setName: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  newsletter: boolean;
  setNewsletter: (value: boolean) => void;
  loading: boolean;
  saveSettings: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Panel title="Account Settings" icon={<Settings className="h-5 w-5" />} className="mt-6">
      <form onSubmit={saveSettings} className="grid gap-4 md:grid-cols-2">
        <AccountTextInput id="settings-name" label="Name" value={name} onChange={setName} />
        <AccountTextInput id="settings-email" label="Email" value={email} onChange={() => undefined} disabled />
        <AccountTextInput
          id="settings-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          minLength={6}
          placeholder="New password"
          autoComplete="new-password"
        />
        <label className="flex h-12 items-center gap-3 rounded border border-black/10 px-3 md:mt-7">
          <input
            type="checkbox"
            checked={newsletter}
            onChange={(event) => setNewsletter(event.target.checked)}
            className="h-4 w-4 accent-red-600"
          />
          <span className="text-sm font-black">Newsletter Preference</span>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="h-11 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300 md:col-span-2"
        >
          Save Settings
        </button>
      </form>
    </Panel>
  );
}
