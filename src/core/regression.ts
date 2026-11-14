/**
 * Аппроксимация точек (линии тренда).
 *
 * Схема: fitTrend(points, fit, opts) → Trend { coeffs, r2 }
 *        evalTrend(trend, x)         → y
 *        trendEquation(trend)        → строка уравнения
 *
 * Типы:
 *   axis   — прямая в координатах осей: Y' = a·X' + b, где X' = log10(x) для лог-оси (coeffs [a, b])
 *   linear — y = a·x + b                       (coeffs [a, b])
 *   power  — y = c·x^n                         (coeffs [c, n])
 *   log    — y = a·ln(x) + b                   (coeffs [a, b])
 *   exp    — y = c·e^(k·x)                     (coeffs [c, k])
 *   poly   — y = a0 + a1·x + … + ad·x^d        (coeffs [a0 … ad])
 */
import type { FitType } from "./types";

export interface XY {
  x: number;
  y: number;
}

export interface TrendFit {
  fit: FitType;
  coeffs: number[];
  r2: number;
  xLog: boolean;
  yLog: boolean;
}

/**
 * Линейная регрессия Y = a·X + b (с возможной фиксацией наклона).
 * @param pts точки
 * @param fixedSlope фиксированный наклон или undefined
 * @returns [a, b]
 */
function linreg(pts: XY[], fixedSlope?: number): [number, number] {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  if (fixedSlope !== undefined) return [fixedSlope, my - fixedSlope * mx];
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const a = sxx === 0 ? 0 : sxy / sxx;
  return [a, my - a * mx];
}

/**
 * Решить систему линейных уравнений методом Гаусса.
 * @param A матрица n×n
 * @param b правая часть
 * @returns решение или null для вырожденной системы
 */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]?.[c] ?? 0) > Math.abs(M[piv]?.[c] ?? 0)) piv = r;
    const pr = M[piv];
    const cr = M[c];
    if (!pr || !cr || Math.abs(pr[c] ?? 0) < 1e-300) return null;
    M[piv] = cr;
    M[c] = pr;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const row = M[r];
      if (!row) continue;
      const f = (row[c] ?? 0) / (pr[c] ?? 1);
      for (let k = c; k <= n; k++) row[k] = (row[k] ?? 0) - f * (pr[k] ?? 0);
    }
  }
  return M.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

/**
 * Коэффициент детерминации R².
 * @param ys фактические значения
 * @param fs расчётные значения
 * @returns R² (1 — идеально)
 */
function rSquared(ys: number[], fs: number[]): number {
  const m = ys.reduce((s, y) => s + y, 0) / ys.length;
  let ssr = 0;
  let sst = 0;
  ys.forEach((y, i) => {
    ssr += (y - (fs[i] ?? 0)) ** 2;
    sst += (y - m) ** 2;
  });
  return sst === 0 ? 1 : 1 - ssr / sst;
}

const lg = (v: number, on: boolean): number => (on ? Math.log10(v) : v);

/**
 * Построить тренд по точкам.
 * @param points точки в данных (не в лог-координатах)
 * @param fit тип аппроксимации
 * @param opts оси графика, степень полинома, фиксированный наклон
 * @returns тренд или null (мало точек, неподходящие значения)
 */
export function fitTrend(
  points: XY[],
  fit: FitType,
  opts: { xLog: boolean; yLog: boolean; degree?: number; fixedSlope?: number },
): TrendFit | null {
  const { xLog, yLog } = opts;
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const need = fit === "poly" ? (opts.degree ?? 2) + 1 : opts.fixedSlope !== undefined ? 1 : 2;
  const base = { fit, xLog, yLog };
  switch (fit) {
    case "axis": {
      const pts = finite
        .filter((p) => (!xLog || p.x > 0) && (!yLog || p.y > 0))
        .map((p) => ({ x: lg(p.x, xLog), y: lg(p.y, yLog) }));
      if (pts.length < need) return null;
      const [a, b] = linreg(pts, opts.fixedSlope);
      return { ...base, coeffs: [a, b], r2: rSquared(pts.map((p) => p.y), pts.map((p) => a * p.x + b)) };
    }
    case "linear": {
      if (finite.length < need) return null;
      const [a, b] = linreg(finite, opts.fixedSlope);
      return { ...base, coeffs: [a, b], r2: rSquared(finite.map((p) => p.y), finite.map((p) => a * p.x + b)) };
    }
    case "power": {
      const pts = finite.filter((p) => p.x > 0 && p.y > 0);
      if (pts.length < need) return null;
      const [n, lnc] = linreg(pts.map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) })), opts.fixedSlope);
      const c = Math.exp(lnc);
      return { ...base, coeffs: [c, n], r2: rSquared(pts.map((p) => p.y), pts.map((p) => c * p.x ** n)) };
    }
    case "log": {
      const pts = finite.filter((p) => p.x > 0);
      if (pts.length < need) return null;
      const [a, b] = linreg(pts.map((p) => ({ x: Math.log(p.x), y: p.y })));
      return { ...base, coeffs: [a, b], r2: rSquared(pts.map((p) => p.y), pts.map((p) => a * Math.log(p.x) + b)) };
    }
    case "exp": {
      const pts = finite.filter((p) => p.y > 0);
      if (pts.length < need) return null;
      const [k, lnc] = linreg(pts.map((p) => ({ x: p.x, y: Math.log(p.y) })));
      const c = Math.exp(lnc);
      return { ...base, coeffs: [c, k], r2: rSquared(pts.map((p) => p.y), pts.map((p) => c * Math.exp(k * p.x))) };
    }
    case "poly": {
      const d = Math.max(1, Math.min(6, opts.degree ?? 2));
      if (finite.length < d + 1) return null;
      const A: number[][] = Array.from({ length: d + 1 }, () => new Array<number>(d + 1).fill(0));
      const bv = new Array<number>(d + 1).fill(0);
      for (const p of finite) {
        for (let i = 0; i <= d; i++) {
          bv[i] = (bv[i] ?? 0) + p.y * p.x ** i;
          const row = A[i];
          if (!row) continue;
          for (let j = 0; j <= d; j++) row[j] = (row[j] ?? 0) + p.x ** (i + j);
        }
      }
      const c = solve(A, bv);
      if (!c) return null;
      const f = (x: number): number => c.reduce((s, ci, i) => s + ci * x ** i, 0);
      return { ...base, coeffs: c, r2: rSquared(finite.map((p) => p.y), finite.map((p) => f(p.x))) };
    }
  }
}

/**
 * Значение тренда в точке.
 * @param t тренд
 * @param x абсцисса в данных
 * @returns ордината в данных (NaN вне области определения)
 */
export function evalTrend(t: TrendFit, x: number): number {
  const c = t.coeffs;
  const c0 = c[0] ?? 0;
  const c1 = c[1] ?? 0;
  switch (t.fit) {
    case "axis": {
      if (t.xLog && x <= 0) return Number.NaN;
      const Y = c0 * lg(x, t.xLog) + c1;
      return t.yLog ? 10 ** Y : Y;
    }
    case "linear":
      return c0 * x + c1;
    case "power":
      return x > 0 ? c0 * x ** c1 : Number.NaN;
    case "log":
      return x > 0 ? c0 * Math.log(x) + c1 : Number.NaN;
    case "exp":
      return c0 * Math.exp(c1 * x);
    case "poly":
      return c.reduce((s, ci, i) => s + ci * x ** i, 0);
  }
}

/**
 * Число в удобочитаемом виде (4 значащие цифры, десятичная запятая).
 * @param v число
 * @returns строка
 */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s =
    a !== 0 && (a >= 1e6 || a < 1e-3)
      ? v.toExponential(digits - 1).replace(/\.?0+e/, "e")
      : String(Number(v.toPrecision(digits)));
  return s.replace(".", ",");
}

/**
 * Уравнение прямой в координатах осей, записанное через данные.
 * @param a наклон в осях
 * @param b свободный член в осях
 * @param xLog лог-ось X
 * @param yLog лог-ось Y
 * @returns строка уравнения
 */
export function axisLineEquation(a: number, b: number, xLog: boolean, yLog: boolean): string {
  if (!xLog && !yLog) return `y = ${fmt(a)}·x ${b >= 0 ? "+" : "−"} ${fmt(Math.abs(b))}`;
  if (xLog && yLog) return `y = ${fmt(10 ** b)}·x^${fmt(a)}`;
  if (xLog) return `y = ${fmt(a)}·lg x ${b >= 0 ? "+" : "−"} ${fmt(Math.abs(b))}`;
  return `y = ${fmt(10 ** b)}·10^(${fmt(a)}·x)`;
}

/**
 * Уравнение тренда.
 * @param t тренд
 * @returns строка уравнения
 */
export function trendEquation(t: TrendFit): string {
  const c = t.coeffs;
  const c0 = c[0] ?? 0;
  const c1 = c[1] ?? 0;
  switch (t.fit) {
    case "axis":
      return axisLineEquation(c0, c1, t.xLog, t.yLog);
    case "linear":
      return `y = ${fmt(c0)}·x ${c1 >= 0 ? "+" : "−"} ${fmt(Math.abs(c1))}`;
    case "power":
      return `y = ${fmt(c0)}·x^${fmt(c1)}`;
    case "log":
      return `y = ${fmt(c0)}·ln x ${c1 >= 0 ? "+" : "−"} ${fmt(Math.abs(c1))}`;
    case "exp":
      return `y = ${fmt(c0)}·e^(${fmt(c1)}·x)`;
    case "poly":
      return (
        "y = " +
        c
          .map((ci, i) => `${fmt(ci)}${i === 0 ? "" : i === 1 ? "·x" : `·x^${i}`}`)
          .reverse()
          .join(" + ")
          .replace(/\+ -/g, "− ")
      );
  }
}

/** Названия типов тренда для интерфейса. */
export const FIT_LABELS: Record<FitType, string> = {
  axis: "Прямая в осях графика",
  linear: "Линейная  y = a·x + b",
  power: "Степенная  y = c·xⁿ",
  log: "Логарифмическая  y = a·ln x + b",
  exp: "Экспоненциальная  y = c·e^(kx)",
  poly: "Полином",
};
