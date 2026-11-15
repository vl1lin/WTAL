/**
 * Левая панель инструментов с раскрывающимися группами.
 *
 * Схема групп (на главной странице — только «График», «Данные» с «Создать исследование», «Таблица»):
 *   Графики  — Log-log, Semilog, История давления, История дебитов, Давление + дебит, Произвольный (диалог),
 *              По столбцам (диалог), По выделенному (диалог по выделенным строкам)
 *   Данные   — выделение прямоугольником / лассо / кликом, «Множество точек», снять выделение
 *   Прямые   — по 2 точкам, тренд (диалог), выбрать, инфо, изменить, удалить
 *   График   — параметры/оси, приблизить (рамкой), отдалить, по умолчанию, сохранить масштаб, рука, скрыть
 *   Таблица  — пустой столбец, ƒx-столбец
 * В построителе графиков: Графики (загрузить, + серия, наложить), Данные, Прямые, График.
 * Панель сворачивается в узкую полоску иконок (кнопка сверху).
 */
import { useState } from "react";
import { useApp, type Tool } from "../store";
import { Icon } from "./icons";
import { newChart } from "../core/factory";
import type { ChartKind } from "../core/types";
import { autoView } from "../charts/geometry";
import { buildChartData } from "../charts/series";

function ToolBtn(props: { icon: string; label: string; active?: boolean; disabled?: boolean; onClick(): void; title?: string }) {
  return (
    <button
      type="button"
      className={`tool${props.active ? " on" : ""}`}
      aria-pressed={props.active}
      disabled={props.disabled}
      title={props.title ?? props.label}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={18} />
      <span>{props.label}</span>
    </button>
  );
}

function Group({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="group">
      <button type="button" className="group-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          <div className="tools">{children}</div>
          {extra}
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  const tool = useApp((s) => s.tool);
  const multi = useApp((s) => s.multiSelect);
  const studyId = useApp((s) => s.activeStudyId);
  const activeChartId = useApp((s) => s.activeChartId);
  const selectedLine = useApp((s) => s.selectedLine);
  const view = useApp((s) => s.view);
  const st = useApp.getState();
  const T = (t: Tool) => ({ active: tool === t, onClick: () => st.setTool(t) });
  const noStudy = !studyId;
  // Главная страница: только «График», «Данные» (+ создать исследование), «Таблица».
  const isMain = useApp((s) => Boolean(s.project.studies.find((x) => x.id === s.activeStudyId)?.isMain));
  // Свёрнутое состояние панели запоминается в браузере.
  const [rail, setRailState] = useState(() => {
    try {
      return localStorage.getItem("wtal.rail") === "1";
    } catch {
      return false;
    }
  });
  const setRail = (v: boolean): void => {
    setRailState(v);
    try {
      localStorage.setItem("wtal.rail", v ? "1" : "0");
    } catch {
      /* хранилище недоступно — состояние только на эту сессию */
    }
  };
  const builder = view === "builder";
  const builderChart = useApp((s) => s.project.charts.some((c) => c.id === s.activeChartId && c.studyId === s.activeStudyId));
  const selKey = (): string | null => (builder ? useApp.getState().activeChartId : studyId);
  const activeChart = (): ReturnType<typeof useApp.getState>["project"]["charts"][number] | undefined => {
    const s = useApp.getState();
    return s.project.charts.find((c) => c.id === s.activeChartId);
  };
  const add = (kind: ChartKind): void => {
    if (!studyId) return;
    const names: Partial<Record<ChartKind, string>> = {
      semilog: "Semilog",
      history: "История давления",
      rates: "История дебитов",
      combo: "История: давление и дебит",
    };
    const study = useApp.getState().project.studies.find((s) => s.id === studyId);
    st.addChart(newChart(kind, studyId, { name: kind === "loglog" ? `Диагностика ${study?.name ?? ""} (log-log)` : (names[kind] ?? kind) }));
    if (view === "calc") st.setView("split");
  };
  const zoomOut = (): void => {
    const c = activeChart();
    if (!c) return;
    const v = c.view ?? c.defaultView ?? autoView(buildChartData(c, useApp.getState().project).series, c.xLog, c.yLog);
    const cx = (v.xmin + v.xmax) / 2;
    const cy = (v.ymin + v.ymax) / 2;
    const hw = v.xmax - v.xmin;
    const hh = v.ymax - v.ymin;
    st.updateChart(c.id, { view: { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh } });
  };

  const lineTools = (
    <Group title="Прямые">
        <ToolBtn icon="line2" label="По 2 точкам" {...T("line2")} title="Отрезок по двум кликам; с Ctrl — прямая на весь график" />
        <ToolBtn icon="curve" label="Кривая" {...T("curve")} title="Кривая через точки: клики по узлам, двойной клик / Enter / ПКМ — завершить" />
        <ToolBtn
          icon="trend"
          label="Тренд"
          disabled={!activeChartId}
          onClick={() => activeChartId && st.setDialog({ kind: "trend", chartId: activeChartId })}
          title="Линия тренда по выделенным точкам активного графика"
        />
        <ToolBtn icon="pickline" label="Выбрать" {...T("pickline")} />
        <ToolBtn icon="info" label="Инфо" active={tool === "info"} onClick={() => { st.setTool("info"); if (selectedLine) st.selectLine(selectedLine, true); }} />
        <ToolBtn icon="editline" label="Изменить" {...T("editline")} title="Тянуть узел или прямую. Ctrl — по горизонтали, Shift — по вертикали" />
        <ToolBtn icon="trash" label="Удалить" disabled={!selectedLine} onClick={() => selectedLine && st.removeLine(selectedLine.chartId, selectedLine.lineId)} />
      </Group>
  );
  const chartTools = (
    <Group title="График">
        <ToolBtn icon="axes" label="Оси" disabled={!activeChartId} onClick={() => activeChartId && st.setDialog({ kind: "chartSettings", chartId: activeChartId })} title="Параметры и оси активного графика" />
        <ToolBtn icon="points" label="Вид точек" disabled={!activeChartId} onClick={() => activeChartId && st.setDialog({ kind: "pointStyle", chartId: activeChartId })} title="Размер, прозрачность и прореживание точек активного графика" />
        <ToolBtn icon="zoomin" label="Приблизить" {...T("zoom")} title="Выделите область рамкой. Двойной клик — масштаб по умолчанию" />
        <ToolBtn icon="zoomout" label="Отдалить" disabled={!activeChartId} onClick={zoomOut} />
        <ToolBtn icon="pan" label="Рука" {...T("pan")} title="Сдвиг графика (также средняя кнопка мыши)" />
        <ToolBtn icon="reset" label="По умолч." disabled={!activeChartId} onClick={() => { const c = activeChart(); if (c) st.updateChart(c.id, { view: c.defaultView, view2: undefined }); }} />
        <ToolBtn icon="savedef" label="Сохр. вид" title="Сохранить текущий масштаб как масштаб по умолчанию" disabled={!activeChartId} onClick={() => { const c = activeChart(); if (c) st.updateChart(c.id, { defaultView: c.view ?? autoView(buildChartData(c, useApp.getState().project).series, c.xLog, c.yLog) }); }} />
        <ToolBtn icon="hide" label="Скрыть" disabled={!activeChartId} onClick={() => activeChartId && st.updateChart(activeChartId, { visible: false })} />
      </Group>
  );

  return (
    <nav className={`sidebar${rail ? " rail" : ""}`} aria-label="Инструменты">
      <button type="button" className="rail-toggle" aria-expanded={!rail} title={rail ? "Развернуть панель инструментов" : "Свернуть панель инструментов"} onClick={() => setRail(!rail)}>
        {rail ? "»" : "« Свернуть"}
      </button>
      {builder ? (
        <>
      <Group title="Графики">
        <ToolBtn icon="loadchart" label="Загрузить" disabled={noStudy} onClick={() => st.setDialog({ kind: "builderImport" })} title="Данные графика как есть (например, выгрузка из Saphir)" />
        <ToolBtn icon="addcol" label="+ Серия" disabled={!builderChart} onClick={() => activeChartId && st.setDialog({ kind: "builderImport", chartId: activeChartId })} title="Добавить к активному графику серии из новых данных" />
        <ToolBtn icon="overlay" label="Наложить" disabled={noStudy} onClick={() => st.setDialog({ kind: "overlay" })} title="Собрать несколько графиков набора в одном окне" />
      </Group>
      <Group
        title="Данные"
        extra={
          <label className="check-line">
            <input type="checkbox" checked={multi} onChange={(e) => st.setMulti(e.target.checked)} /> Множество точек
          </label>
        }
      >
        <ToolBtn icon="rect" label="Прямоуг." {...T("rect")} title="Выделение прямоугольником" />
        <ToolBtn icon="lasso" label="Лассо" {...T("lasso")} />
        <ToolBtn icon="click" label="По точкам" {...T("click")} title="Выделение кликом (Shift — добавить)" />
        <ToolBtn icon="clearsel" label="Снять" disabled={!activeChartId} onClick={() => { const k = selKey(); if (k) st.setSelection(k, []); }} title="Снять выделение" />
      </Group>
      {lineTools}
      {chartTools}
        </>
      ) : isMain ? (
        <>
      {chartTools}
      <Group
        title="Данные"
        extra={
          <label className="check-line">
            <input type="checkbox" checked={multi} onChange={(e) => st.setMulti(e.target.checked)} /> Множество точек
          </label>
        }
      >
        <ToolBtn icon="rect" label="Прямоуг." {...T("rect")} title="Выделение прямоугольником" />
        <ToolBtn icon="lasso" label="Лассо" {...T("lasso")} />
        <ToolBtn icon="click" label="По точкам" {...T("click")} title="Выделение кликом (Shift — добавить)" />
        <ToolBtn icon="clearsel" label="Снять" disabled={noStudy} onClick={() => { const k = selKey(); if (k) st.setSelection(k, []); }} title="Снять выделение" />
        {isMain && (
          <ToolBtn
            icon="newstudy"
            label="Новое иссл."
            disabled={noStudy}
            title="Новое исследование из выделенных точек"
            onClick={() => st.setDialog({ kind: "createStudy" })}
          />
        )}
      </Group>
      <Group title="Таблица">
        <ToolBtn icon="addcol" label="Столбец" title="Пустой столбец" disabled={noStudy} onClick={() => studyId && st.addColumn(studyId, {}, undefined, useApp.getState().tablePart)} />
        <ToolBtn icon="fx" label="Столбец ƒx" disabled={noStudy} onClick={() => st.setDialog({ kind: "newColumn", formula: true })} />
      </Group>
        </>
      ) : (
        <>
      <Group title="Графики">
        <ToolBtn icon="loglog" label="Log-log" disabled={noStudy} onClick={() => add("loglog")} />
        <ToolBtn icon="semilog" label="Semilog" disabled={noStudy} onClick={() => add("semilog")} />
        <ToolBtn icon="history" label="История" disabled={noStudy} onClick={() => add("history")} title="История давления" />
        <ToolBtn icon="rates" label="Дебиты" disabled={noStudy} onClick={() => add("rates")} title="История дебитов (ступенчатый график)" />
        <ToolBtn icon="combo" label="Давл.+дебит" disabled={noStudy} onClick={() => add("combo")} title="Давление сверху, дебит снизу, общая ось времени" />
        <ToolBtn icon="custom" label="Произв." title="Произвольный график (функция времени, суперпозиция)" disabled={noStudy} onClick={() => st.setDialog({ kind: "flex" })} />
        <ToolBtn icon="columns" label="Столбцы" title="График по столбцам таблицы" disabled={noStudy} onClick={() => st.setDialog({ kind: "columnsChart" })} />
        <ToolBtn
          icon="plotsel"
          label="По выдел."
          disabled={noStudy}
          title="Пользовательский график по выделенным точкам (например, давление от √t)"
          onClick={() => studyId && st.setDialog({ kind: "flex", rows: useApp.getState().selection[studyId] ?? [] })}
        />
      </Group>
      <Group
        title="Данные"
        extra={
          <label className="check-line">
            <input type="checkbox" checked={multi} onChange={(e) => st.setMulti(e.target.checked)} /> Множество точек
          </label>
        }
      >
        <ToolBtn icon="rect" label="Прямоуг." {...T("rect")} title="Выделение прямоугольником" />
        <ToolBtn icon="lasso" label="Лассо" {...T("lasso")} />
        <ToolBtn icon="click" label="По точкам" {...T("click")} title="Выделение кликом (Shift — добавить)" />
        <ToolBtn icon="clearsel" label="Снять" disabled={noStudy} onClick={() => { const k = selKey(); if (k) st.setSelection(k, []); }} title="Снять выделение" />
        {isMain && (
          <ToolBtn
            icon="newstudy"
            label="Новое иссл."
            disabled={noStudy}
            title="Новое исследование из выделенных точек"
            onClick={() => st.setDialog({ kind: "createStudy" })}
          />
        )}
      </Group>
      {lineTools}
      {chartTools}
      <Group title="Таблица">
        <ToolBtn icon="addcol" label="Столбец" title="Пустой столбец" disabled={noStudy} onClick={() => studyId && st.addColumn(studyId, {}, undefined, useApp.getState().tablePart)} />
        <ToolBtn icon="fx" label="Столбец ƒx" disabled={noStudy} onClick={() => st.setDialog({ kind: "newColumn", formula: true })} />
      </Group>
        </>
      )}
    </nav>
  );
}
