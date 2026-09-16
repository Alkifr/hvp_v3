/** Индексы полусмен 0…2n-1: чёт — день, нечёт — вечер. */
export function occupiedHalfRanges(
  occupied: Array<{ day?: boolean; evening?: boolean }>
): Array<{ from: number; to: number }> {
  const flags: boolean[] = [];
  for (const o of occupied) {
    flags.push(Boolean(o.day));
    flags.push(Boolean(o.evening));
  }
  const ranges: Array<{ from: number; to: number }> = [];
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < flags.length && flags[j + 1]) j += 1;
    ranges.push({ from: i, to: j });
    i = j + 1;
  }
  return ranges;
}

export function isEveningHalf(halfIndex: number): boolean {
  return halfIndex % 2 === 1;
}
