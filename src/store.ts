/**
 * Глобальное состояние приложения (zustand).
 *
 * Схема:
 *   useApp
 *   ├─ project            — данные проекта (сохраняются в localStorage и в файл)
 *   ├─ UI: activeStudyId, view, tool, multiSelect, activeChartId, selectedLine, dialog
 *   ├─ selection          — выделенные строки по исследованиям (общие для таблицы и графиков)
 *   └─ действия: изменение исследований, ячеек, графиков, прямых, калькулятора
 *
 * Все изменения проекта иммутабельны — это нужно для кэша вычислений таблиц (WeakMap по Study).
 */
import { create } from "zustand";
import type { CalcState, ChartDef, Column, LineDef, Project, Study, TablePart } from "./core/types";
import { autoRoles, emptyProject, ensureMain, newChart, uid } from "./core/factory";
import { demoHistory, studyFromSelection } from "./core/extract";
import { baseData } from "./core/welltest";
import { computeSheet } from "./core/sheet";
import { loadProject, saveProjectDebounced } from "./persist";

export type Tool = "pan" | "zoom" | "rect" | "lasso" | "click" | "line2" | "curve" | "pickline" | "info" | "editline";
export type ViewMode = "split" | "charts" | "calc" | "builder";

export type Dialog =
  | { kind: "import"; part?: TablePart }
  | { kind: "flex"; rows?: number[] }
  | { kind: "columnsChart" }
  | { kind: "newColumn"; formula: boolean }
  | { kind: "columnProps"; columnId: string; part: TablePart }
  | { kind: "chartSettings"; chartId: string }
  | { kind: "trend"; chartId: string }
  | { kind: "study"; studyId: string }
  | { kind: "createStudy" }
  | { kind: "pointStyle"; chartId: string }
  | { kind: "builderImport"; chartId?: string }
  | { kind: "overlay" }
  | null;

interface AppState {
  project: Project;
  activeStudyId: string | null;
  view: ViewMode;
  tool: Tool;
  multiSelect: boolean;
  activeChartId: string | null;
  selectedLine: { chartId: string; lineId: string } | null;
  showLineInfo: boolean;
  dialog: Dialog;
  selection: Record<string, number[]>;
  chartsFilter: string[] | null;
  /** Какая таблица исследования открыта слева: давление или дебиты. */
  tablePart: TablePart;
  /** Порядок окон графиков: чем больше число, тем выше окно (последнее, с которым работали, — сверху). */
  zOrder: Record<string, number>;

  setTablePart(p: TablePart): void;
  setView(v: ViewMode): void;
  setTool(t: Tool): void;
  setMulti(v: boolean): void;
  setDialog(d: Dialog): void;
  setActiveStudy(id: string): void;
  setActiveChart(id: string | null): void;
  setChartsFilter(ids: string[] | null): void;

  replaceProject(p: Project): void;
  loadDemo(): void;

  addStudy(s: Study, charts: ChartDef["kind"][]): void;
  /** Создать пустое исследование построителя графиков и сделать его активным. */
  addBuilderStudy(name: string): string;
  /**
   * Добавить в исследование построителя столбцы загруженного графика и сам график
   * (или серии к существующему графику — если в chart уже есть id из проекта).
   */
  builderAddData(studyId: string, columns: Column[], chart: ChartDef): void;
  updateStudy(id: string, patch: Partial<Study>): void;
  removeStudy(id: string): void;
  /** Заменить таблицу давления или дебитов исследования (загрузка в существующее исследование). */
  replaceTable(studyId: string, part: TablePart, columns: Column[]): void;
  setCell(studyId: string, col: number, row: number, value: string, part?: TablePart): void;
  setCells(studyId: string, updates: { col: number; row: number; value: string }[], part?: TablePart): void;
  addColumn(studyId: string, col: Partial<Column>, index?: number, part?: TablePart): void;
  updateColumn(studyId: string, columnId: string, patch: Partial<Column>, part?: TablePart): void;
  removeColumn(studyId: string, columnId: string, part?: TablePart): void;
  insertRow(studyId: string, row: number, part?: TablePart): void;

  setSelection(studyId: string, rows: number[]): void;

  addChart(c: ChartDef): void;
  updateChart(id: string, patch: Partial<ChartDef>): void;
  removeChart(id: string): void;
  addLine(chartId: string, line: LineDef): void;
  updateLine(chartId: string, lineId: string, patch: Partial<LineDef>): void;
  removeLine(chartId: string, lineId: string): void;
  selectLine(sel: { chartId: string; lineId: string } | null, info?: boolean): void;

  updateCalc(patch: Partial<CalcState>): void;
  addGroup(name: string, studyIds: string[]): void;
  removeGroup(id: string): void;
}

/**
 * Изменить исследование по id.
 * @param p проект
 * @param id исследование
 * @param f функция изменения
 * @returns новый проект
 */
function mapStudy(p: Project, id: string, f: (s: Study) => Study): Project {
  return { ...p, studies: p.studies.map((s) => (s.id === id ? f(s) : s)) };
}

/**
 * Изменить график по id.
 * @param p проект
 * @param id график
 * @param f функция изменения
 * @returns новый проект
 */
function mapChart(p: Project, id: string, f: (c: ChartDef) => ChartDef): Project {
  return { ...p, charts: p.charts.map((c) => (c.id === id ? f(c) : c)) };
}

/** Столбцы выбранной таблицы исследования. */
export function tableCols(s: Study, part: TablePart): Column[] {
  return part === "q" ? s.rateColumns : s.columns;
}

/** Исследование с заменёнными столбцами выбранной таблицы. */
function withCols(s: Study, part: TablePart, cols: Column[]): Study {
  return part === "q" ? { ...s, rateColumns: cols } : { ...s, columns: cols };
}

/** Выровнять длину всех столбцов таблицы. */
function padCols(cols: Column[]): Column[] {
  const n = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  return cols.map((c) =>
    c.cells.length === n ? c : { ...c, cells: [...c.cells, ...new Array<string>(n - c.cells.length).fill("")] },
  );
}

/** Выровнять длину столбцов в обеих таблицах исследования. */
function normalizeRows(s: Study): Study {
  return { ...s, columns: padCols(s.columns), rateColumns: padCols(s.rateColumns) };
}

/**
 * Начальная раскладка окон графиков в сетку.
 * @param charts графики одного исследования
 * @param area размер области графиков
 * @returns графики с выставленными rect
 */
export function tileCharts(charts: ChartDef[], area: { w: number; h: number }): ChartDef[] {
  const vis = charts.filter((c) => c.visible);
  const n = Math.max(1, vis.length);
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 8;
  const w = Math.max(240, (area.w - gap * (cols + 1)) / cols);
  const h = Math.max(180, (area.h - gap * (rows + 1)) / rows);
  let k = 0;
  return charts.map((c) => {
    if (!c.visible) return c;
    const i = k++;
    return {
      ...c,
      minimized: false,
      maximized: false,
      rect: { x: gap + (i % cols) * (w + gap), y: gap + Math.floor(i / cols) * (h + gap), w, h },
    };
  });
}

/**
 * Ключ выделения строк для графика: у исследований — общее выделение исследования (таблица и все графики),
 * у графиков построителя — своё (у каждого графика свои данные).
 * @param chart график
 * @param project проект
 * @returns ключ в store.selection
 */
export function selKeyOf(chart: ChartDef, project: Project): string {
  return project.studies.find((s) => s.id === chart.studyId)?.isBuilder ? chart.id : chart.studyId;
}

const initial = loadProject();

export const useApp = create<AppState>((set, get) => ({
  project: initial,
  activeStudyId: initial.studies[0]?.id ?? null,
  view: "split",
  tool: "rect",
  multiSelect: false,
  activeChartId: null,
  selectedLine: null,
  showLineInfo: false,
  dialog: null,
  selection: {},
  chartsFilter: null,
  tablePart: "p",
  zOrder: {},

  setTablePart: (tablePart) => set({ tablePart }),
  setView: (view) =>
    set((st) => {
      // Построитель и анализ работают с разными наборами вкладок: при переключении выбираем подходящую.
      const studies = st.project.studies;
      const cur = studies.find((s) => s.id === st.activeStudyId);
      const wantBuilder = view === "builder";
      if (view === "calc" || Boolean(cur?.isBuilder) === wantBuilder) return { view };
      const next = studies.find((s) => Boolean(s.isBuilder) === wantBuilder);
      return { view, activeStudyId: next?.id ?? (wantBuilder ? null : (studies[0]?.id ?? null)), activeChartId: null, selectedLine: null };
    }),
  setTool: (tool) => set({ tool }),
  setMulti: (multiSelect) => set({ multiSelect }),
  setDialog: (dialog) => set({ dialog }),
  setActiveStudy: (id) =>
    set((st) => {
      const builder = Boolean(st.project.studies.find((s) => s.id === id)?.isBuilder);
      const view = builder ? "builder" : st.view === "calc" || st.view === "builder" ? "split" : st.view;
      return { activeStudyId: id, view };
    }),
  setActiveChart: (id) =>
    set((st) => {
      if (!id) return { activeChartId: null };
      const top = Math.max(0, ...Object.values(st.zOrder));
      return { activeChartId: id, zOrder: st.zOrder[id] === top && top > 0 ? st.zOrder : { ...st.zOrder, [id]: top + 1 } };
    }),
  setChartsFilter: (chartsFilter) => set({ chartsFilter }),

  replaceProject: (p) => {
    const proj = ensureMain(p);
    set({ project: proj, activeStudyId: proj.studies[0]?.id ?? null, selection: {}, selectedLine: null, activeChartId: null });
  },

  loadDemo: () => {
    // Главная страница: синтетическая история скважины (если пуста); исследования — участки из неё.
    let p = ensureMain(get().project);
    let main = p.studies.find((s) => s.isMain);
    if (!main) return;
    if (main.columns.length === 0) {
      const h = demoHistory();
      main = autoRoles({ ...main, columns: h.pressure, rateColumns: h.rates, roles: {}, rateRoles: {} });
      const m = main;
      p = { ...p, studies: p.studies.map((s) => (s.isMain ? m : s)) };
    }
    const b = baseData(main, computeSheet(main));
    const rowsBetween = (h0: number, h1: number): number[] =>
      b.rows.filter((_, i) => (b.hist_s[i] ?? 0) >= h0 * 3600 && (b.hist_s[i] ?? 0) < h1 * 3600);
    const studies = [
      studyFromSelection(main, rowsBetween(200, 260), "КВД_1"),
      studyFromSelection(main, rowsBetween(260, 420), "КСД_1"),
      studyFromSelection(main, rowsBetween(420, 470), "КВД_2"),
    ];
    const charts: ChartDef[] = [];
    for (const s of studies) {
      charts.push(newChart("loglog", s.id, { name: `Диагностика ${s.name} (log-log)` }));
      charts.push(newChart("flex", s.id, { name: `Линейный поток: Δp от √t`, timeFn: "sqrt", yFn: "dp" }));
      charts.push(newChart("combo", s.id, { name: "История: давление и дебит" }));
    }
    const proj: Project = { ...p, studies: [...p.studies, ...studies], charts: [...p.charts, ...charts] };
    set({ project: proj, activeStudyId: main.id, view: "split", tablePart: "p" });
  },

  addStudy: (s, kinds) => {
    const study = autoRoles(normalizeRows(s));
    const charts = kinds.map((k) =>
      newChart(
        k,
        study.id,
        k === "flex"
          ? { name: "Линейный поток: Δp от √t" }
          : k === "loglog"
            ? { name: `Диагностика ${study.name} (log-log)` }
            : k === "rates"
              ? { name: "История дебитов" }
              : k === "combo"
                ? { name: "История: давление и дебит" }
                : {},
      ),
    );
    set((st) => ({
      project: { ...st.project, studies: [...st.project.studies, study], charts: [...st.project.charts, ...charts] },
      activeStudyId: study.id,
      view: st.view === "calc" ? "split" : st.view,
    }));
  },
  addBuilderStudy: (name) => {
    const study: Study = {
      id: uid(),
      name,
      isBuilder: true,
      columns: [],
      rateColumns: [],
      roles: {},
      rateRoles: {},
      testType: "buildup",
      tpSeconds: 0,
      rateBeforeM3s: 0,
    };
    set((st) => ({
      project: { ...st.project, studies: [...st.project.studies, study] },
      activeStudyId: study.id,
      view: "builder",
      activeChartId: null,
    }));
    return study.id;
  },
  builderAddData: (studyId, columns, chart) =>
    set((st) => {
      const exists = st.project.charts.some((c) => c.id === chart.id);
      const project = mapStudy(st.project, studyId, (s) => normalizeRows({ ...s, columns: [...s.columns, ...columns] }));
      return {
        project: exists ? mapChart(project, chart.id, () => chart) : { ...project, charts: [...project.charts, chart] },
        activeChartId: chart.id,
      };
    }),
  updateStudy: (id, patch) => set((st) => ({ project: mapStudy(st.project, id, (s) => ({ ...s, ...patch })) })),
  removeStudy: (id) =>
    set((st) => {
      const removed = st.project.studies.find((s) => s.id === id);
      if (!removed || removed.isMain) return {};
      const studies = st.project.studies.filter((s) => s.id !== id);
      // Следующая активная вкладка — того же вида (набор построителя или исследование).
      const next = studies.find((s) => Boolean(s.isBuilder) === Boolean(removed.isBuilder)) ?? (removed.isBuilder ? undefined : studies[0]);
      return {
        project: {
          ...st.project,
          studies,
          charts: st.project.charts.filter((c) => c.studyId !== id),
          groups: st.project.groups.map((g) => ({ ...g, studyIds: g.studyIds.filter((x) => x !== id) })),
        },
        activeStudyId: st.activeStudyId === id ? (next?.id ?? null) : st.activeStudyId,
      };
    }),
  replaceTable: (studyId, part, columns) =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => autoRoles(normalizeRows(part === "q" ? { ...s, rateColumns: columns, rateRoles: {} } : { ...s, columns, roles: {} }))),
    })),
  setCell: (studyId, col, row, value, part = "p") => get().setCells(studyId, [{ col, row, value }], part),
  setCells: (studyId, updates, part = "p") =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => {
        const columns = tableCols(s, part).map((c) => ({ ...c, cells: [...c.cells] }));
        for (const u of updates) {
          const c = columns[u.col];
          if (!c) continue;
          while (c.cells.length <= u.row) c.cells.push("");
          c.cells[u.row] = u.value;
        }
        return normalizeRows(withCols(s, part, columns));
      }),
    })),
  addColumn: (studyId, col, index, part = "p") =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => {
        const cols = tableCols(s, part);
        const n = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
        const c: Column = {
          id: uid(),
          name: col.name ?? `Столбец ${cols.length + 1}`,
          quantity: col.quantity ?? "other",
          unit: col.unit ?? "-",
          cells: col.cells ?? new Array<string>(Math.max(n, part === "q" ? 10 : 0)).fill(""),
          formula: col.formula,
        };
        const columns = [...cols];
        columns.splice(index ?? columns.length, 0, c);
        return normalizeRows(withCols(s, part, columns));
      }),
    })),
  updateColumn: (studyId, columnId, patch, part = "p") =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) =>
        withCols(s, part, tableCols(s, part).map((c) => (c.id === columnId ? { ...c, ...patch } : c))),
      ),
    })),
  removeColumn: (studyId, columnId, part = "p") =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => {
        const roles = { ...s.roles };
        (Object.keys(roles) as (keyof typeof roles)[]).forEach((k) => {
          if (roles[k] === columnId) delete roles[k];
        });
        const rateRoles = { ...s.rateRoles };
        (Object.keys(rateRoles) as (keyof typeof rateRoles)[]).forEach((k) => {
          if (rateRoles[k] === columnId) delete rateRoles[k];
        });
        return withCols({ ...s, roles, rateRoles }, part, tableCols(s, part).filter((c) => c.id !== columnId));
      }),
    })),
  insertRow: (studyId, row, part = "p") =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) =>
        withCols(
          s,
          part,
          tableCols(s, part).map((c) => {
            const cells = [...c.cells];
            cells.splice(row, 0, "");
            return { ...c, cells };
          }),
        ),
      ),
    })),

  setSelection: (studyId, rows) =>
    set((st) => ({ selection: { ...st.selection, [studyId]: [...new Set(rows)].sort((a, b) => a - b) } })),

  addChart: (c) =>
    set((st) => ({ project: { ...st.project, charts: [...st.project.charts, c] }, activeChartId: c.id })),
  updateChart: (id, patch) => set((st) => ({ project: mapChart(st.project, id, (c) => ({ ...c, ...patch })) })),
  removeChart: (id) =>
    set((st) => ({
      project: { ...st.project, charts: st.project.charts.filter((c) => c.id !== id) },
      activeChartId: st.activeChartId === id ? null : st.activeChartId,
    })),
  addLine: (chartId, line) =>
    set((st) => ({
      project: mapChart(st.project, chartId, (c) => ({ ...c, lines: [...c.lines, line] })),
      selectedLine: { chartId, lineId: line.id },
    })),
  updateLine: (chartId, lineId, patch) =>
    set((st) => ({
      project: mapChart(st.project, chartId, (c) => ({
        ...c,
        lines: c.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
      })),
    })),
  removeLine: (chartId, lineId) =>
    set((st) => ({
      project: mapChart(st.project, chartId, (c) => ({ ...c, lines: c.lines.filter((l) => l.id !== lineId) })),
      selectedLine: st.selectedLine?.lineId === lineId ? null : st.selectedLine,
    })),
  selectLine: (sel, info) => set((st) => ({ selectedLine: sel, showLineInfo: info ?? (sel ? st.showLineInfo : false) })),

  updateCalc: (patch) => set((st) => ({ project: { ...st.project, calc: { ...st.project.calc, ...patch } } })),
  addGroup: (name, studyIds) =>
    set((st) => ({ project: { ...st.project, groups: [...st.project.groups, { id: uid(), name, studyIds }] } })),
  removeGroup: (id) =>
    set((st) => ({ project: { ...st.project, groups: st.project.groups.filter((g) => g.id !== id) } })),
}));

useApp.subscribe((st, prev) => {
  if (st.project !== prev.project) saveProjectDebounced(st.project);
});

export { emptyProject };
