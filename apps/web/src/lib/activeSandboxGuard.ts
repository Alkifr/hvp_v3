type SandboxListItem = { id: string; status?: string | null };

/**
 * Возвращаемся в рабочий контур, только если свежий список подтвердил:
 * песочницы больше нет или она в архиве.
 * Снимок, снятый до выбора или во время догрузки, новую песочницу ещё не содержит.
 */
export function shouldDropActiveSandbox(args: {
  activeId: string | null;
  sandboxes: SandboxListItem[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  chosenAt: number;
}): boolean {
  if (!args.activeId) return false;
  if (args.isLoading || args.isFetching) return false;
  if (!args.sandboxes) return false;
  if (args.dataUpdatedAt <= args.chosenAt) return false;
  const found = args.sandboxes.find((s) => s.id === args.activeId);
  if (!found) return true;
  return found.status === "ARCHIVED";
}
