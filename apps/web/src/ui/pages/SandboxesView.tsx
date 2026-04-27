import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPatch, apiPost, getActiveSandboxId, setActiveSandboxId } from "../../lib/api";
import type { SandboxSummary } from "../components/SandboxSwitcher";

type CopyMode = "empty" | "prod" | "prodRange";

function formatDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (!Number.isFinite(d.valueOf())) return "—";
  return d.toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toInputLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputLocal(v: string): Date {
  return new Date(v);
}

export function SandboxesView() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const [shareFor, setShareFor] = useState<SandboxSummary | null>(null);
  const [renameFor, setRenameFor] = useState<SandboxSummary | null>(null);
  const [promoteFor, setPromoteFor] = useState<SandboxSummary | null>(null);

  const listQ = useQuery<SandboxSummary[]>({
    queryKey: ["sandboxes", "mine"],
    queryFn: () => apiGet<SandboxSummary[]>("/api/sandboxes"),
    staleTime: 5_000
  });

  const list = listQ.data ?? [];
  const activeId = getActiveSandboxId();

  const mine = list.filter((s) => s.isOwner);
  const shared = list.filter((s) => !s.isOwner);
  const visible = tab === "mine" ? mine : shared;
  const currentShareFor = shareFor ? (list.find((s) => s.id === shareFor.id) ?? shareFor) : null;
  const currentRenameFor = renameFor ? (list.find((s) => s.id === renameFor.id) ?? renameFor) : null;
  const currentPromoteFor = promoteFor ? (list.find((s) => s.id === promoteFor.id) ?? promoteFor) : null;

  const deleteM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/sandboxes/${id}`),
    onSuccess: (_d, id) => {
      if (getActiveSandboxId() === id) setActiveSandboxId(null);
      void qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });

  const setActive = (id: string | null) => {
    setActiveSandboxId(id);
    void qc.invalidateQueries();
  };

  return (
    <div className="sandboxesPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Сценарное планирование</div>
          <h1>Песочницы плана</h1>
          <p>
            Создавайте изолированные копии плана, проверяйте альтернативные сценарии и переносите готовые изменения
            обратно в рабочий контур за выбранный период.
          </p>
        </div>
        <div className="massHeroStats" aria-label="Песочницы">
          <span><b>{mine.length}</b> мои</span>
          <span><b>{shared.length}</b> доступны</span>
          <button type="button" className="btn btnPrimary" onClick={() => setCreateOpen(true)}>
            + Создать песочницу
          </button>
        </div>
      </section>

      <div className="sandboxesTabs">
        <button
          type="button"
          className={tab === "mine" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setTab("mine")}
        >
          Мои <span className="sandboxesTabCount">{mine.length}</span>
        </button>
        <button
          type="button"
          className={tab === "shared" ? "sandboxesTab active" : "sandboxesTab"}
          onClick={() => setTab("shared")}
        >
          Расшарены со мной <span className="sandboxesTabCount">{shared.length}</span>
        </button>
      </div>

      {listQ.isLoading ? (
        <div className="muted">Загрузка…</div>
      ) : visible.length === 0 ? (
        <div className="sandboxesEmpty">
          {tab === "mine"
            ? "У вас пока нет песочниц. Создайте первую — скопируйте текущий план и спокойно поэкспериментируйте."
            : "Пока никто не поделился с вами песочницей."}
        </div>
      ) : (
        <div className="sandboxesGrid">
          {visible.map((s) => (
            <SandboxCard
              key={s.id}
              sandbox={s}
              active={activeId === s.id}
              onOpen={() => setActive(s.id)}
              onRename={() => setRenameFor(s)}
              onShare={() => setShareFor(s)}
              onDelete={() => {
                if (!confirm(`Удалить песочницу «${s.name}»? Все её события и связанные данные будут удалены.`)) return;
                deleteM.mutate(s.id);
              }}
              onPromote={() => setPromoteFor(s)}
            />
          ))}
        </div>
      )}

      {createOpen ? <CreateSandboxModal onClose={() => setCreateOpen(false)} /> : null}
      {currentShareFor ? <ShareSandboxModal sandbox={currentShareFor} onClose={() => setShareFor(null)} /> : null}
      {currentRenameFor ? <RenameSandboxModal sandbox={currentRenameFor} onClose={() => setRenameFor(null)} /> : null}
      {currentPromoteFor ? <PromoteSandboxModal sandbox={currentPromoteFor} onClose={() => setPromoteFor(null)} /> : null}
    </div>
  );
}

function SandboxCard(props: {
  sandbox: SandboxSummary;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onPromote: () => void;
}) {
  const { sandbox: s, active, onOpen, onRename, onShare, onDelete, onPromote } = props;
  const canWrite = s.myRole === "OWNER" || s.myRole === "EDITOR";
  return (
    <div className={active ? "sandboxCard sandboxCardActive" : "sandboxCard"}>
      <div className="sandboxCardHead">
        <div className="sandboxCardTitle">{s.name}</div>
        {active ? <span className="sandboxCardActiveBadge">Активна</span> : null}
      </div>
      {s.description ? <div className="sandboxCardDesc">{s.description}</div> : null}
      <div className="sandboxCardMeta">
        <span>События: <b>{s.eventCount}</b></span>
        <span>Обновлено: {formatDate(s.updatedAt)}</span>
        <span>Владелец: {s.owner.displayName ?? s.owner.email}</span>
        <span>Роль: <b>{s.isOwner ? "Владелец" : s.myRole ?? "—"}</b></span>
        <span>Участников: {s.members.length + 1}</span>
      </div>
      <div className="sandboxCardActions">
        <button type="button" className="btn btnPrimary" onClick={onOpen} disabled={active}>
          {active ? "Открыта" : "Открыть"}
        </button>
        {canWrite ? (
          <button type="button" className="btn" onClick={onPromote}>
            Перенести в прод
          </button>
        ) : null}
        {s.isOwner ? (
          <>
            <button type="button" className="btn" onClick={onShare}>Поделиться</button>
            <button type="button" className="btn" onClick={onRename}>Переименовать</button>
            <button type="button" className="btn btnDanger" onClick={onDelete}>Удалить</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CreateSandboxModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("Моя песочница");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<CopyMode>("prod");
  const [from, setFrom] = useState<string>(() => toInputLocal(new Date()));
  const [to, setTo] = useState<string>(() => toInputLocal(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)));

  const createM = useMutation({
    mutationFn: async () => {
      const payload: any = { name: name.trim(), description: description.trim() || undefined };
      if (mode === "empty") payload.copyFrom = "empty";
      else if (mode === "prod") payload.copyFrom = "prod";
      else payload.copyFrom = { source: "prod", from: fromInputLocal(from).toISOString(), to: fromInputLocal(to).toISOString() };
      return await apiPost<{ ok: boolean; sandbox: { id: string; name: string }; copied: any }>("/api/sandboxes", payload);
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["sandboxes"] });
      setActiveSandboxId(res.sandbox.id);
      void qc.invalidateQueries();
      onClose();
    }
  });

  return (
    <ModalShell title="Создать песочницу" onClose={() => !createM.isPending && onClose()}>
      <div className="modalBody sandboxModalBody">
        <label className="refLabel">
          <span>Название</span>
          <input className="refInput" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label className="refLabel">
          <span>Описание (необязательно)</span>
          <textarea className="refInput" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </label>

        <div className="refLabel">
          <span>Что скопировать</span>
          <div className="sandboxModeRow">
            <label className="sandboxModeOption">
              <input type="radio" checked={mode === "prod"} onChange={() => setMode("prod")} />
              <div>
                <b>Текущий план целиком</b>
                <div className="muted small">Все события и связанные записи продакшена</div>
              </div>
            </label>
            <label className="sandboxModeOption">
              <input type="radio" checked={mode === "prodRange"} onChange={() => setMode("prodRange")} />
              <div>
                <b>Диапазон дат</b>
                <div className="muted small">Скопируются только события, пересекающие период</div>
              </div>
            </label>
            <label className="sandboxModeOption">
              <input type="radio" checked={mode === "empty"} onChange={() => setMode("empty")} />
              <div>
                <b>Пустая</b>
                <div className="muted small">Без копирования — чистый холст</div>
              </div>
            </label>
          </div>
        </div>

        {mode === "prodRange" ? (
          <div className="sandboxRangeRow">
            <label className="refLabel">
              <span>С</span>
              <input className="refInput" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="refLabel">
              <span>По</span>
              <input className="refInput" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        ) : null}

        {createM.isError ? <div className="errorMsg">{String((createM.error as Error)?.message ?? createM.error)}</div> : null}
      </div>
      <div className="modalFooter">
        <button type="button" className="btn" onClick={onClose} disabled={createM.isPending}>Отмена</button>
        <button
          type="button"
          className="btn btnPrimary"
          onClick={() => createM.mutate()}
          disabled={createM.isPending || !name.trim()}
        >
          {createM.isPending ? "Создаём…" : "Создать"}
        </button>
      </div>
    </ModalShell>
  );
}

function RenameSandboxModal({ sandbox, onClose }: { sandbox: SandboxSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(sandbox.name);
  const [description, setDescription] = useState(sandbox.description ?? "");
  const saveM = useMutation({
    mutationFn: () => apiPatch(`/api/sandboxes/${sandbox.id}`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sandboxes"] });
      onClose();
    }
  });
  return (
    <ModalShell title={`Переименовать «${sandbox.name}»`} onClose={() => !saveM.isPending && onClose()}>
      <div className="modalBody sandboxModalBody">
        <label className="refLabel">
          <span>Название</span>
          <input className="refInput" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label className="refLabel">
          <span>Описание</span>
          <textarea className="refInput" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </label>
        {saveM.isError ? <div className="errorMsg">{String((saveM.error as Error)?.message ?? saveM.error)}</div> : null}
      </div>
      <div className="modalFooter">
        <button type="button" className="btn" onClick={onClose} disabled={saveM.isPending}>Отмена</button>
        <button type="button" className="btn btnPrimary" onClick={() => saveM.mutate()} disabled={saveM.isPending || !name.trim()}>
          Сохранить
        </button>
      </div>
    </ModalShell>
  );
}

function ShareSandboxModal({ sandbox, onClose }: { sandbox: SandboxSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("EDITOR");

  const addM = useMutation({
    mutationFn: () => apiPost(`/api/sandboxes/${sandbox.id}/members`, { email: email.trim().toLowerCase(), role }),
    onSuccess: () => {
      setEmail("");
      void qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });

  const removeM = useMutation({
    mutationFn: (userId: string) => apiDelete(`/api/sandboxes/${sandbox.id}/members/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });

  return (
    <ModalShell title={`Поделиться «${sandbox.name}»`} onClose={onClose}>
      <div className="modalBody sandboxModalBody">
        <div className="sandboxShareAddRow">
          <input
            className="refInput"
            placeholder="user@company.ru"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
          <select className="refInput" value={role} onChange={(e) => setRole(e.target.value as "EDITOR" | "VIEWER")}>
            <option value="EDITOR">Редактор</option>
            <option value="VIEWER">Наблюдатель</option>
          </select>
          <button type="button" className="btn btnPrimary" onClick={() => addM.mutate()} disabled={addM.isPending || !email.trim()}>
            Добавить
          </button>
        </div>
        {addM.isError ? <div className="errorMsg">{String((addM.error as Error)?.message ?? addM.error)}</div> : null}

        <div className="sandboxMembersList">
          <div className="sandboxMembersHead">
            <div>Участник</div>
            <div>Роль</div>
            <div></div>
          </div>
          <div className="sandboxMembersRow">
            <div>{sandbox.owner.displayName ?? sandbox.owner.email}</div>
            <div><span className="sandboxRoleBadge">Владелец</span></div>
            <div></div>
          </div>
          {sandbox.members.length === 0 ? (
            <div className="sandboxMembersEmpty muted">Ещё нет участников</div>
          ) : (
            sandbox.members.map((m) => (
              <div key={m.userId} className="sandboxMembersRow">
                <div>{m.displayName ?? m.email}</div>
                <div><span className="sandboxRoleBadge">{m.role === "EDITOR" ? "Редактор" : "Наблюдатель"}</span></div>
                <div>
                  <button type="button" className="btn btnDanger btnSmall" onClick={() => removeM.mutate(m.userId)} disabled={removeM.isPending}>
                    Убрать
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="modalFooter">
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modalWindow sandboxModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitle">{title}</div>
          <button type="button" className="modalClose" aria-label="Закрыть" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type DiffItem = {
  sandboxEventId: string;
  title: string;
  aircraftLabel: string;
  eventTypeName: string | null;
  hangarName: string | null;
  standCode: string | null;
  startAt: string;
  endAt: string;
  status: "DRAFT" | "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  category: "newOnly" | "conflictSameStand" | "cancelled";
  conflicts: Array<{ prodEventId: string; title: string; aircraftLabel: string; standCode: string | null; startAt: string; endAt: string }>;
};

type DiffResponse = {
  ok: boolean;
  range: { from: string; to: string };
  summary: { total: number; newOnly: number; conflictSameStand: number; cancelled: number; prodEventsInRange: number };
  items: DiffItem[];
};

function PromoteSandboxModal({ sandbox, onClose }: { sandbox: SandboxSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState<string>(() => toInputLocal(new Date()));
  const [to, setTo] = useState<string>(() => toInputLocal(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)));
  const [deleteProd, setDeleteProd] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadDiff = async () => {
    setPreviewError(null);
    try {
      const fromIso = fromInputLocal(from).toISOString();
      const toIso = fromInputLocal(to).toISOString();
      const data = await apiGet<DiffResponse>(`/api/sandboxes/${sandbox.id}/diff?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`);
      setDiff(data);
      const next: Record<string, boolean> = {};
      for (const it of data.items) next[it.sandboxEventId] = it.category === "newOnly";
      setSelected(next);
    } catch (e: any) {
      setPreviewError(String(e?.message ?? e));
      setDiff(null);
    }
  };

  const promoteM = useMutation({
    mutationFn: async () => {
      const items = (diff?.items ?? []).map((it) => ({
        sandboxEventId: it.sandboxEventId,
        action: selected[it.sandboxEventId] ? "add" : "skip" as "add" | "skip"
      }));
      return await apiPost<{ ok: boolean; promoted: number; deletedProd: number; createdReservations: number; createdTows: number }>(
        `/api/sandboxes/${sandbox.id}/promote`,
        {
          from: fromInputLocal(from).toISOString(),
          to: fromInputLocal(to).toISOString(),
          items,
          deleteProdInRange: deleteProd && deleteConfirmed
        }
      );
    },
    onSuccess: (res) => {
      void qc.invalidateQueries();
      alert(`Готово. Добавлено событий: ${res.promoted}${res.deletedProd ? ", удалено из прода: " + res.deletedProd : ""}.`);
      onClose();
    }
  });

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  return (
    <ModalShell title={`Перенести «${sandbox.name}» в рабочий контур`} onClose={() => !promoteM.isPending && onClose()}>
      <div className="modalBody sandboxModalBody sandboxPromoteBody">
        <div className="sandboxRangeRow">
          <label className="refLabel">
            <span>С</span>
            <input className="refInput" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="refLabel">
            <span>По</span>
            <input className="refInput" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="btn btnPrimary" onClick={() => void loadDiff()}>Загрузить предпросмотр</button>
        </div>

        {previewError ? <div className="errorMsg">{previewError}</div> : null}

        {diff ? (
          <>
            <div className="sandboxPromoteSummary">
              <span className="sandboxPromoteChip new">Новые: {diff.summary.newOnly}</span>
              <span className="sandboxPromoteChip conflict">Конфликт места: {diff.summary.conflictSameStand}</span>
              <span className="sandboxPromoteChip cancelled">Отменено: {diff.summary.cancelled}</span>
              <span className="sandboxPromoteChip neutral">В проде за период: {diff.summary.prodEventsInRange}</span>
              <span className="sandboxPromoteChip selected">Выбрано: {selectedCount}</span>
            </div>

            <div className="sandboxPromoteTableWrap">
              <table className="sandboxPromoteTable">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>Тип</th>
                    <th>Название</th>
                    <th>Борт</th>
                    <th>Ангар / Место</th>
                    <th>Период</th>
                    <th>Конфликты</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.items.length === 0 ? (
                    <tr><td colSpan={7} className="muted">Нет событий в песочнице за выбранный период</td></tr>
                  ) : null}
                  {diff.items.map((it) => (
                    <tr
                      key={it.sandboxEventId}
                      className={
                        it.category === "conflictSameStand"
                          ? "rowConflict"
                          : it.category === "cancelled"
                            ? "rowCancelled"
                            : ""
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[it.sandboxEventId])}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [it.sandboxEventId]: e.target.checked }))}
                        />
                      </td>
                      <td>
                        {it.category === "newOnly" ? (
                          <span className="badge ok">новое</span>
                        ) : it.category === "cancelled" ? (
                          <span className="badge neutral">отменено</span>
                        ) : (
                          <span className="badge warn">конфликт места</span>
                        )}
                      </td>
                      <td>
                        {it.title}
                        <div className="muted small">
                          {it.eventTypeName ?? ""}{it.status === "CANCELLED" ? " · не выбирается автоматически" : ""}
                        </div>
                      </td>
                      <td>{it.aircraftLabel}</td>
                      <td>{it.hangarName ?? "—"}{it.standCode ? ` / ${it.standCode}` : ""}</td>
                      <td>{formatDate(it.startAt)}<br />{formatDate(it.endAt)}</td>
                      <td>
                        {it.conflicts.length === 0 ? "—" : (
                          <ul className="sandboxPromoteConflicts">
                            {it.conflicts.map((c) => (
                              <li key={c.prodEventId}>{c.title} ({c.aircraftLabel}) · место {c.standCode ?? "—"}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sandboxPromoteDangerZone">
              <label className="sandboxPromoteCheckbox">
                <input type="checkbox" checked={deleteProd} onChange={(e) => { setDeleteProd(e.target.checked); setDeleteConfirmed(false); }} />
                Удалить события рабочего контура за период перед переносом
              </label>
              {deleteProd ? (
                <label className="sandboxPromoteCheckbox warn">
                  <input type="checkbox" checked={deleteConfirmed} onChange={(e) => setDeleteConfirmed(e.target.checked)} />
                  Я понимаю, что это необратимо удалит {diff.summary.prodEventsInRange} событий из прода.
                </label>
              ) : null}
            </div>
          </>
        ) : (
          <div className="muted">Нажмите «Загрузить предпросмотр», чтобы посмотреть, что будет перенесено.</div>
        )}

        {promoteM.isError ? <div className="errorMsg">{String((promoteM.error as Error)?.message ?? promoteM.error)}</div> : null}
      </div>
      <div className="modalFooter">
        <button type="button" className="btn" onClick={onClose} disabled={promoteM.isPending}>Отмена</button>
        <button
          type="button"
          className="btn btnPrimary"
          onClick={() => promoteM.mutate()}
          disabled={
            promoteM.isPending || !diff || selectedCount === 0 || (deleteProd && !deleteConfirmed)
          }
        >
          {promoteM.isPending ? "Переносим…" : `Применить (${selectedCount})`}
        </button>
      </div>
    </ModalShell>
  );
}
