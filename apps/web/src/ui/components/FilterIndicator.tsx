type IndicatorTone = "plan" | "unplan" | "line" | "base" | "range" | "moment";

export function FilterIndicator(props: {
  label: string;
  title?: string;
  active: boolean;
  disabled?: boolean;
  tone: IndicatorTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tgIndicator tgIndicator_${props.tone}${props.active ? " isOn" : ""}`}
      aria-pressed={props.active}
      disabled={props.disabled}
      title={props.title ?? props.label}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
