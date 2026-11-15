/**
 * Построение серий точек для графика.
 *
 * Схема:
 *   ChartDef + Study + Sheet ──buildChartData()──► ChartData { series[], xLabel, yLabel }
 *     loglog  : Δt — Δp и производная Бурде (опц. наложение других исследований)
 *     semilog : функция суперпозиции log — давление
 *     history : время от начала записи — давление
 *     rates   : история дебитов (ступенчатый график) из таблицы дебитов
 *     combo   : не строится здесь — ChartHost собирает его из history (сверху) и rates (снизу)
 *     flex    : f(Δt) с суперпозицией — P или Δp (опц. нормировка на дебит)
 *     columns : столбец X — столбцы Y (как есть, в единицах столбцов)
 *
 * Значения серий — в единицах отображения (ч, атм, м³/сут), каждая точка помнит строку таблицы.
 */
import type { ChartDef, Marker, Project, Study, TimeFn } from "../core/types";
import { computeSheet, type Sheet } from "../core/sheet";
import {
  baseData,
  bourdetDerivative,
  deltaP,
  lastRateStep,
  producingTime,
  rateTable,
  lnSuperposition,
  rateEvents,
  superposedTime,
} from "../core/welltest";
import { fromSI, unitLabel, dimensionOfQuantity } from "../core/units";

export interface SeriesPoint {
  x: number;
  y: number;
  row: number;
}

export interface Series {
  key: string;
  name: string;
  color: string;
  marker: Marker;
  studyId: string;
  points: SeriesPoint[];
}

export interface ChartData {
  series: Series[];
  xLabel: string;
  yLabel: string;
  /** Подсказка, если данных нет. */
  warning?: string;
}

export const COLORS = {
  dp: "#4ADE80",
  deriv: "#F87171",
  history: "#38BDF8",
  overlay: ["#60A5FA", "#FBBF24", "#C084FC", "#F472B6", "#2DD4BF", "#FB923C"],
};

const sheetCache = new WeakMap<Study, Sheet>();

/**
 * Вычисленная таблица исследования (кэшируется по объекту исследования).
 * @param study исследование
 * @returns Sheet
 */
export function sheetOf(study: Study): Sheet {
  let s = sheetCache.get(study);
  if (!s) {
    s = computeSheet(study);
    sheetCache.set(study, s);
  }
  return s;
}

const TIME_LABEL: Record<TimeFn, string> = {
  dt: "Δt, ч",
  log: "lg(Δt)",
  sqrt: "√Δt, ч^0.5",
  qrt: "⁴√Δt, ч^0.25",
  invsqrt: "1/√Δt, ч^-0.5",
};

const ATM_PER_M3D = "атм/(м³/сут)";

/**
 * Перевести перепад давления (Па) в единицы отображения, с нормировкой на дебит или без.
 * @param dp_Pa давление/перепад, Па
 * @param dq_m3_s скачок дебита, м³/с (или NaN — без нормировки)
 * @returns значение в атм или атм/(м³/сут)
 */
function pressureOut(dp_Pa: number, dq_m3_s: number): number {
  const p = fromSI(dp_Pa, "pressure", "atm");
  return Number.isFinite(dq_m3_s) ? p / fromSI(dq_m3_s, "rate", "m3/d") : p;
}

/**
 * Серии Δp и производной для одного исследования.
 * @param chart график
 * @param study исследование
 * @param colors цвета Δp и производной
 * @param suffix подпись в легенде
 * @returns две серии
 */
function loglogSeries(chart: ChartDef, study: Study, colors: [string, string], suffix: string): Series[] {
  const sheet = sheetOf(study);
  const b = baseData(study, sheet, chart.studyId === study.id ? chart.rows : undefined);
  const dp = deltaP(study, b);
  const ev = rateEvents(study, b);
  const tp = producingTime(study, ev, b);
  const dq = chart.normalizeByRate ? lastRateStep(ev) : Number.NaN;
  const rowsAllowed = chart.rows && chart.studyId === study.id ? new Set(chart.rows) : null;
  const xs: number[] = [];
  const ys: number[] = [];
  const rows: number[] = [];
  const xPlot: number[] = [];
  b.dt_s.forEach((t, i) => {
    const row = b.rows[i] ?? -1;
    if (t <= 0 || (rowsAllowed && !rowsAllowed.has(row))) return;
    xs.push(lnSuperposition(chart.superposition, t, tp, ev));
    ys.push(dp[i] ?? Number.NaN);
    rows.push(row);
    const te = chart.superposition === "agarwal" && tp > 0 ? (tp * t) / (tp + t) : t;
    xPlot.push(te / 3600);
  });
  // Производная считается по возрастанию аргумента суперпозиции.
  const order = xs.map((_, i) => i).sort((a, c) => (xs[a] ?? 0) - (xs[c] ?? 0));
  const xsS = order.map((i) => xs[i] ?? Number.NaN);
  const ysS = order.map((i) => ys[i] ?? Number.NaN);
  const dS = bourdetDerivative(xsS, ysS, chart.derivL);
  const deriv = new Array<number>(xs.length).fill(Number.NaN);
  order.forEach((orig, k) => (deriv[orig] = dS[k] ?? Number.NaN));
  const mk = (vals: number[]): SeriesPoint[] =>
    vals
      .map((v, i) => ({ x: xPlot[i] ?? Number.NaN, y: pressureOut(v, dq), row: rows[i] ?? -1 }))
      .filter((p) => p.x > 0 && p.y > 0 && Number.isFinite(p.y));
  return [
    { key: `dp:${study.id}`, name: `Δp${suffix}`, color: colors[0], marker: "cross", studyId: study.id, points: mk(ys) },
    { key: `der:${study.id}`, name: `Δp′${suffix}`, color: colors[1], marker: "circle", studyId: study.id, points: mk(deriv) },
  ];
}

/**
 * Данные для отрисовки графика.
 * @param chart описание графика
 * @param project проект (исследования)
 * @returns серии и подписи осей
 */
export function buildChartData(chart: ChartDef, project: Project): ChartData {
  return applySeriesStyle(chart, buildChartDataUnstyled(chart, project));
}

/**
 * Применить настройки серий графика: скрытие, цвет, маркер.
 * @param chart график (seriesStyle)
 * @param data данные графика
 * @returns данные с изменёнными сериями
 */
function applySeriesStyle(chart: ChartDef, data: ChartData): ChartData {
  const st = chart.seriesStyle;
  if (!st) return data;
  return {
    ...data,
    series: data.series
      .filter((s) => !st[s.key]?.hidden)
      .map((s) => {
        const o = st[s.key];
        return o ? { ...s, color: o.color ?? s.color, marker: o.marker ?? s.marker } : s;
      }),
  };
}

/** Все серии графика без учёта скрытия (для окна «Вид точек»). */
export function buildChartDataAllSeries(chart: ChartDef, project: Project): ChartData {
  return buildChartDataUnstyled(chart, project);
}

function buildChartDataUnstyled(chart: ChartDef, project: Project): ChartData {
  const data = buildChartDataRaw(chart, project);
  if (data.warning || chart.kind === "columns" || chart.kind === "rates" || chart.kind === "combo") return data;
  // Пустой график — объяснить почему, а не показывать пустоту.
  const ok = (v: number, log: boolean): boolean => Number.isFinite(v) && (!log || v > 0);
  const visible = data.series.some((s) => s.studyId === chart.studyId && s.points.some((p) => ok(p.x, chart.xLog) && ok(p.y, chart.yLog)));
  if (visible) return data;
  const study = project.studies.find((s) => s.id === chart.studyId);
  return study ? { ...data, warning: diagnoseEmpty(chart, study) } : data;
}

/**
 * Причина, по которой на графике нет точек.
 * @param chart график
 * @param study исследование
 * @returns текст подсказки
 */
function diagnoseEmpty(chart: ChartDef, study: Study): string {
  const b = baseData(study, sheetOf(study), chart.rows);
  const allowed = chart.rows ? new Set(chart.rows) : null;
  const idx = b.rows.map((r, i) => (allowed && !allowed.has(r) ? -1 : i)).filter((i) => i >= 0);
  if (idx.length === 0) return "В выбранных строках нет времени и давления";
  const after = idx.filter((i) => (b.dt_s[i] ?? 0) > 0);
  if (after.length === 0) {
    return `Все точки до начала периода (Δt ≤ 0). Период начинается с последнего изменения дебита — ${fmtH(b.tStart_s)} ч от начала записи. Выделите точки после него или проверьте таблицу дебитов`;
  }
  const dp = deltaP(study, b);
  const needDp = chart.kind === "loglog" || chart.yFn === "dp";
  if (needDp && (chart.kind === "loglog" || chart.yLog) && after.every((i) => (dp[i] ?? 0) <= 0)) {
    return "Δp ≤ 0 у всех точек — тип периода (КВД/КСД) не совпадает с данными. Проверьте ⚙ настройки исследования или таблицу дебитов";
  }
  if (chart.xLog || chart.yLog) return "Нет точек с положительными значениями для логарифмической оси — переключите шкалу на линейную";
  return "Нет точек для выбранной функции времени и суперпозиции (проверьте tp и таблицу дебитов)";
}

const fmtH = (s: number): string => String(Number((s / 3600).toPrecision(5))).replace(".", ",");

function buildChartDataRaw(chart: ChartDef, project: Project): ChartData {
  const study = project.studies.find((s) => s.id === chart.studyId);
  if (!study) return { series: [], xLabel: "", yLabel: "", warning: "Исследование удалено" };
  const sheet = sheetOf(study);
  const rowsAllowed = chart.rows ? new Set(chart.rows) : null;
  const pLabel = (dp: boolean, norm: boolean): string =>
    `${dp ? "Δp" : "P"}${norm ? `/Δq, ${ATM_PER_M3D}` : ", атм"}`;

  if (chart.kind === "columns") {
    const ci = study.columns.findIndex((c) => c.id === chart.xColumn);
    const xc = study.columns[ci];
    if (!xc) return { series: [], xLabel: "", yLabel: "", warning: "Выберите столбец X" };
    const xvMain = sheet.numeric(xc.id);
    const series: Series[] = (chart.yColumns ?? []).flatMap((yc, k) => {
      const col = study.columns.find((c) => c.id === yc.columnId);
      if (!col) return [];
      const yv = sheet.numeric(col.id);
      // У серии может быть свой столбец X (наложение выгрузок).
      const xv = yc.xColumnId && study.columns.some((c) => c.id === yc.xColumnId) ? sheet.numeric(yc.xColumnId) : xvMain;
      const pts: SeriesPoint[] = [];
      for (let r = 0; r < sheet.rowCount; r++) {
        if (rowsAllowed && !rowsAllowed.has(r)) continue;
        const x = xv[r] ?? Number.NaN;
        const y = yv[r] ?? Number.NaN;
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y, row: r });
      }
      return [{ key: `col:${col.id}:${k}`, name: col.name, color: yc.color, marker: yc.marker, studyId: study.id, points: pts }];
    });
    const unitOf = (c: { quantity: string; unit: string }): string => {
      const l = unitLabel(dimensionOfQuantity(c.quantity), c.unit);
      return l === "—" ? "" : `, ${l}`;
    };
    const firstY = study.columns.find((c) => c.id === chart.yColumns?.[0]?.columnId);
    return {
      series,
      xLabel: `${xc.name}${unitOf(xc)}`,
      yLabel: firstY ? `${firstY.name}${unitOf(firstY)}` : "",
    };
  }

  // Для графика по выделенным точкам период выбирается по этим точкам.
  const b = baseData(study, sheet, chart.rows);

  if (chart.kind === "rates") {
    // Ступенчатый график режимов; шкала времени — от первой строки давления (или первого режима).
    const rt = rateTable(study);
    if (!rt) return { series: [], xLabel: "", yLabel: "", warning: "Таблица дебитов пуста — загрузите дебиты" };
    const rel = b.rates ?? rt.rows.map((r) => ({ t_s: r.tAbs_s - (rt.rows[0]?.tAbs_s ?? 0), q_m3_s: r.q_m3_s }));
    const pts: SeriesPoint[] = rel.map((r, i) => ({ x: r.t_s / 3600, y: fromSI(r.q_m3_s, "rate", "m3/d"), row: i }));
    const lastP = b.hist_s[b.hist_s.length - 1] ?? 0;
    const lastR = rel[rel.length - 1];
    if (lastR) pts.push({ x: Math.max(lastP, lastR.t_s) / 3600 + 1e-9, y: fromSI(lastR.q_m3_s, "rate", "m3/d"), row: -1 });
    return {
      series: [{ key: `q:${study.id}`, name: "q", color: "#FB923C", marker: "step", studyId: `${study.id}:q`, points: pts }],
      xLabel: b.rows.length > 0 ? "Время от начала записи давления, ч" : "Время от первого режима, ч",
      yLabel: "q, м³/сут",
      warning: b.warning,
    };
  }

  if (b.rows.length === 0) {
    return { series: [], xLabel: "", yLabel: "", warning: "Назначьте столбцы времени и давления (меню исследования)" };
  }

  if (chart.kind === "loglog") {
    const series = loglogSeries(chart, study, [COLORS.dp, COLORS.deriv], "");
    (chart.overlayStudyIds ?? []).forEach((id, k) => {
      const other = project.studies.find((s) => s.id === id);
      if (!other || other.id === study.id) return;
      const c = COLORS.overlay[k % COLORS.overlay.length] ?? "#FFFFFF";
      series.push(...loglogSeries(chart, other, [c, c], ` ${other.name}`));
    });
    const xl = chart.superposition === "agarwal" ? "te (Агарвал), ч" : "Δt, ч";
    return { series, xLabel: xl, yLabel: chart.normalizeByRate ? `Δp и Δp′ /Δq, ${ATM_PER_M3D}` : "Δp и Δp′, атм" };
  }

  if (chart.kind === "history") {
    const pts: SeriesPoint[] = [];
    b.hist_s.forEach((t, i) => {
      const row = b.rows[i] ?? -1;
      if (rowsAllowed && !rowsAllowed.has(row)) return;
      pts.push({ x: t / 3600, y: fromSI(b.p_Pa[i] ?? Number.NaN, "pressure", "atm"), row });
    });
    return {
      series: [{ key: `p:${study.id}`, name: "P", color: COLORS.history, marker: "dot", studyId: study.id, points: pts }],
      xLabel: "Время от начала записи, ч",
      yLabel: "P, атм",
      warning: b.warning,
    };
  }

  // semilog и flex
  const ev = rateEvents(study, b);
  const tp = producingTime(study, ev, b);
  const fn: TimeFn = chart.kind === "semilog" ? "log" : chart.timeFn;
  const useDp = chart.yFn === "dp";
  const dp = deltaP(study, b);
  const dq = chart.normalizeByRate ? lastRateStep(ev) : Number.NaN;
  const pts: SeriesPoint[] = [];
  b.dt_s.forEach((t, i) => {
    const row = b.rows[i] ?? -1;
    if (rowsAllowed && !rowsAllowed.has(row)) return;
    const x = superposedTime(fn, chart.superposition, t, tp, ev);
    const yPa = useDp ? (dp[i] ?? Number.NaN) : (b.p_Pa[i] ?? Number.NaN);
    const y = pressureOut(yPa, dq);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y, row });
  });
  const supName: Record<string, string> = { none: "", buildup: " (КВД-суперпозиция)", multirate: " (мультирежим)", agarwal: " (Агарвал)" };
  return {
    series: [{ key: `f:${study.id}`, name: useDp ? "Δp" : "P", color: COLORS.dp, marker: "cross", studyId: study.id, points: pts }],
    xLabel: `${TIME_LABEL[fn]}${supName[chart.superposition] ?? ""}`,
    yLabel: pLabel(useDp, chart.normalizeByRate),
  };
}

/**
 * Моменты смены режима (часы в шкале «время от начала записи давления») — для вертикальных линий
 * на графиках истории. Если давления нет — от первого режима.
 * @param study исследование
 * @returns времена изменения дебита, ч
 */
export function rateChangeHours(study: Study): number[] {
  const rt = rateTable(study);
  if (!rt) return [];
  const b = baseData(study, sheetOf(study));
  const rel = b.rates ?? rt.rows.map((r) => ({ t_s: r.tAbs_s - (rt.rows[0]?.tAbs_s ?? 0), q_m3_s: r.q_m3_s }));
  const out: number[] = [];
  let prev = Number.NaN;
  for (const r of rel) {
    if (!Number.isFinite(prev) || Math.abs(r.q_m3_s - prev) > 1e-12 * Math.max(1, Math.abs(prev))) out.push(r.t_s / 3600);
    prev = r.q_m3_s;
  }
  return out;
}
