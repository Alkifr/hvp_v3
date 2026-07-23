type SwitchToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Компактный вариант без рамки — для таблиц и плотных форм */
  compact?: boolean;
  className?: string;
};

/** Булев переключатель в стиле карточки события (вместо checkbox). */
export function SwitchToggle(props: SwitchToggleProps) {
  const { checked, onChange, label, hint, disabled, compact, className } = props;
  const classes = [
    "evToggle",
    compact ? "evToggleCompact" : "",
    checked ? "evToggleOn" : "",
    disabled ? "evToggleDisabled" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={classes}>
      <input
        type="checkbox"
        className="evToggleInput"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="evToggleTrack" aria-hidden="true">
        <span className="evToggleThumb" />
      </span>
      {label || hint ? (
        <span className="evToggleText">
          {label ? <span className="evToggleLabel">{label}</span> : null}
          {hint ? <span className="evToggleHint">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
