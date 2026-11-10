import { useId, type ReactNode } from "react";

type IndicatorTone =
  | "plan"
  | "unplan"
  | "line"
  | "base"
  | "range"
  | "moment"
  | "aircraft"
  | "hangar"
  | "current"
  | "planfact"
  | "cancelled"
  | "notes";

export function FilterIndicator(props: {
  label?: string;
  icon?: ReactNode;
  title?: string;
  active: boolean;
  disabled?: boolean;
  tone: IndicatorTone;
  onClick: () => void;
}) {
  const name = props.title ?? props.label ?? "";
  return (
    <button
      type="button"
      className={`tgIndicator tgIndicator_${props.tone}${props.active ? " isOn" : ""}`}
      aria-pressed={props.active}
      aria-label={name}
      disabled={props.disabled}
      title={name}
      onClick={props.onClick}
    >
      {props.icon ?? props.label}
    </button>
  );
}

/** Маленькая иконка внутри квадрата режима диаграммы. */
export function IndicatorGlyph(props: { name: "aircraft" | "hangar" | "current" | "planfact" | "cancelled" | "notes" }) {
  const clipId = useId().replace(/:/g, "");
  const common = {
    viewBox: "0 0 16 16",
    "aria-hidden": true as const
  };
  if (props.name === "aircraft") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
        />
      </svg>
    );
  }
  if (props.name === "hangar") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.6 7.3C3.2 4.7 5.1 3.3 8 3.3s4.8 1.4 6.4 4" />
        <path d="M1.6 7.3V13.5h12.8V7.3" />
        <path d="M6.1 13.5V9.6h3.8v3.9" />
      </svg>
    );
  }
  if (props.name === "current") {
    return (
      <svg {...common}>
        <rect x="1.4" y="6" width="13.2" height="4" rx="0.6" fill="currentColor" />
      </svg>
    );
  }
  if (props.name === "planfact") {
    return (
      <svg {...common}>
        <rect x="1.4" y="2.2" width="13.2" height="3.5" rx="0.5" fill="currentColor" />
        <clipPath id={clipId}>
          <rect x="2.8" y="10.3" width="11" height="3.5" rx="0.5" />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          <rect x="2.8" y="10.3" width="5.5" height="3.5" fill="#16a34a" />
          <rect x="8.3" y="10.3" width="5.5" height="3.5" fill="#dc2626" />
        </g>
      </svg>
    );
  }
  if (props.name === "cancelled") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="1.6" y="5.5" width="12.8" height="5" rx="0.6" />
        <path d="M3.2 3.3 12.8 12.7" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.2h6.1L13 6.1V13.8H3z" />
      <path d="M9 2.4V6h3.8" />
      <path d="M5.2 8.4h5.6M5.2 10.8h3.6" />
    </svg>
  );
}
