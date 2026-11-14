/**
 * Линии тренда по выделенным точкам и характеристики прямых.
 *
 * Схема:
 *   makeTrend(chart, data, seriesKey, rows, fit, …) → Partial<LineDef> (p1/p2 для прямой в осях + trend)
 *   lineStats(line, chart, data, selectedRows)    → уравнение, наклон, угол на экране, R²
 */
import type { ChartDef, FitType, LineDef } from "../core/types";
import { axisLineEquation, fitTrend, trendEquation, type XY } from "../core/regression";
import type { ChartData } from "./series";
import { lastFrames, toAxis } from "./geometry";

/**
 * Точки серии в выбранных строках.
 * @param data данные графика
 * @param seriesKey ключ серии
 * @param rows строки
 * @returns точки (x, y) в данных
 */
export function pointsOf(data: ChartData, seriesKey: string, rows: Set<number>): XY[] {
  const s = data.series.find((x) => x.key === seriesKey);
  return s ? s.points.filter((p) => rows.has(p.row)).map((p) => ({ x: p.x, y: p.y })) : [];
}

/**
 * Построить линию тренда.
 * @param chart график (оси)
 * @param data данные графика
 * @param seriesKey серия
 * @param rows выбранные строки
 * @param fit тип аппроксимации
 * @param degree степень полинома
 * @param fixedSlope фиксированный наклон (для axis/linear/power)
 * @returns поля прямой или строка с ошибкой
 */
export function makeTrend(
  chart: ChartDef,
  data: ChartData,
  seriesKey: string,
  rows: number[],
  fit: FitType,
  degree: number,
  fixedSlope?: number,
): Partial<LineDef> | string {
  const pts = pointsOf(data, seriesKey, new Set(rows));
  const t = fitTrend(pts, fit, { xLog: chart.xLog, yLog: chart.yLog, degree, fixedSlope });
  if (!t) return "Недостаточно подходящих точек для аппроксимации";
  const trend = { fit, degree, fixedSlope, seriesKey, rows, coeffs: t.coeffs, r2: t.r2 };
  if (fit !== "axis") return { trend, p1: undefined, p2: undefined };
  const a = t.coeffs[0] ?? 0;
  const b = t.coeffs[1] ?? 0;
  const xs = pts.map((p) => toAxis(p.x, chart.xLog)).filter(Number.isFinite);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  return { trend, p1: { x: x0, y: a * x0 + b }, p2: { x: x1, y: a * x1 + b } };
}

export interface LineStats {
  equation: string;
  /** Наклон в координатах осей (на log-log — показатель степени). */
  slope: number | null;
  intercept: number | null;
  angleDeg: number | null;
  r2: number | null;
  points: number;
}

/**
 * Характеристики прямой.
 * @param l прямая
 * @param chart график
 * @param data данные графика
 * @param selected выделенные строки (для R² ручной прямой)
 * @returns уравнение, наклон, угол, R²
 */
export function lineStats(l: LineDef, chart: ChartDef, data: ChartData, selected: Set<number>): LineStats {
  if (l.trend && l.trend.fit !== "axis") {
    const t = { fit: l.trend.fit, coeffs: l.trend.coeffs, r2: l.trend.r2, xLog: chart.xLog, yLog: chart.yLog };
    return { equation: trendEquation(t), slope: null, intercept: null, angleDeg: null, r2: l.trend.r2, points: l.trend.rows.length };
  }
  if (!l.p1 || !l.p2) return { equation: "—", slope: null, intercept: null, angleDeg: null, r2: null, points: 0 };
  const dx = l.p2.x - l.p1.x;
  const a = dx === 0 ? Number.POSITIVE_INFINITY : (l.p2.y - l.p1.y) / dx;
  const b = l.p1.y - a * l.p1.x;
  const f = lastFrames.get(chart.id);
  let angle: number | null = null;
  if (f) {
    const sx = f.px(l.p2.x) - f.px(l.p1.x);
    const sy = f.py(l.p1.y) - f.py(l.p2.y);
    angle = (Math.atan2(sy, sx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
  }
  let r2: number | null = l.trend ? l.trend.r2 : null;
  let points = l.trend ? l.trend.rows.length : 0;
  if (!l.trend && selected.size > 1 && Number.isFinite(a)) {
    // R² выделенных точек относительно этой прямой (по первой серии с выделенными точками).
    const s = data.series.find((x) => x.studyId === chart.studyId && x.points.some((p) => selected.has(p.row)));
    if (s) {
      const pts = s.points
        .filter((p) => selected.has(p.row))
        .map((p) => ({ x: toAxis(p.x, chart.xLog), y: toAxis(p.y, chart.yLog) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length > 1) {
        const m = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;
        let ssr = 0;
        let sst = 0;
        for (const p of pts) {
          ssr += (p.y - (a * p.x + b)) ** 2;
          sst += (p.y - m) ** 2;
        }
        r2 = sst === 0 ? null : 1 - ssr / sst;
        points = pts.length;
      }
    }
  }
  return {
    equation: Number.isFinite(a) ? axisLineEquation(a, b, chart.xLog, chart.yLog) : `x = ${l.p1.x}`,
    slope: Number.isFinite(a) ? a : null,
    intercept: Number.isFinite(a) ? b : null,
    angleDeg: angle,
    r2,
    points,
  };
}
