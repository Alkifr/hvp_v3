const COMPACT_FONT = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const COMPACT_EXTRA_PX = 36;
const DEFAULT_MIN = 64;
const DEFAULT_MAX = 200;

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === "undefined") {
    measureCtx = null;
    return null;
  }
  const canvas = document.createElement("canvas");
  measureCtx = canvas.getContext("2d");
  return measureCtx;
}

/** Ширина кнопки мультиселекта: самое длинное значение + паддинг и шеврон. */
export function fitDropdownWidth(
  labels: Array<string | null | undefined>,
  opts?: { min?: number; max?: number; extraPx?: number }
): number {
  const min = opts?.min ?? DEFAULT_MIN;
  const max = opts?.max ?? DEFAULT_MAX;
  const extra = opts?.extraPx ?? COMPACT_EXTRA_PX;
  const ctx = getMeasureContext();
  const texts = labels.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (texts.length === 0) return min;
  let textPx = 0;
  if (ctx) {
    ctx.font = COMPACT_FONT;
    for (const text of texts) {
      textPx = Math.max(textPx, ctx.measureText(text).width);
    }
  } else {
    textPx = Math.max(...texts.map((text) => text.length * 7.2));
  }
  return Math.round(Math.min(max, Math.max(min, textPx + extra)));
}
