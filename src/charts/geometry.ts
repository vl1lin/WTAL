/**
 * Геометрия графика: координаты осей, автомасштаб, деления, прямые.
 *
 * Схема:
 *   данные (x, y) ──toAxis()──► координаты осей (log10 для лог-оси) ──Frame.px/py──► пиксели canvas
 *   autoView(series)   — область, охватывающая все точки
 *   ticks(min, max)    — основные и вспомогательные деления
 *   Frame              — область построения и преобразования пиксели ↔ оси
 */
import type { AxisPoint, View } from "../core/types";
import type { Series } from "./series";

export const MARGIN = { l: 60, r: 12, t: 8, b: 36 };

export const toAxis = (v: number, log: boolean): number => (log ? (v > 0 ? Math.log10(v) : Number.NaN) : v);
export const fromAxis = (v: number, log: boolean): number => (log ? 10 ** v : v);

/**
 * Область, охватывающая все точки серий.
 * @param series серии
 * @param xLog лог-ось X
 * @param yLog лог-ось Y
 * @returns область в координатах осей (лог-оси — по целым декадам)
 */
export function autoView(series: Series[], xLog: boolean, yLog: boolean): View {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const s of series)
    for (const p of s.points) {
      const x = toAxis(p.x, xLog);
      const y = toAxis(p.y, yLog);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  const fix = (a: number, b: number, log: boolean): [number, number] => {
    if (!Number.isFinite(a)) return log ? [0, 1] : [0, 1];
    if (log) {
      let lo = Math.floor(a + 1e-9);
      let hi = Math.ceil(b - 1e-9);
      if (hi <= lo) hi = lo + 1;
      if (hi - lo > 12) lo = hi - 12;
      return [lo, hi];
    }
    if (a === b) return [a - 1, b + 1];
    const pad = (b - a) * 0.05;
    return [a - pad, b + pad];
  };
  const [x0, x1] = fix(xmin, xmax, xLog);
  const [y0, y1] = fix(ymin, ymax, yLog);
  return { xmin: x0, xmax: x1, ymin: y0, ymax: y1 };
}

export interface Tick {
  v: number;
  major: boolean;
  label: string;
}

/**
 * Форматировать подпись деления.
 * @param v значение в данных
 * @returns строка
 */
export function fmtTick(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const e = Math.round(Math.log10(a));
    if (Math.abs(a - 10 ** e) / 10 ** e < 1e-9) return `${v < 0 ? "−" : ""}1e${e}`;
    return v.toExponential(1);
  }
  return String(Number(v.toPrecision(6))).replace(".", ",");
}

/**
 * Деления оси.
 * @param min начало (координаты оси)
 * @param max конец
 * @param log лог-ось
 * @param pixels длина оси в пикселях (для выбора шага)
 * @returns список делений в координатах оси
 */
export function ticks(min: number, max: number, log: boolean, pixels: number): Tick[] {
  const out: Tick[] = [];
  if (!(max > min)) return out;
  if (log) {
    const span = max - min;
    const step = Math.max(1, Math.ceil(span / Math.max(1, pixels / 40)));
    for (let e = Math.floor(min); e <= Math.ceil(max); e++) {
      if (e >= min - 1e-9 && e <= max + 1e-9 && e % step === 0) out.push({ v: e, major: true, label: fmtTick(10 ** e) });
      if (span < 8)
        for (let k = 2; k <= 9; k++) {
          const v = e + Math.log10(k);
          if (v > min && v < max) out.push({ v, major: false, label: span < 1.2 ? fmtTick(k * 10 ** e) : "" });
        }
    }
    return out;
  }
  const target = Math.max(2, Math.floor(pixels / 70));
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = mag;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * mag) {
      step = m * mag;
      break;
    }
  }
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) {
    const vv = Math.abs(v) < step * 1e-9 ? 0 : v;
    out.push({ v: vv, major: true, label: fmtTick(vv) });
  }
  return out;
}

/** Область построения и преобразования координат. */
export class Frame {
  constructor(
    public readonly w: number,
    public readonly h: number,
    public readonly view: View,
  ) {}
  get pw(): number {
    return Math.max(1, this.w - MARGIN.l - MARGIN.r);
  }
  get ph(): number {
    return Math.max(1, this.h - MARGIN.t - MARGIN.b);
  }
  /** Координата оси X → пиксель. */
  px(x: number): number {
    return MARGIN.l + ((x - this.view.xmin) / (this.view.xmax - this.view.xmin)) * this.pw;
  }
  /** Координата оси Y → пиксель. */
  py(y: number): number {
    return MARGIN.t + this.ph - ((y - this.view.ymin) / (this.view.ymax - this.view.ymin)) * this.ph;
  }
  /** Пиксель → координаты осей. */
  toAxisPoint(sx: number, sy: number): AxisPoint {
    return {
      x: this.view.xmin + ((sx - MARGIN.l) / this.pw) * (this.view.xmax - this.view.xmin),
      y: this.view.ymin + ((MARGIN.t + this.ph - sy) / this.ph) * (this.view.ymax - this.view.ymin),
    };
  }
  /** Точка внутри области построения. */
  inside(sx: number, sy: number): boolean {
    return sx >= MARGIN.l && sx <= MARGIN.l + this.pw && sy >= MARGIN.t && sy <= MARGIN.t + this.ph;
  }
}

/**
 * Обрезать бесконечную прямую через p1, p2 прямоугольником области (в координатах осей).
 * @param p1 первая точка
 * @param p2 вторая точка
 * @param v область
 * @returns концы отрезка внутри области или null
 */
export function clipLine(p1: AxisPoint, p2: AxisPoint, v: View): [AxisPoint, AxisPoint] | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return null;
  let t0 = -Infinity;
  let t1 = Infinity;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    clip(-dx, p1.x - v.xmin) &&
    clip(dx, v.xmax - p1.x) &&
    clip(-dy, p1.y - v.ymin) &&
    clip(dy, v.ymax - p1.y) &&
    t0 <= t1
  ) {
    return [
      { x: p1.x + t0 * dx, y: p1.y + t0 * dy },
      { x: p1.x + t1 * dx, y: p1.y + t1 * dy },
    ];
  }
  return null;
}

/**
 * Расстояние от точки до отрезка (в пикселях).
 */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Точка внутри многоугольника (лассо).
 * @param x абсцисса
 * @param y ордината
 * @param poly вершины [x0,y0,x1,y1,…]
 * @returns true, если внутри
 */
export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i] ?? 0;
    const yi = poly[2 * i + 1] ?? 0;
    const xj = poly[2 * j] ?? 0;
    const yj = poly[2 * j + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Размер области построения последней отрисовки каждого графика (для угла наклона на экране). */
export const lastFrames = new Map<string, Frame>();
