import { Icon, type IconName } from "./Icon.js";

export type Tab = "capture" | "binder" | "friends" | "inbox" | "odds";

const TABS: { id: Exclude<Tab, "odds">; label: string; icon: IconName }[] = [
  { id: "capture", label: "Capture", icon: "camera" },
  { id: "binder", label: "Binder", icon: "binder" },
  { id: "friends", label: "Friends", icon: "friends" },
  { id: "inbox", label: "Inbox", icon: "inbox" },
];

/** Bottom navigation (Capture · Binder · Friends · Inbox); odds open from the binder. */
export function Nav({
  current,
  onChange,
  disabled,
  inboxCount,
}: {
  current: Tab;
  onChange: (tab: Tab) => void;
  /** While a capture is in flight or its reveal is open (AC-006.1). */
  disabled: boolean;
  /** Items waiting in the inbox (AC-008.6, AC-010.1). */
  inboxCount: number;
}) {
  return (
    <nav class="bottom-nav" aria-label="Main">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={tab.id === current ? "page" : undefined}
          disabled={disabled}
          onClick={() => {
            onChange(tab.id);
          }}
        >
          <Icon name={tab.icon} />
          {tab.label}
          {tab.id === "inbox" && inboxCount > 0 && (
            <span class="badge" aria-label={`${inboxCount} waiting`}>
              {inboxCount}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
