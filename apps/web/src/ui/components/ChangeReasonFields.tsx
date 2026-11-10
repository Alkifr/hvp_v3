import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

export type ChangeReasonOption = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export function useChangeReasons() {
  return useQuery({
    queryKey: ["ref", "change-reasons"],
    queryFn: () => apiGet<ChangeReasonOption[]>("/api/ref/change-reasons"),
    staleTime: 60_000
  });
}

export function ChangeReasonFields(props: {
  ids: string[];
  comment: string;
  onIdsChange: (ids: string[]) => void;
  onCommentChange: (value: string) => void;
}) {
  const reasonsQ = useChangeReasons();
  const active = (reasonsQ.data ?? []).filter((row) => row.isActive);

  return (
    <>
      <label className="evField evReasonField">
        <span className="evFieldLabel">Причина изменения</span>
        {reasonsQ.isPending && !reasonsQ.data ? (
          <div className="muted">Загрузка справочника…</div>
        ) : reasonsQ.error ? (
          <div className="error">{String((reasonsQ.error as { message?: string }).message ?? reasonsQ.error)}</div>
        ) : active.length === 0 ? (
          <div className="muted">В справочнике «Причины изменения» нет активных записей.</div>
        ) : (
          <MultiSelectDropdown
            options={active.map((row) => ({ id: row.id, label: row.name }))}
            value={props.ids}
            onChange={props.onIdsChange}
            placeholder="Выберите причины"
            selectedLabelMode="labels"
            searchable={false}
            portal
            menuZIndex={13000}
          />
        )}
      </label>
      <label className="evField">
        <span className="evFieldLabel">Комментарий</span>
        <textarea
          className="evInput evTextarea"
          rows={3}
          value={props.comment}
          onChange={(e) => props.onCommentChange(e.target.value)}
          placeholder="Уточнение"
        />
      </label>
    </>
  );
}
