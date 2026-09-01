import { EventImportView } from "./EventImportView";
import { MassPlanView } from "./MassPlanView";

export type BulkEventsTab = "import" | "mass";

const TABS: Array<{ id: BulkEventsTab; label: string }> = [
  { id: "import", label: "Импорт событий" },
  { id: "mass", label: "Массовое планирование" }
];

export function BulkEventsView(props: { tab: BulkEventsTab; onTab: (tab: BulkEventsTab) => void }) {
  return (
    <div className="massEventsPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Импорт и массовое планирование</div>
          <h1>Импорт/План</h1>
        </div>
        <div className="massHeroStats" aria-hidden="true">
          {props.tab === "import" ? (
            <>
              <span><b>Excel/CSV</b></span>
              <span><b>Реальные борта</b></span>
            </>
          ) : (
            <>
              <span><b>Серия работ</b></span>
              <span><b>Виртуальные борта</b></span>
            </>
          )}
        </div>
      </section>

      <div className="sandboxesTabs" role="tablist" aria-label="Режим раздела Импорт/План">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === props.tab}
            className={t.id === props.tab ? "sandboxesTab active" : "sandboxesTab"}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {props.tab === "import" ? (
        <EventImportView hideHero onOpenMassPlan={() => props.onTab("mass")} />
      ) : (
        <MassPlanView hideHero />
      )}
    </div>
  );
}
