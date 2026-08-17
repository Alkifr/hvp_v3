export type PickableField = {
  key: string;
  label: string;
  excelColumn?: string;
  availability?: string;
  mappingStatus?: string;
};

export function isFieldSelectable(f: PickableField): boolean {
  return f.availability !== "planned" && f.mappingStatus !== "unmapped";
}

export function splitFieldPickTokens(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function excelColIndex(col: string): number | null {
  const s = col.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function parseExcelColRange(token: string): { from: number; to: number } | null {
  const m = token.trim().match(/^([A-Za-z]{1,3})\s*[-:–—]\s*([A-Za-z]{1,3})$/);
  if (!m) return null;
  const a = excelColIndex(m[1]!);
  const b = excelColIndex(m[2]!);
  if (a == null || b == null) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase("ru");
}

function matchOneToken(token: string, fields: PickableField[]): { keys: string[]; unmatched?: string } {
  const range = parseExcelColRange(token);
  if (range) {
    const keys = fields
      .filter((f) => {
        if (!isFieldSelectable(f) || !f.excelColumn) return false;
        const idx = excelColIndex(f.excelColumn);
        return idx != null && idx >= range.from && idx <= range.to;
      })
      .map((f) => f.key);
    return keys.length ? { keys } : { keys: [], unmatched: token };
  }

  const q = norm(token);
  if (!q) return { keys: [] };

  const selectable = fields.filter(isFieldSelectable);

  const exactCol = selectable.filter((f) => f.excelColumn && norm(f.excelColumn) === q);
  if (exactCol.length === 1) return { keys: [exactCol[0]!.key] };

  const exactKey = selectable.find((f) => norm(f.key) === q);
  if (exactKey) return { keys: [exactKey.key] };

  const exactLabel = selectable.filter((f) => norm(f.label) === q);
  if (exactLabel.length === 1) return { keys: [exactLabel[0]!.key] };

  const starts = selectable.filter(
    (f) =>
      (f.excelColumn && norm(f.excelColumn).startsWith(q)) ||
      norm(f.label).startsWith(q) ||
      norm(f.key).startsWith(q)
  );
  if (starts.length === 1) return { keys: [starts[0]!.key] };

  return { keys: [], unmatched: token };
}

export function resolveFieldPick(
  raw: string,
  fields: PickableField[]
): { keys: string[]; unmatched: string[] } {
  const keys: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];
  for (const token of splitFieldPickTokens(raw)) {
    const hit = matchOneToken(token, fields);
    if (!hit.keys.length && hit.unmatched) unmatched.push(hit.unmatched);
    for (const key of hit.keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return { keys, unmatched };
}

export function suggestFieldPick(query: string, fields: PickableField[], already: string[], limit = 12): PickableField[] {
  const q = norm(query);
  if (!q || splitFieldPickTokens(query).length > 1 || parseExcelColRange(query)) return [];
  const selected = new Set(already);
  return fields
    .filter(isFieldSelectable)
    .filter((f) => !selected.has(f.key))
    .filter((f) => {
      const hay = [f.label, f.key, f.excelColumn].filter(Boolean).join(" ").toLocaleLowerCase("ru");
      return q.split(/\s+/).every((token) => hay.includes(token));
    })
    .slice(0, limit);
}
