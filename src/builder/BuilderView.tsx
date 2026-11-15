/**
 * Вид «Построитель графиков»: графики по загруженным данным «как есть» (например, выгрузки Saphir).
 *
 * Схема экрана (инструменты — Sidebar слева, сворачивается в полоску иконок):
 *   нет исследований построителя → BuilderWelcome (создать)
 *   иначе:
 *     панель «Таблица графика» (данные активного графика, DataTable с chartView; сворачивается во вкладку)
 *     │ разделитель
 *     └─ ChartArea исследования построителя + LineInfo
 *
 * Каждый график построителя хранит свои столбцы в исследовании (isBuilder) и своё выделение (selKeyOf).
 */
import { useRef, useState } from "react";
import { useApp } from "../store";
import { DataTable } from "../table/DataTable";
import { ChartArea } from "../charts/ChartHost";
import { LineInfo } from "../charts/LineInfo";
import type { ChartDef } from "../core/types";

/**
 * Столбцы, которые показывает таблица графика: для каждой серии — её X (если ещё не показан), затем Y.
 * @param chart график построителя
 * @returns id столбцов по порядку
 */
export function chartColumnIds(chart: ChartDef): string[] {
  const ids: string[] = [];
  const push = (id: string | undefined): void => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(chart.xColumn);
  for (const y of chart.yColumns ?? []) {
    push(y.xColumnId ?? chart.xColumn);
    push(y.columnId);
  }
  return ids;
}

/** Нет ни одного исследования построителя: предложить создать. */
function BuilderWelcome() {
  const n = useApp((s) => s.project.studies.filter((x) => x.isBuilder).length);
  const [name, setName] = useState(`Построитель ${n + 1}`);
  return (
    <div className="welcome">
      <h1>Построитель графиков</h1>
      <p>
        Отдельная вкладка для работы только с графиками: загрузите данные графика как есть (например, выгрузку log-log или √t из Saphir),
        постройте прямые и кривые, наложите графики друг на друга. Пересчёта нет — точки строятся ровно по загруженным значениям.
      </p>
      <div className="row gap">
        <input className="input" value={name} aria-label="Название набора графиков" onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="btn primary big"
          onClick={() => {
            const st = useApp.getState();
            st.addBuilderStudy(name.trim() || "Построитель");
            st.setDialog({ kind: "builderImport" });
          }}
        >
          Создать и загрузить график
        </button>
      </div>
    </div>
  );
}

/** Таблица данных активного графика построителя. */
function ChartTablePanel({ onHide }: { onHide(): void }) {
  const study = useApp((s) => s.project.studies.find((x) => x.id === s.activeStudyId));
  const chart = useApp((s) => s.project.charts.find((c) => c.id === s.activeChartId && c.studyId === s.activeStudyId));
  const st = useApp.getState();
  const head = (title: React.ReactNode, withAdd: boolean) => (
    <div className="builder-table-head">
      <b>{title}</b>
      <span className="grow" />
      {withAdd && chart && (
        <button type="button" className="btn small" title="Добавить к графику серии из новых данных" onClick={() => st.setDialog({ kind: "builderImport", chartId: chart.id })}>
          + Серия
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Скрыть таблицу графика" title="Скрыть таблицу" onClick={onHide}>
        ⟨
      </button>
    </div>
  );
  if (!study || !chart)
    return (
      <div className="table-panel">
        {head("Таблица графика", false)}
        <p className="muted small pad">Кликните по графику — здесь появятся его данные.</p>
      </div>
    );
  return <DataTable study={study} part="p" chartView={{ columnIds: chartColumnIds(chart), selKey: chart.id, header: head(chart.name, true) }} />;
}

export function BuilderView() {
  const studyId = useApp((s) => (s.project.studies.find((x) => x.id === s.activeStudyId)?.isBuilder ? s.activeStudyId : null));
  const [tableW, setTableW] = useState(300);
  const [showTable, setShowTable] = useState(true);
  const drag = useRef<{ x: number; w: number } | null>(null);
  if (!studyId) return <BuilderWelcome />;
  return (
    <>
      {showTable ? (
        <>
          <div className="builder-table" style={{ width: tableW }}>
            <ChartTablePanel onHide={() => setShowTable(false)} />
          </div>
          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, w: tableW };
            }}
            onPointerMove={(e) => {
              if (drag.current) setTableW(Math.max(220, Math.min(window.innerWidth - 500, drag.current.w + e.clientX - drag.current.x)));
            }}
            onPointerUp={() => (drag.current = null)}
          />
        </>
      ) : (
        <button type="button" className="side-tab" onClick={() => setShowTable(true)} title="Показать таблицу данных графика">
          Таблица графика ⟩
        </button>
      )}
      <main className="main-charts">
        <ChartArea
          studyId={studyId}
          emptyHint={
            <div>
              <p>В этом наборе пока нет графиков.</p>
              <button type="button" className="btn primary" onClick={() => useApp.getState().setDialog({ kind: "builderImport" })}>
                Загрузить график
              </button>
            </div>
          }
        />
        <LineInfo />
      </main>
    </>
  );
}
