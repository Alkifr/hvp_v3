import { useEffect, useState, type MutableRefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiPatch, apiPost } from "../../lib/api";
import { SwitchToggle } from "../components/SwitchToggle";
import { useChangeReasons, type ChangeReasonOption } from "../components/ChangeReasonFields";
import { ClickRow, RecordCard } from "./FleetRefCards";

function errorText(error: unknown): string {
  return String((error as { message?: string } | null)?.message ?? error ?? "");
}

export function ChangeReasonsPanel(props: {
  search: string;
  canWrite: boolean;
  createActionRef: MutableRefObject<(() => void) | null>;
}) {
  const qc = useQueryClient();
  const reasonsQ = useChangeReasons();
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [initial, setInitial] = useState({ code: "", name: "", sortOrder: "0", isActive: true });

  const openCreate = () => {
    setMode("create");
    setEditId("");
    setCode("");
    setName("");
    setSortOrder("0");
    setIsActive(true);
    setInitial({ code: "", name: "", sortOrder: "0", isActive: true });
  };

  useEffect(() => {
    props.createActionRef.current = props.canWrite ? openCreate : null;
    return () => {
      props.createActionRef.current = null;
    };
  });

  const needle = props.search.trim().toLowerCase();
  const rows = (reasonsQ.data ?? []).filter((row) => {
    if (!needle) return true;
    return `${row.code} ${row.name}`.toLowerCase().includes(needle);
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["ref", "change-reasons"] });
  };

  const payload = {
    code,
    name: name.trim(),
    sortOrder: Number(sortOrder) || 0,
    isActive
  };
  const saveM = useMutation({
    mutationFn: () =>
      mode === "create" ? apiPost("/api/ref/change-reasons", payload) : apiPatch(`/api/ref/change-reasons/${editId}`, payload),
    onSuccess: async () => {
      await refresh();
      setMode(null);
    }
  });
  const deleteM = useMutation({
    mutationFn: () => apiDelete(`/api/ref/change-reasons/${editId}`),
    onSuccess: async () => {
      await refresh();
      setMode(null);
    }
  });

  const openEdit = (row: ChangeReasonOption) => {
    const next = { code: row.code, name: row.name, sortOrder: String(row.sortOrder), isActive: row.isActive };
    setMode("edit");
    setEditId(row.id);
    setCode(next.code);
    setName(next.name);
    setSortOrder(next.sortOrder);
    setIsActive(next.isActive);
    setInitial(next);
  };

  const dirty =
    code !== initial.code || name !== initial.name || sortOrder !== initial.sortOrder || isActive !== initial.isActive;
  const invalid = !code.trim() || !name.trim() || !Number.isFinite(Number(sortOrder));

  return (
    <section>
      <table className="table refTable">
        <thead>
          <tr>
            <th>Код</th>
            <th>Название</th>
            <th>Порядок</th>
            <th>В окне</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ClickRow key={row.id} editing={mode === "edit" && editId === row.id} onOpen={() => openEdit(row)}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.sortOrder}</td>
              <td>{row.isActive ? "Да" : "Скрыта"}</td>
            </ClickRow>
          ))}
        </tbody>
      </table>
      {!reasonsQ.isPending && rows.length === 0 ? (
        <div className="refEmpty">
          <div className="refEmptyTitle">{needle ? "Ничего не найдено" : "Записей пока нет"}</div>
        </div>
      ) : null}
      {reasonsQ.error ? <div className="error">{errorText(reasonsQ.error)}</div> : null}
      {mode ? (
        <RecordCard
          titleId="changeReasonCardTitle"
          kicker="Справочники · Причины изменения"
          title={mode === "create" ? "Новая причина" : name || code}
          subtitle="Показывается в окне изменения события"
          active={isActive}
          canEdit={props.canWrite}
          saving={saveM.isPending}
          deleting={deleteM.isPending}
          dirty={dirty}
          error={saveM.error || deleteM.error ? errorText(saveM.error || deleteM.error) : null}
          record={mode === "edit" ? { id: editId } : null}
          onClose={() => setMode(null)}
          onSave={() => {
            if (!invalid) saveM.mutate();
          }}
          onDelete={
            props.canWrite && mode === "edit"
              ? () => {
                  if (confirm("Удалить причину? Уже записанная история не изменится.")) deleteM.mutate();
                }
              : undefined
          }
        >
          <label className="refLabel">
            <span>Код</span>
            <input className="refInput" value={code} disabled={!props.canWrite} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="refLabel">
            <span>Название</span>
            <input className="refInput" value={name} disabled={!props.canWrite} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="refLabel">
            <span>Порядок</span>
            <input
              className="refInput"
              type="number"
              min="0"
              max="10000"
              value={sortOrder}
              disabled={!props.canWrite}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </label>
          <SwitchToggle checked={isActive} disabled={!props.canWrite} onChange={setIsActive} label="Показывать в окне" />
        </RecordCard>
      ) : null}
    </section>
  );
}
