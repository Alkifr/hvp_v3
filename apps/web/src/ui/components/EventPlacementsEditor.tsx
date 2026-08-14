import { useMemo, useState } from "react";
import dayjs from "dayjs";

import { formatDateTimeDisplay } from "../../lib/dateInput";
import {
  interleaveAutoGaps,
  manualPlacements,
  placementWarnings,
  type PlacementDraft
} from "../../lib/placementDraft";
import { DateTimeTextInput } from "./DateTimeTextInput";
import { SingleSelectDropdown } from "./SingleSelectDropdown";
import { SwitchToggle } from "./SwitchToggle";

type HangarOption = { id: string; name: string };
type LayoutOption = { id: string; name: string; isCompatible?: boolean; standsSummary?: string };
type StandOption = { id: string; code: string; name: string; isCompatible?: boolean };

function formatTatCompact(start: string, end: string): string {
  const s = dayjs(start);
  const e = dayjs(end);
  if (!s.isValid() || !e.isValid() || e.valueOf() <= s.valueOf()) return "—";
  const hours = Math.max(0, e.diff(s, "minute")) / 60;
  return `${Number(hours.toFixed(1))} ч`;
}

export function EventPlacementsEditor(props: {
  placements: PlacementDraft[];
  autoFillGapPlacements: boolean;
  eventStartAtLocal: string;
  eventEndAtLocal: string;
  planningKind: "PLANNED" | "UNPLANNED" | string;
  hangars: HangarOption[];
  layoutsByHangar: Map<string, LayoutOption[]>;
  standsByLayout: Map<string, StandOption[]>;
  disabled?: boolean;
  onPatch: (clientKey: string, patch: Partial<PlacementDraft>) => void;
  onAdd: () => void;
  onRemove: (clientKey: string) => void;
  onAutoFillChange: (next: boolean) => void;
  onAlignToEvent: () => void;
}) {
  const [extraOpen, setExtraOpen] = useState<Record<string, boolean>>({});
  const [panelOpen, setPanelOpen] = useState(true);
  const displayItems = useMemo(
    () => interleaveAutoGaps(props.placements, props.autoFillGapPlacements),
    [props.placements, props.autoFillGapPlacements]
  );
  const manuals = useMemo(() => manualPlacements(props.placements), [props.placements]);
  const warnings = useMemo(
    () =>
      placementWarnings({
        placements: props.placements,
        eventStartAtLocal: props.eventStartAtLocal,
        eventEndAtLocal: props.eventEndAtLocal,
        autoFillGapPlacements: props.autoFillGapPlacements
      }),
    [props.placements, props.eventStartAtLocal, props.eventEndAtLocal, props.autoFillGapPlacements]
  );
  const autoCount = displayItems.filter((item) => item.kind === "auto").length;
  const autoMinutes = displayItems.reduce((total, item) => {
    if (item.kind !== "auto") return total;
    return total + Math.max(0, dayjs(item.placement.endAtLocal).diff(dayjs(item.placement.startAtLocal), "minute"));
  }, 0);

  return (
    <div className="evStagesPanel">
      <button
        className="evStagesSummary"
        type="button"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((open) => !open)}
      >
        <span className="evStagesSummaryTitle">Этапы размещения</span>
        <span className="evStagesSummaryMeta">
          {displayItems.length} шт.
          {autoCount > 0 ? ` · авто ${autoCount}` : ""}
        </span>
        <span className={`evCardChevron${panelOpen ? " evStagesChevronOpen" : ""}`} aria-hidden="true" />
      </button>
      {panelOpen ? (
      <div className="evStagesBody">
        <SwitchToggle
          compact
          checked={props.autoFillGapPlacements}
          onChange={props.onAutoFillChange}
          disabled={props.disabled}
          label="Заполнять разрывы этапами без ангара"
          hint={
            autoCount > 0
              ? `Будет создано: ${autoCount}, суммарно ${Number((autoMinutes / 60).toFixed(1))} ч`
              : "Появится узкая полоска при разрыве от одной минуты"
          }
        />
        {warnings.length > 0 ? (
          <div className="evStagesAlerts" role="status">
            <div className="evStagesAlertsHead">
              <strong>Проверьте даты этапов</strong>
              <button className="btn evStagesAlignBtn" type="button" onClick={props.onAlignToEvent} disabled={props.disabled}>
                Выровнять по событию
              </button>
            </div>
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="muted small">
            Первый этап начинается, а последний заканчивается вместе с оперативным периодом события. Даты: 03012026 или
            03.01.2026 14:00.
          </div>
        )}
        <div className="evStagesList">
          {displayItems.map((item) => {
            const p = item.placement;
            if (item.kind === "auto") {
              return (
                <div className="evStageAuto" key={p.clientKey}>
                  <span className="evStageAutoLabel">Этап {item.index + 1} · автоматически · без ангара</span>
                  <span className="evStageAutoRange">
                    {formatDateTimeDisplay(p.startAtLocal)} → {formatDateTimeDisplay(p.endAtLocal)}
                  </span>
                  <span className="evStageAutoTat">{formatTatCompact(p.startAtLocal, p.endAtLocal)}</span>
                </div>
              );
            }
            const layoutOptions = p.hangarId ? props.layoutsByHangar.get(p.hangarId) ?? [] : [];
            const standOptions = p.layoutId ? props.standsByLayout.get(p.layoutId) ?? [] : [];
            const extra = extraOpen[p.clientKey] === true;
            return (
              <div className="evStageCard" key={p.clientKey}>
                <div className="evStageHead">
                  <strong>Этап {item.index + 1}</strong>
                  <span className="evStageTat">{formatTatCompact(p.startAtLocal, p.endAtLocal)}</span>
                  <button
                    className="btn evStageRemove"
                    type="button"
                    onClick={() => props.onRemove(p.clientKey)}
                    disabled={props.disabled || manuals.length <= 1}
                  >
                    Удалить
                  </button>
                </div>
                <div className="evStageDates">
                  <label className="evField">
                    <span className="evFieldLabel">Начало</span>
                    <DateTimeTextInput
                      className="evInput"
                      value={p.startAtLocal}
                      disabled={props.disabled}
                      aria-label={`Начало этапа ${item.index + 1}`}
                      onChange={(startAtLocal) => props.onPatch(p.clientKey, { startAtLocal })}
                    />
                  </label>
                  <label className="evField">
                    <span className="evFieldLabel">Окончание</span>
                    <DateTimeTextInput
                      className="evInput"
                      value={p.endAtLocal}
                      disabled={props.disabled}
                      aria-label={`Окончание этапа ${item.index + 1}`}
                      onChange={(endAtLocal) => props.onPatch(p.clientKey, { endAtLocal })}
                    />
                  </label>
                </div>
                <div className="evStagePlace">
                  <div className="evField">
                    <span className="evFieldLabel">Ангар</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      compact
                      searchable
                      searchPlaceholder="Ангар"
                      placeholder="— не задан —"
                      emptyLabel="— не задан —"
                      options={props.hangars.map((hangar) => ({ id: hangar.id, label: hangar.name }))}
                      value={p.hangarId}
                      disabled={props.disabled}
                      onChange={(hangarId) => props.onPatch(p.clientKey, { hangarId, layoutId: "", standId: "" })}
                      width="100%"
                    />
                  </div>
                  <div className="evField">
                    <span className="evFieldLabel">Вариант</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      compact
                      searchable
                      searchPlaceholder="Вариант"
                      placeholder="— не задан —"
                      emptyLabel="— не задан —"
                      options={layoutOptions.map((layout) => ({
                        id: layout.id,
                        label: `${layout.name}${layout.isCompatible === false ? " — недоступно для типа ВС" : ""}`,
                        description: layout.standsSummary || undefined,
                        disabled: layout.isCompatible === false
                      }))}
                      value={p.layoutId}
                      disabled={props.disabled || !p.hangarId}
                      onChange={(layoutId) => props.onPatch(p.clientKey, { layoutId, standId: "" })}
                      width="100%"
                    />
                  </div>
                  <div className="evField">
                    <span className="evFieldLabel">Место</span>
                    <SingleSelectDropdown
                      className="evSelect"
                      compact
                      searchable
                      searchPlaceholder="Место"
                      placeholder="— не выбрано —"
                      emptyLabel="— не выбрано —"
                      options={standOptions.map((stand) => ({
                        id: stand.id,
                        label: `${stand.code} • ${stand.name}${stand.isCompatible === false ? " — недоступно для типа ВС" : ""}`,
                        disabled: stand.isCompatible === false
                      }))}
                      value={p.standId}
                      disabled={props.disabled || !p.layoutId}
                      onChange={(standId) => props.onPatch(p.clientKey, { standId })}
                      width="100%"
                    />
                  </div>
                </div>
                <button
                  className="evStageExtraToggle"
                  type="button"
                  onClick={() => setExtraOpen((state) => ({ ...state, [p.clientKey]: !extra }))}
                >
                  {extra ? "Скрыть бюджет и факт" : "Бюджет и факт"}
                </button>
                {extra ? (
                  <div className="evStageExtra">
                    <div className="evStageDates">
                      <label className="evField">
                        <span className="evFieldLabel">Бюджет: начало</span>
                        <DateTimeTextInput
                          className="evInput"
                          value={p.budgetStartAtLocal}
                          disabled={props.disabled || props.planningKind === "UNPLANNED"}
                          onChange={(budgetStartAtLocal) => props.onPatch(p.clientKey, { budgetStartAtLocal })}
                        />
                      </label>
                      <label className="evField">
                        <span className="evFieldLabel">Бюджет: окончание</span>
                        <DateTimeTextInput
                          className="evInput"
                          value={p.budgetEndAtLocal}
                          disabled={props.disabled || props.planningKind === "UNPLANNED"}
                          onChange={(budgetEndAtLocal) => props.onPatch(p.clientKey, { budgetEndAtLocal })}
                        />
                      </label>
                    </div>
                    <div className="evStageDates">
                      <label className="evField">
                        <span className="evFieldLabel">Факт: начало</span>
                        <DateTimeTextInput
                          className="evInput"
                          value={p.actualStartAtLocal}
                          disabled={props.disabled}
                          onChange={(actualStartAtLocal) => props.onPatch(p.clientKey, { actualStartAtLocal })}
                        />
                      </label>
                      <label className="evField">
                        <span className="evFieldLabel">Факт: окончание</span>
                        <DateTimeTextInput
                          className="evInput"
                          value={p.actualEndAtLocal}
                          disabled={props.disabled}
                          onChange={(actualEndAtLocal) => props.onPatch(p.clientKey, { actualEndAtLocal })}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="evStagesActions">
          <button className="btn" type="button" onClick={props.onAdd} disabled={props.disabled}>
            Добавить этап
          </button>
          <div className="muted small">Сохраните событие, чтобы применить этапы и пересчитать резервы мест.</div>
        </div>
      </div>
      ) : null}
    </div>
  );
}
