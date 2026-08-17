import { EventImportView } from "./EventImportView";
import { MassPlanView } from "./MassPlanView";

export type BulkEventsTab = "import" | "mass";

const TABS: Array<{ id: BulkEventsTab; label: string; hint: string }> = [
  {
    id: "import",
    label: "Импорт событий",
    hint: "Готовый план из Excel/CSV: конкретные борта, даты и места. Сначала предпросмотр, затем перенос в текущий контур."
  },
  {
    id: "mass",
    label: "Массовое планирование",
    hint: "Серия событий с виртуальными бортами и автоподбором мест. Один шаблон или список строк из файла."
  }
];

export function BulkEventsView(props: { tab: BulkEventsTab; onTab: (tab: BulkEventsTab) => void }) {
  const current = TABS.find((t) => t.id === props.tab) ?? TABS[0]!;

  return (
    <div className="massEventsPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Импорт и массовое планирование</div>
          <h1>Импорт/План</h1>
          <p>{current.hint}</p>
          <div className="massEventsTabs" role="tablist" aria-label="Режим раздела Импорт/План">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === props.tab}
                className={t.id === props.tab ? "isActive" : undefined}
                onClick={() => props.onTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
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

      {props.tab === "import" ? (
        <EventImportView hideHero onOpenMassPlan={() => props.onTab("mass")} />
      ) : (
        <MassPlanView hideHero />
      )}
    </div>
  );
}
