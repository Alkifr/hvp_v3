/** Relative luminance 0…1 from #rgb / #rrggbb / AARRGGBB. */
export function hexLuminance(color: string | null | undefined): number {
  const rgb = parseRgb(color);
  if (!rgb) return 0.7;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function parseRgb(color: string | null | undefined): [number, number, number] | null {
  const raw = String(color ?? "").trim().replace(/^#/, "");
  const hex = raw.length === 8 ? raw.slice(2) : raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mixWithWhite(rgb: [number, number, number], t: number): [number, number, number] {
  const m = Math.max(0, Math.min(1, t));
  return [rgb[0] + (255 - rgb[0]) * m, rgb[1] + (255 - rgb[1]) * m, rgb[2] + (255 - rgb[2]) * m];
}

/** Осветляет заливку, чтобы тёмный шрифт (#0f172a) читался на ней. */
export function lightenForDarkText(color: string | null | undefined, minLuminance = 0.62): string {
  const rgb = parseRgb(color);
  if (!rgb) return "#e2e8f0";
  if (hexLuminance(color) >= minLuminance) return toHex(rgb);
  let lo = 0;
  let hi = 1;
  let best = mixWithWhite(rgb, 1);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const mixed = mixWithWhite(rgb, mid);
    if (hexLuminance(toHex(mixed)) >= minLuminance) {
      best = mixed;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return toHex(best);
}

export function isDarkFill(color: string | null | undefined): boolean {
  return hexLuminance(color) < 0.42;
}

export function contrastTextColor(color: string | null | undefined): string {
  return isDarkFill(color) ? "#ffffff" : "#0f172a";
}

export function contrastTextArgb(color: string | null | undefined): string {
  return isDarkFill(color) ? "FFFFFFFF" : "FF0F172A";
}
