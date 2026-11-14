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
import type { CalcState, ChartDef, Column, LineDef, Project, Study } from "./core/types";
import { autoRoles, demoStudy, emptyProject, newChart, uid } from "./core/factory";
import { loadProject, saveProjectDebounced } from "./persist";

export type Tool = "pan" | "zoom" | "rect" | "lasso" | "click" | "line2" | "pickline" | "info" | "editline";
export type ViewMode = "split" | "charts" | "calc";

export type Dialog =
  | { kind: "import"; studyId?: string }
  | { kind: "flex"; rows?: number[] }
  | { kind: "columnsChart" }
  | { kind: "newColumn"; formula: boolean }
  | { kind: "columnProps"; columnId: string }
  | { kind: "chartSettings"; chartId: string }
  | { kind: "trend"; chartId: string }
  | { kind: "study"; studyId: string }
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
  updateStudy(id: string, patch: Partial<Study>): void;
  removeStudy(id: string): void;
  setCell(studyId: string, col: number, row: number, value: string): void;
  setCells(studyId: string, updates: { col: number; row: number; value: string }[]): void;
  addColumn(studyId: string, col: Partial<Column>, index?: number): void;
  updateColumn(studyId: string, columnId: string, patch: Partial<Column>): void;
  removeColumn(studyId: string, columnId: string): void;
  insertRow(studyId: string, row: number): void;

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

/** Выровнять длину всех столбцов исследования. */
function normalizeRows(s: Study): Study {
  const n = s.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
  return {
    ...s,
    columns: s.columns.map((c) =>
      c.cells.length === n ? c : { ...c, cells: [...c.cells, ...new Array<string>(n - c.cells.length).fill("")] },
    ),
  };
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

  setView: (view) => set({ view }),
  setTool: (tool) => set({ tool }),
  setMulti: (multiSelect) => set({ multiSelect }),
  setDialog: (dialog) => set({ dialog }),
  setActiveStudy: (id) => set({ activeStudyId: id, view: get().view === "calc" ? "split" : get().view }),
  setActiveChart: (id) => set({ activeChartId: id }),
  setChartsFilter: (chartsFilter) => set({ chartsFilter }),

  replaceProject: (p) =>
    set({ project: p, activeStudyId: p.studies[0]?.id ?? null, selection: {}, selectedLine: null, activeChartId: null }),

  loadDemo: () => {
    const studies = [demoStudy("КВД_1", 1.3, 0.6), demoStudy("КВД_2"), demoStudy("КСД_1", 0.7, 1.8, "drawdown")].map(autoRoles);
    const charts: ChartDef[] = [];
    for (const s of studies) {
      charts.push(newChart("loglog", s.id, { name: `Диагностика ${s.name} (log-log)` }));
      charts.push(newChart("flex", s.id, { name: `Линейный поток: Δp от √t`, timeFn: "sqrt", yFn: "dp" }));
      charts.push(newChart("history", s.id, { name: "История давления" }));
    }
    const p = get().project;
    const proj: Project = { ...p, studies: [...p.studies, ...studies], charts: [...p.charts, ...charts] };
    set({ project: proj, activeStudyId: studies[0]?.id ?? null, view: "split" });
  },

  addStudy: (s, kinds) => {
    const study = autoRoles(normalizeRows(s));
    const charts = kinds.map((k) =>
      newChart(k, study.id, k === "flex" ? { name: "Линейный поток: Δp от √t" } : k === "loglog" ? { name: `Диагностика ${study.name} (log-log)` } : {}),
    );
    set((st) => ({
      project: { ...st.project, studies: [...st.project.studies, study], charts: [...st.project.charts, ...charts] },
      activeStudyId: study.id,
      view: st.view === "calc" ? "split" : st.view,
    }));
  },
  updateStudy: (id, patch) => set((st) => ({ project: mapStudy(st.project, id, (s) => ({ ...s, ...patch })) })),
  removeStudy: (id) =>
    set((st) => {
      const studies = st.project.studies.filter((s) => s.id !== id);
      return {
        project: {
          ...st.project,
          studies,
          charts: st.project.charts.filter((c) => c.studyId !== id),
          groups: st.project.groups.map((g) => ({ ...g, studyIds: g.studyIds.filter((x) => x !== id) })),
        },
        activeStudyId: st.activeStudyId === id ? (studies[0]?.id ?? null) : st.activeStudyId,
      };
    }),
  setCell: (studyId, col, row, value) => get().setCells(studyId, [{ col, row, value }]),
  setCells: (studyId, updates) =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => {
        const columns = s.columns.map((c) => ({ ...c, cells: [...c.cells] }));
        for (const u of updates) {
          const c = columns[u.col];
          if (!c) continue;
          while (c.cells.length <= u.row) c.cells.push("");
          c.cells[u.row] = u.value;
        }
        return normalizeRows({ ...s, columns });
      }),
    })),
  addColumn: (studyId, col, index) =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => {
        const n = s.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
        const c: Column = {
          id: uid(),
          name: col.name ?? `Столбец ${s.columns.length + 1}`,
          quantity: col.quantity ?? "other",
          unit: col.unit ?? "-",
          cells: col.cells ?? new Array<string>(n).fill(""),
          formula: col.formula,
        };
        const columns = [...s.columns];
        columns.splice(index ?? columns.length, 0, c);
        return normalizeRows({ ...s, columns });
      }),
    })),
  updateColumn: (studyId, columnId, patch) =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => ({
        ...s,
        columns: s.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)),
      })),
    })),
  removeColumn: (studyId, columnId) =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => {
        const roles = { ...s.roles };
        (Object.keys(roles) as (keyof typeof roles)[]).forEach((k) => {
          if (roles[k] === columnId) delete roles[k];
        });
        return { ...s, roles, columns: s.columns.filter((c) => c.id !== columnId) };
      }),
    })),
  insertRow: (studyId, row) =>
    set((st) => ({
      project: mapStudy(st.project, studyId, (s) => ({
        ...s,
        columns: s.columns.map((c) => {
          const cells = [...c.cells];
          cells.splice(row, 0, "");
          return { ...c, cells };
        }),
      })),
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
