import { useEffect, useState } from "react";

import { formatDateTimeDisplay, parseFlexibleDateTime } from "../../lib/dateInput";

type DateTimeTextInputProps = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  "aria-label"?: string;
};

export function DateTimeTextInput(props: DateTimeTextInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatDateTimeDisplay(props.value));

  useEffect(() => {
    if (focused) return;
    setText(formatDateTimeDisplay(props.value));
  }, [props.value, focused]);

  const parsed = parseFlexibleDateTime(text);
  const invalid = text.trim() !== "" && parsed == null;

  const commit = (raw: string) => {
    const next = parseFlexibleDateTime(raw);
    if (next) {
      props.onChange(next);
      setText(formatDateTimeDisplay(next));
      return;
    }
    if (!raw.trim()) {
      props.onChange("");
      setText("");
    }
  };

  return (
    <input
      className={`${props.className ?? ""}${invalid ? " evInputInvalid" : ""}`.trim()}
      value={focused ? text : formatDateTimeDisplay(props.value) || text}
      placeholder={props.placeholder ?? "дд.мм.гггг чч:мм"}
      title={props.title ?? "Можно ввести 03012026, 03.01.2026 или 03.01.2026 14:00"}
      aria-label={props["aria-label"]}
      aria-invalid={invalid}
      autoComplete="off"
      spellCheck={false}
      disabled={props.disabled}
      onFocus={(event) => {
        setFocused(true);
        const formatted = formatDateTimeDisplay(props.value);
        setText(formatted || event.currentTarget.value);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const next = parseFlexibleDateTime(raw);
        if (next) props.onChange(next);
        else if (!raw.trim()) props.onChange("");
      }}
      onBlur={() => {
        setFocused(false);
        commit(text);
      }}
    />
  );
}
