import { useRef } from "react";

export function SortDropdown<T extends string>({
  id,
  label = "Sort",
  value,
  options,
  open,
  onToggle,
  onSelect
}: {
  id: string;
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: T) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);

  return (
    <div className="browse-dropdown">
      <span className="browse-dropdown-label">{label}</span>
      <button
        ref={trigger}
        type="button"
        data-tv-focusable="true"
        data-browse-dropdown-trigger={id}
        className="browse-dropdown-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          {id === "filter" ? (
            <path d="M4 6h16M7 12h10m-7 6h4" />
          ) : (
            <path d="M8 5h12M4 5h.01M8 12h12M4 12h.01M8 19h12M4 19h.01" />
          )}
        </svg>
        <span>{id === "filter" ? label : `${label} · ${selected?.label ?? label}`}</span>
        {id === "filter" && value !== "all" ? <span className="browse-dropdown-count">1</span> : null}
      </button>
      {open ? (
        <div className="browse-dropdown-menu" role="menu" aria-label={`${label} options`}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              data-tv-focusable="true"
              data-browse-dropdown-option={id}
              className={option.value === value ? "selected" : ""}
              onClick={() => {
                onSelect(option.value);
                requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
