import type { AccountSectionId } from "@/components/account/account-types";
import { accountSections } from "@/components/account/account-types";

export function AccountNavigation({
  activeSection,
  setActiveSection
}: {
  activeSection: AccountSectionId;
  setActiveSection: (section: AccountSectionId) => void;
}) {
  return (
    <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
      {accountSections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => setActiveSection(section.id)}
          className={`inline-flex h-10 shrink-0 items-center rounded px-4 text-sm font-black ${
            activeSection === section.id ? "bg-ink text-white" : "bg-zinc-100 text-steel hover:bg-zinc-200"
          }`}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}
