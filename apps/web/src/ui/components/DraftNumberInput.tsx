import { useRef, useState, type CSSProperties } from "react";

import { commitDraftNumber, liveDraftNumber } from "../../lib/draftNumber";

type DraftNumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  "aria-invalid"?: boolean;
  /** Ноль показывать пустым: так обязательное поле не выглядит заполненным. */
  blankZero?: boolean;
  /** Не писать промежуточные цифры в состояние, только готовое число при уходе из поля. */
  commitOnBlur?: boolean;
};

/**
 * Числовое поле, которое можно стереть целиком и набрать заново.
 * Пустая строка не записывается в состояние: иначе `Number("")` сразу
 * подставляет 0 или прежнее значение, и остаётся только последняя цифра.
 */
export function DraftNumberInput(props: DraftNumberInputProps) {
  const { value, onChange, className, disabled, title, style, commitOnBlur, blankZero } = props;
  const min = props.min ?? Number.NEGATIVE_INFINITY;
  const max = props.max ?? Number.POSITIVE_INFINITY;
  const step = props.step ?? 1;
  const decimal = !Number.isInteger(step);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const show = (raw: string | null) => {
    draftRef.current = raw;
    setDraft(raw);
  };

  return (
    <input
      type="number"
      className={className}
      disabled={disabled}
      title={title}
      style={style}
      aria-invalid={props["aria-invalid"]}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      value={draft ?? (blankZero && value === 0 ? "" : Number.isFinite(value) ? String(value) : "")}
      onChange={(e) => {
        const raw = e.target.value;
        show(raw);
        if (commitOnBlur) return;
        const live = liveDraftNumber(raw, min, max, decimal);
        if (live != null && live !== valueRef.current) onChange(live);
      }}
      onBlur={() => {
        const next = commitDraftNumber(draftRef.current ?? String(valueRef.current), valueRef.current, min, max, decimal);
        show(null);
        if (next !== valueRef.current) onChange(next);
      }}
    />
  );
}
