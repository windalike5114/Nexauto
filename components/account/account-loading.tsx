import { Loader2 } from "lucide-react";

export function AccountLoading() {
  return (
    <div className="mx-auto grid max-w-md place-items-center rounded-lg border border-black/10 bg-white p-8 shadow-panel">
      <Loader2 className="h-6 w-6 animate-spin text-signal" />
    </div>
  );
}
