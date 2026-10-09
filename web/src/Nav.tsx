export type Tab = "capture" | "binder" | "odds";

const TABS: { id: Tab; label: string }[] = [
  { id: "capture", label: "Capture" },
  { id: "binder", label: "Binder" },
  { id: "odds", label: "Odds" },
];

/** Bottom navigation. Friends and Inbox join it with T-007 and T-008. */
export function Nav({
  current,
  onChange,
  disabled,
}: {
  current: Tab;
  onChange: (tab: Tab) => void;
  /** While a capture is in flight or its reveal is open (AC-006.1). */
  disabled: boolean;
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
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
