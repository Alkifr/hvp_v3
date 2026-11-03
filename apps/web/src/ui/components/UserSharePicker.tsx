import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";
import { authMe } from "../auth/authApi";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

export const ALL_USERS_ID = "__all__";

export type DirectoryUser = {
  id: string;
  email: string;
  displayName: string | null;
};

const ALL_USERS_ENTRY: DirectoryUser = {
  id: ALL_USERS_ID,
  email: "",
  displayName: "Все пользователи"
};

export function isAllUsersShare(user: { id: string }) {
  return user.id === ALL_USERS_ID;
}

function directoryLabel(user: DirectoryUser) {
  return (user.displayName?.trim() || user.email).toLocaleLowerCase("ru");
}

export function useUserDirectory() {
  return useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => apiGet<{ ok: true; users: DirectoryUser[] }>("/api/users"),
    staleTime: 60_000
  });
}

export async function grantAccessToUsers(users: DirectoryUser[], grant: (user: DirectoryUser) => Promise<unknown>) {
  const failed: DirectoryUser[] = [];
  let firstError: unknown = null;
  for (const user of users) {
    try {
      await grant(user);
    } catch (err) {
      failed.push(user);
      if (!firstError) firstError = err;
    }
  }
  if (failed.length === 0) return;
  const names = failed.map((user) => user.displayName?.trim() || user.email).join(", ");
  const detail = firstError instanceof Error ? firstError.message : "";
  const message =
    failed.length === users.length && detail ? detail : `Не удалось открыть доступ: ${names}${detail ? `. ${detail}` : ""}`;
  const err = new Error(message) as Error & { failedIds?: string[] };
  err.failedIds = failed.map((user) => user.id);
  throw err;
}

export function UserSharePicker(props: {
  value: string[];
  onChange: (users: DirectoryUser[]) => void;
  excludeIds?: string[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0, staleTime: 60_000 });
  const dirQ = useUserDirectory();
  const meId = meQ.data?.ok ? meQ.data.user.id : null;

  const users = dirQ.data?.users ?? [];
  const byId = useMemo(() => {
    const map = new Map(users.map((user) => [user.id, user]));
    map.set(ALL_USERS_ID, ALL_USERS_ENTRY);
    return map;
  }, [users]);

  const options = useMemo(() => {
    const exclude = new Set(props.excludeIds ?? []);
    if (meId) exclude.add(meId);
    const people = users
      .filter((user) => !exclude.has(user.id))
      .sort((a, b) => directoryLabel(a).localeCompare(directoryLabel(b), "ru"))
      .map((user) => {
        const name = user.displayName?.trim();
        return {
          id: user.id,
          label: name || user.email,
          description: name ? user.email : undefined
        };
      });
    return [
      {
        id: ALL_USERS_ID,
        label: "Все пользователи",
        description: "Текущие и новые пользователи"
      },
      ...people
    ];
  }, [users, props.excludeIds, meId]);

  const placeholder = dirQ.isLoading
    ? "Загрузка пользователей…"
    : dirQ.isError
      ? "Не удалось загрузить список"
      : (props.placeholder ?? "Выберите пользователей");

  return (
    <div className={props.className}>
      <MultiSelectDropdown
        portal
        searchable
        options={options}
        value={props.value}
        onChange={(ids) => props.onChange(ids.flatMap((id) => { const user = byId.get(id); return user ? [user] : []; }))}
        placeholder={placeholder}
        searchPlaceholder="Имя или email"
        disabled={props.disabled || dirQ.isLoading || dirQ.isError}
      />
    </div>
  );
}
