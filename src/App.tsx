/**
 * Корневой компонент.
 *
 * Схема экрана:
 *   TopBar (вид, проект, загрузка, вкладки исследований)
 *   ├─ Sidebar (инструменты) — в видах «Таблица + графики» и «Только графики»
 *   ├─ view = split  : DataTable | разделитель | ChartArea (+ LineInfo)
 *   ├─ view = charts : ChartGrid (+ LineInfo)
 *   ├─ view = calc   : Calculator
 *   ├─ StatusBar
 *   └─ активный диалог (store.dialog)
 */
import { useRef, useState } from "react";
import { useApp } from "./store";
import { TopBar } from "./ui/TopBar";
import { Sidebar } from "./ui/Sidebar";
import { DataTable } from "./table/DataTable";
import { ChartArea, ChartGrid } from "./charts/ChartHost";
import { LineInfo } from "./charts/LineInfo";
import { Calculator } from "./calc/Calculator";
import { ImportDialog } from "./dialogs/ImportDialog";
import { ChartSettingsDialog, ColumnsChartDialog, FlexDialog, TrendDialog } from "./dialogs/ChartDialogs";
import { ColumnPropsDialog, NewColumnDialog, StudyDialog } from "./dialogs/ColumnDialogs";

const TOOL_NAMES: Record<string, string> = {
  pan: "Рука — перетаскивание графика",
  zoom: "Приблизить — выделите область рамкой (двойной клик — по умолчанию)",
  rect: "Выделение прямоугольником",
  lasso: "Выделение лассо",
  click: "Выделение по точкам (Shift — добавить)",
  line2: "Прямая по двум точкам — два клика по графику",
  pickline: "Выбор прямой — клик по прямой",
  info: "Информация о прямой — клик по прямой",
  editline: "Изменить прямую — тянуть узел/линию; Ctrl — по горизонтали, Shift — по вертикали",
};

function Dialogs() {
  const d = useApp((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "import":
      return <ImportDialog />;
    case "flex":
      return <FlexDialog rows={d.rows} />;
    case "columnsChart":
      return <ColumnsChartDialog />;
    case "newColumn":
      return <NewColumnDialog />;
    case "columnProps":
      return <ColumnPropsDialog columnId={d.columnId} />;
    case "chartSettings":
      return <ChartSettingsDialog chartId={d.chartId} />;
    case "trend":
      return <TrendDialog chartId={d.chartId} />;
    case "study":
      return <StudyDialog studyId={d.studyId} />;
  }
}

function Welcome() {
  const st = useApp.getState();
  return (
    <div className="welcome">
      <h1>Анализ ГДИС в браузере</h1>
      <p>Загрузите данные исследования из буфера обмена или файла — или посмотрите на демо-данных, как всё работает.</p>
      <div className="row gap">
        <button type="button" className="btn primary big" onClick={() => st.setDialog({ kind: "import" })}>Загрузить данные</button>
        <button type="button" className="btn big" onClick={() => st.loadDemo()}>Открыть демо-исследования</button>
      </div>
      <p className="muted small">Проект сохраняется в этом браузере автоматически. Чтобы перенести на другой компьютер — «Проект → Сохранить в файл».</p>
    </div>
  );
}

export function App() {
  const view = useApp((s) => s.view);
  const tool = useApp((s) => s.tool);
  const studyId = useApp((s) => s.activeStudyId);
  const study = useApp((s) => s.project.studies.find((x) => x.id === s.activeStudyId));
  const sel = useApp((s) => (s.activeStudyId ? (s.selection[s.activeStudyId]?.length ?? 0) : 0));
  const [tableW, setTableW] = useState(460);
  const drag = useRef<{ x: number; w: number } | null>(null);

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        {view !== "calc" && <Sidebar />}
        {view === "calc" ? (
          <Calculator />
        ) : !study || !studyId ? (
          view === "charts" ? <ChartGrid /> : <Welcome />
        ) : view === "split" ? (
          <>
            <div className="table-wrap" style={{ width: tableW }}>
              <DataTable study={study} />
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
                if (drag.current) setTableW(Math.max(240, Math.min(window.innerWidth - 500, drag.current.w + e.clientX - drag.current.x)));
              }}
              onPointerUp={() => (drag.current = null)}
            />
            <main className="main-charts">
              <ChartArea studyId={studyId} />
              <LineInfo />
            </main>
          </>
        ) : (
          <main className="main-charts">
            <ChartGrid />
            <LineInfo />
          </main>
        )}
      </div>
      <footer className="statusbar">
        {view !== "calc" && <span>Инструмент: <b>{TOOL_NAMES[tool]}</b></span>}
        {sel > 0 && <span>Выделено строк: <b>{sel}</b></span>}
        <span className="grow" />
        <span>Колесо — масштаб · средняя кнопка — сдвиг · ПКМ по графику — параметры</span>
      </footer>
      <Dialogs />
    </div>
  );
}
