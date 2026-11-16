/**
 * Связка графика с хранилищем и окна графиков.
 *
 * Схема:
 *   ChartArea (свободные окна активного исследования)
 *     └─ ChartWindow (перетаскивание, растягивание, свернуть/развернуть/скрыть, переименование)
 *          └─ ChartHost → ChartView (данные из buildChartData, выделение и прямые — в store)
 *   ChartGrid (режим «Только графики»: сетка без свободных окон)
 *   ChartContextMenu (ПКМ: оси, сетка, тема, масштаб, параметры, экспорт, удаление)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartDef, View } from "../core/types";
import { useApp, tileCharts, selKeyOf, confirmDeleteChart } from "../store";
import { buildChartData, rateChangeHours } from "./series";
import { ChartView } from "./ChartView";
import { autoView } from "./geometry";
import { Icon } from "../ui/icons";
import { newChart } from "../core/factory";

/**
 * Применить выделение строк с учётом режима «добавить».
 * @param studyId исследование
 * @param rows строки
 * @param additive добавить к текущему выделению
 */
function applySelection(studyId: string, rows: number[], additive: boolean): void {
  const st = useApp.getState();
  const cur = st.selection[studyId] ?? [];
  st.setSelection(studyId, additive ? [...cur, ...rows] : rows);
}

/** График в окне: обычный или пара «давление + дебит» с общей осью времени. */
export function ChartHost({ chart }: { chart: ChartDef }) {
  return chart.kind === "combo" ? <ComboHost chart={chart} /> : <SingleHost chart={chart} />;
}

/**
 * Пара графиков: давление (сверху) и дебит (снизу).
 * Ось X общая: масштаб и сдвиг по времени в любом из графиков применяются к обоим (view и view2);
 * ось Y у каждого своя. Пунктир — моменты смены режима.
 */
function ComboHost({ chart }: { chart: ChartDef }) {
  const project = useApp((s) => s.project);
  const tool = useApp((s) => s.tool);
  const multi = useApp((s) => s.multiSelect);
  const sel = useApp((s) => s.selection[selKeyOf(chart, s.project)]);
  const selectedLine = useApp((s) => s.selectedLine);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const study = project.studies.find((s) => s.id === chart.studyId);
  const topChart = useMemo<ChartDef>(() => ({ ...chart, kind: "history", xLog: false, yLog: false }), [chart]);
  const botChart = useMemo<ChartDef>(() => ({ ...chart, kind: "rates", xLog: false, yLog: false, lines: [], defaultView: undefined }), [chart]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const topData = useMemo(() => buildChartData(topChart, project), [study, chart.rows]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const botData = useMemo(() => buildChartData(botChart, project), [study]);
  const vLines = useMemo(() => (study ? rateChangeHours(study) : []), [study]);
  const selected = useMemo(() => new Set(sel ?? []), [sel]);
  const st = useApp.getState();

  // Общий автодиапазон времени по обоим графикам.
  const autoTop = autoView(topData.series, false, false);
  const autoBot = autoView(botData.series, false, false);
  const hasTop = topData.series.some((s) => s.points.length > 0);
  const hasBot = botData.series.some((s) => s.points.length > 0);
  const xmin = hasTop && hasBot ? Math.min(autoTop.xmin, autoBot.xmin) : hasBot ? autoBot.xmin : autoTop.xmin;
  const xmax = hasTop && hasBot ? Math.max(autoTop.xmax, autoBot.xmax) : hasBot ? autoBot.xmax : autoTop.xmax;
  const topView: View = chart.view ?? chart.defaultView ?? { ...autoTop, xmin, xmax };
  const botView: View = { ...(chart.view2 ?? autoBot), xmin: topView.xmin, xmax: topView.xmax };
  const common = {
    tool,
    multi,
    vLines,
    onActivate: () => {
      if (useApp.getState().activeChartId !== chart.id) st.setActiveChart(chart.id);
    },
    onContextMenu: (x: number, y: number) => setMenu({ x, y }),
  };
  return (
    <div className="combo">
      <div className="combo-top">
        <ChartView
          {...common}
          compactX
          chart={{ ...topChart, view: topView }}
          data={topData}
          selected={selected}
          selectedLineId={selectedLine?.chartId === chart.id ? selectedLine.lineId : null}
          onView={(v) => st.updateChart(chart.id, { view: v, view2: { ...botView, xmin: v.xmin, xmax: v.xmax } })}
          onSelectRows={(rows, add) => applySelection(selKeyOf(chart, useApp.getState().project), rows, add)}
          onAddLine={(l) => st.addLine(chart.id, l)}
          onUpdateLine={(id, patch) => st.updateLine(chart.id, id, patch)}
          onSelectLine={(id, info) => st.selectLine(id ? { chartId: chart.id, lineId: id } : null, info)}
        />
      </div>
      <div className="combo-bot">
        <ChartView
          {...common}
          chart={{ ...botChart, view: botView }}
          data={botData}
          selected={EMPTY}
          selectedLineId={null}
          onView={(v) => st.updateChart(chart.id, { view2: v, view: { ...topView, xmin: v.xmin, xmax: v.xmax } })}
          onSelectRows={() => undefined}
          onAddLine={() => undefined}
          onUpdateLine={() => undefined}
          onSelectLine={() => undefined}
        />
      </div>
      {menu && <ChartContextMenu chart={chart} x={menu.x} y={menu.y} onClose={() => setMenu(null)} autoV={() => ({ ...autoTop, xmin, xmax })} />}
    </div>
  );
}

const EMPTY = new Set<number>();

function SingleHost({ chart }: { chart: ChartDef }) {
  const project = useApp((s) => s.project);
  const tool = useApp((s) => s.tool);
  const multi = useApp((s) => s.multiSelect);
  const sel = useApp((s) => s.selection[selKeyOf(chart, s.project)]);
  const selectedLine = useApp((s) => s.selectedLine);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const studiesKey = useMemo(
    () => project.studies.filter((s) => s.id === chart.studyId || chart.overlayStudyIds?.includes(s.id)),
    [project.studies, chart.studyId, chart.overlayStudyIds],
  );
  const data = useMemo(
    () => buildChartData(chart, project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart.kind, chart.timeFn, chart.superposition, chart.yFn, chart.normalizeByRate, chart.derivL, chart.xColumn, chart.yColumns, chart.rows, chart.overlayStudyIds, chart.studyId, studiesKey],
  );
  const selected = useMemo(() => new Set(sel ?? []), [sel]);
  const st = useApp.getState();
  return (
    <>
      <ChartView
        chart={chart}
        data={data}
        selected={selected}
        tool={tool}
        multi={multi}
        selectedLineId={selectedLine?.chartId === chart.id ? selectedLine.lineId : null}
        onView={(view) => st.updateChart(chart.id, { view })}
        onSelectRows={(rows, add) => applySelection(selKeyOf(chart, useApp.getState().project), rows, add)}
        onAddLine={(l) => st.addLine(chart.id, l)}
        onUpdateLine={(id, patch) => st.updateLine(chart.id, id, patch)}
        onSelectLine={(id, info) => st.selectLine(id ? { chartId: chart.id, lineId: id } : null, info)}
        onContextMenu={(x, y) => setMenu({ x, y })}
        onActivate={() => {
          if (useApp.getState().activeChartId !== chart.id) st.setActiveChart(chart.id);
        }}
      />
      {menu && <ChartContextMenu chart={chart} x={menu.x} y={menu.y} onClose={() => setMenu(null)} autoV={() => autoView(data.series, chart.xLog, chart.yLog)} />}
    </>
  );
}

/**
 * Перевести область при переключении лог/лин оси (чтобы график не «улетал»).
 * @param v область
 * @param axis ось
 * @param toLog переход к лог-оси
 * @returns новая область
 */
function convertView(v: View | undefined, axis: "x" | "y", toLog: boolean): View | undefined {
  if (!v) return undefined;
  const conv = (a: number): number => (toLog ? (a > 0 ? Math.log10(a) : Number.NaN) : 10 ** a);
  const r = { ...v };
  const lo = axis === "x" ? "xmin" : "ymin";
  const hi = axis === "x" ? "xmax" : "ymax";
  r[lo] = conv(v[lo]);
  r[hi] = conv(v[hi]);
  return Number.isFinite(r[lo]) && Number.isFinite(r[hi]) ? r : undefined;
}

function ChartContextMenu(props: { chart: ChartDef; x: number; y: number; onClose(): void; autoV(): View }) {
  const { chart, onClose } = props;
  const st = useApp.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  const item = (label: string, act: () => void, check?: boolean) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        act();
        onClose();
      }}
    >
      <span>{label}</span>
      <span className="muted">{check === undefined ? "" : check ? "✓" : ""}</span>
    </button>
  );
  const toggleAxis = (axis: "x" | "y"): void => {
    const on = axis === "x" ? !chart.xLog : !chart.yLog;
    st.updateChart(chart.id, {
      [axis === "x" ? "xLog" : "yLog"]: on,
      view: convertView(chart.view, axis, on),
      defaultView: undefined,
      lines: [],
    });
  };
  const left = Math.min(props.x, window.innerWidth - 260);
  const top = Math.min(props.y, window.innerHeight - 380);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left, top, position: "fixed" }}>
      {item("Параметры графика…", () => st.setDialog({ kind: "chartSettings", chartId: chart.id }))}
      {item("Вид точек…", () => st.setDialog({ kind: "pointStyle", chartId: chart.id }))}
      {item("Логарифмическая ось X", () => toggleAxis("x"), chart.xLog)}
      {item("Логарифмическая ось Y", () => toggleAxis("y"), chart.yLog)}
      {item("Сетка", () => st.updateChart(chart.id, { showGrid: !chart.showGrid }), chart.showGrid)}
      {item(chart.theme === "dark" ? "Светлая тема" : "Тёмная тема", () =>
        st.updateChart(chart.id, { theme: chart.theme === "dark" ? "light" : "dark" }),
      )}
      <hr />
      {item("Масштаб по умолчанию", () => st.updateChart(chart.id, { view: chart.defaultView, view2: undefined }))}
      {item("Сохранить масштаб как по умолчанию", () => st.updateChart(chart.id, { defaultView: chart.view ?? props.autoV() }))}
      {item("Сбросить сохранённый масштаб", () => st.updateChart(chart.id, { defaultView: undefined, view: undefined, view2: undefined }))}
      <hr />
      {item("Линия тренда по выделенным…", () => st.setDialog({ kind: "trend", chartId: chart.id }))}
      {item("Экспорт PNG", () => exportPng(chart))}
      {item("Скрыть график", () => st.updateChart(chart.id, { visible: false }))}
      {item("Удалить график", () => {
        confirmDeleteChart(chart);
      })}
    </div>
  );
}

/** Сохранить изображение графика в PNG. */
function exportPng(chart: ChartDef): void {
  const cv = document.querySelector<HTMLCanvasElement>(`[data-chart="${chart.id}"] canvas`);
  if (!cv) return;
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png");
  a.download = `${chart.name}.png`;
  a.click();
}

/** Заголовок окна графика с переименованием. */
function ChartTitle({ chart }: { chart: ChartDef }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(chart.name);
  const st = useApp.getState();
  if (edit)
    return (
      <input
        className="title-input"
        autoFocus
        value={val}
        aria-label="Название графика"
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          st.updateChart(chart.id, { name: val.trim() || chart.name });
          setEdit(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setVal(chart.name);
            setEdit(false);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  return (
    <span className="win-title" onDoubleClick={() => { setVal(chart.name); setEdit(true); }}>
      <span className="ellipsis">{chart.name}</span>
      <button type="button" className="win-btn" aria-label="Переименовать график" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setVal(chart.name); setEdit(true); }}>
        <Icon name="pencil" size={13} />
      </button>
    </span>
  );
}

type Resize = "move" | "e" | "s" | "se" | "w" | "n" | "nw" | "ne" | "sw";

function ChartWindow({ chart, area }: { chart: ChartDef; area: { w: number; h: number } }) {
  const active = useApp((s) => s.activeChartId === chart.id);
  // Окно, с которым работали последним, — поверх остальных; развёрнутое — поверх всех.
  const z = useApp((s) => s.zOrder[chart.id] ?? 0);
  const st = useApp.getState();
  const drag = useRef<{ mode: Resize; sx: number; sy: number; rect: ChartDef["rect"] } | null>(null);
  const r = chart.maximized ? { x: 0, y: 0, w: area.w, h: area.h } : chart.rect;
  const height = chart.minimized ? 30 : r.h;

  const start = (mode: Resize) => (e: React.PointerEvent): void => {
    if (chart.maximized) return;
    e.preventDefault();
    st.setActiveChart(chart.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, rect: chart.rect };
  };
  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const n = { ...d.rect };
    if (d.mode === "move") {
      n.x = Math.max(0, Math.min(area.w - 80, d.rect.x + dx));
      n.y = Math.max(0, Math.min(area.h - 30, d.rect.y + dy));
    } else {
      if (d.mode.includes("e")) n.w = Math.max(220, d.rect.w + dx);
      if (d.mode.includes("s")) n.h = Math.max(160, d.rect.h + dy);
      if (d.mode.includes("w")) {
        n.w = Math.max(220, d.rect.w - dx);
        n.x = d.rect.x + d.rect.w - n.w;
      }
      if (d.mode.includes("n")) {
        n.h = Math.max(160, d.rect.h - dy);
        n.y = d.rect.y + d.rect.h - n.h;
      }
    }
    st.updateChart(chart.id, { rect: n });
  };
  const end = (): void => {
    drag.current = null;
  };

  return (
    <section
      className={`win${active ? " active" : ""}`}
      data-chart={chart.id}
      aria-label={chart.name}
      style={{ left: r.x, top: r.y, width: r.w, height, zIndex: (chart.maximized ? 10_000 : 0) + (active ? 5_000 : 0) + z }}
      onPointerDown={() => st.setActiveChart(chart.id)}
    >
      <header className="win-head" onPointerDown={start("move")} onPointerMove={move} onPointerUp={end} onDoubleClick={() => st.updateChart(chart.id, { maximized: !chart.maximized })}>
        <ChartTitle chart={chart} />
        <button type="button" className="win-btn" aria-label={chart.minimized ? "Развернуть окно" : "Свернуть"} onPointerDown={(e) => e.stopPropagation()} onClick={() => { st.setActiveChart(chart.id); st.updateChart(chart.id, { minimized: !chart.minimized, maximized: false }); }}>
          <Icon name="minimize" size={14} />
        </button>
        <button type="button" className="win-btn" aria-label={chart.maximized ? "Восстановить размер" : "Во весь экран"} onPointerDown={(e) => e.stopPropagation()} onClick={() => { st.setActiveChart(chart.id); st.updateChart(chart.id, { maximized: !chart.maximized, minimized: false }); }}>
          <Icon name={chart.maximized ? "restore" : "maximize"} size={14} />
        </button>
        <button type="button" className="win-btn" aria-label="Удалить график" title="Удалить график" onPointerDown={(e) => e.stopPropagation()} onClick={() => confirmDeleteChart(chart)}>
          <Icon name="trash" size={13} />
        </button>
        <button type="button" className="win-btn" aria-label="Скрыть график" title="Скрыть (вернуть — кнопкой «Графики» внизу)" onPointerDown={(e) => e.stopPropagation()} onClick={() => st.updateChart(chart.id, { visible: false })}>
          <Icon name="close" size={14} />
        </button>
      </header>
      {!chart.minimized && (
        <div className="win-body">
          <ChartHost chart={chart} />
        </div>
      )}
      {!chart.maximized && !chart.minimized &&
        (["e", "s", "se", "w", "n", "nw", "ne", "sw"] as const).map((m) => (
          <div key={m} className={`rz rz-${m}`} onPointerDown={start(m)} onPointerMove={move} onPointerUp={end} />
        ))}
    </section>
  );
}

/** Область свободных окон графиков активного исследования. */
/** Размер области графиков, при котором окна исследования были разложены последний раз. */
const layoutArea = new Map<string, { w: number; h: number }>();

export function ChartArea({ studyId, emptyHint }: { studyId: string; emptyHint?: React.ReactNode }) {
  const charts = useApp((s) => s.project.charts);
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const mine = charts.filter((c) => c.studyId === studyId);
  const tiled = useRef(new Set<string>());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Область графиков изменилась (свернули панель, сдвинули разделитель) — окна растягиваются пропорционально,
  // раскладка пользователя сохраняется. Размер области запоминается для каждого исследования.
  useEffect(() => {
    if (area.w < 200 || area.h < 150) return;
    const prev = layoutArea.get(studyId);
    layoutArea.set(studyId, area);
    if (!prev || (prev.w === area.w && prev.h === area.h)) return;
    const kx = area.w / prev.w;
    const ky = area.h / prev.h;
    const st = useApp.getState();
    st.project.charts
      .filter((c) => c.studyId === studyId)
      .forEach((c) => st.updateChart(c.id, { rect: { x: c.rect.x * kx, y: c.rect.y * ky, w: Math.max(240, c.rect.w * kx), h: Math.max(160, c.rect.h * ky) } }));
  }, [area, studyId]);

  // Новые графики (с размером по умолчанию) раскладываем в сетку один раз.
  useEffect(() => {
    if (area.w < 200) return;
    const fresh = mine.filter((c) => c.rect.x === 0 && c.rect.y === 0 && c.rect.w === 520 && !tiled.current.has(c.id));
    if (fresh.length === 0) return;
    mine.forEach((c) => tiled.current.add(c.id));
    const laid = tileCharts(mine, area);
    const st = useApp.getState();
    laid.forEach((c) => st.updateChart(c.id, { rect: c.rect }));
  }, [mine, area]);

  return (
    <div ref={ref} className="chart-area">
      {mine.filter((c) => c.visible).map((c) => (
        <ChartWindow key={c.id} chart={c} area={area} />
      ))}
      {mine.filter((c) => c.visible).length === 0 && (
        <div className="empty-hint">
          {mine.length === 0 && emptyHint ? emptyHint : "Нет открытых графиков. Создайте график в группе «Графики» слева или откройте его кнопкой «Графики» внизу."}
        </div>
      )}
      <ChartsMenu charts={mine} area={area} />
    </div>
  );
}

/** Режим «Только графики»: сетка графиков выбранных исследований. */
export function ChartGrid() {
  const project = useApp((s) => s.project);
  const filter = useApp((s) => s.chartsFilter);
  const st = useApp.getState();
  const ids = filter ?? project.studies.filter((s) => !s.isMain && !s.isBuilder).map((s) => s.id);
  const charts = project.charts.filter((c) => ids.includes(c.studyId) && c.visible);
  const max = charts.find((c) => c.maximized);
  const shown = max ? [max] : charts;
  const cols = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3;
  return (
    <div className="grid-view">
      <div className="grid-filter">
        <b>Показать исследования:</b>
        {project.studies.filter((s) => !s.isBuilder).map((s) => {
          const on = ids.includes(s.id);
          return (
            <label key={s.id} className={`chip${on ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => st.setChartsFilter(on ? ids.filter((x) => x !== s.id) : [...ids, s.id])}
              />
              {s.isMain ? "Главная страница" : s.name}
            </label>
          );
        })}
        <span className="grow" />
        <OverlayButton studyIds={ids} />
      </div>
      <div className="grid-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((c) => {
          const study = project.studies.find((s) => s.id === c.studyId);
          return (
            <section key={c.id} className="win grid-win" data-chart={c.id} aria-label={c.name}>
              <header className="win-head" onDoubleClick={() => st.updateChart(c.id, { maximized: !c.maximized })}>
                <span className="study-badge">{study?.name}</span>
                <ChartTitle chart={c} />
                <button type="button" className="win-btn" aria-label="Во весь экран" onClick={() => st.updateChart(c.id, { maximized: !c.maximized })}>
                  <Icon name={c.maximized ? "restore" : "maximize"} size={14} />
                </button>
                <button type="button" className="win-btn" aria-label="Скрыть график" onClick={() => st.updateChart(c.id, { visible: false, maximized: false })}>
                  <Icon name="close" size={14} />
                </button>
              </header>
              <div className="win-body">
                <ChartHost chart={c} />
              </div>
            </section>
          );
        })}
        {shown.length === 0 && <div className="empty-hint">Нет видимых графиков для выбранных исследований.</div>}
      </div>
      <div className="chart-area-menu-anchor">
        <ChartsMenu charts={project.charts.filter((c) => ids.includes(c.studyId))} area={null} />
      </div>
    </div>
  );
}

/** Создать график наложения производных нескольких исследований. */
function OverlayButton({ studyIds }: { studyIds: string[] }) {
  const st = useApp.getState();
  return (
    <button
      type="button"
      className="btn"
      disabled={studyIds.length < 2}
      onClick={() => {
        const [first, ...rest] = studyIds;
        if (!first) return;
        const names = useApp.getState().project.studies.filter((s) => studyIds.includes(s.id)).map((s) => s.name);
        st.addChart(newChart("loglog", first, { name: `Наложение: ${names.join(" · ")}`, overlayStudyIds: rest }));
      }}
    >
      + Наложить на один график
    </button>
  );
}

/** Кнопка «Графики» внизу справа: список графиков, показать/скрыть (Shift — группа). */
function ChartsMenu({ charts, area }: { charts: ChartDef[]; area: { w: number; h: number } | null }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const project = useApp((s) => s.project);
  const st = useApp.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const visible = charts.filter((c) => c.visible).length;
  const click = (i: number, e: React.MouseEvent): void => {
    const c = charts[i];
    if (!c) return;
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      const target = !c.visible;
      for (let k = a; k <= b; k++) {
        const ck = charts[k];
        if (ck) st.updateChart(ck.id, { visible: target });
      }
    } else {
      st.updateChart(c.id, { visible: !c.visible, minimized: false });
      setAnchor(i);
    }
  };
  return (
    <div ref={ref} className="charts-menu">
      {open && (
        <div className="menu charts-list" role="menu" aria-label="Список графиков">
          <div className="muted small">Клик — показать/скрыть, Shift + клик — группа</div>
          {charts.map((c, i) => {
            const s = project.studies.find((x) => x.id === c.studyId);
            return (
              <label key={c.id} className="check-row" onClick={(e) => { e.preventDefault(); click(i, e); }}>
                <input type="checkbox" readOnly checked={c.visible} />
                <span className="ellipsis grow">{area ? c.name : `${s?.name ?? ""} · ${c.name}`}</span>
                <button
                  type="button"
                  className="icon-btn row-del"
                  aria-label={`Удалить график ${c.name}`}
                  title="Удалить график"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmDeleteChart(c);
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </label>
            );
          })}
          {charts.length === 0 && <div className="muted small">Графиков пока нет</div>}
          <hr />
          <div className="row gap">
            <button type="button" className="btn small" onClick={() => charts.forEach((c) => st.updateChart(c.id, { visible: true }))}>Показать все</button>
            {area && (
              <button type="button" className="btn small" onClick={() => tileCharts(charts, area).forEach((c) => st.updateChart(c.id, { rect: c.rect, minimized: false, maximized: false }))}>
                Упорядочить окна
              </button>
            )}
          </div>
        </div>
      )}
      <button type="button" className="btn charts-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="grid" size={16} /> Графики ({visible} из {charts.length}) {open ? "▾" : "▴"}
      </button>
    </div>
  );
}
