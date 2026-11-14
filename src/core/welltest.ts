/**
 * Расчёты ГДИС.
 *
 * Схема:
 *   Study + Sheet ──baseData()──► BaseData (СИ: Δt_s, p_Pa, q_m3_s по строкам)
 *        ├─ deltaP()                         — Δp (КВД: p − p0, КСД: p0 − p), Па
 *        ├─ rateEvents()                     — история дебитов для суперпозиции
 *        ├─ superposedTime(fn, sup, …)       — функция времени с суперпозицией (ось X)
 *        └─ bourdetDerivative(x, y, L)       — производная Бурде dΔp/dX по ln-времени
 *
 * Все входы и выходы — в СИ, кроме функций времени: они берутся от времени в часах,
 * чтобы √Δt был в ч^0.5 (как принято при поиске инварианты).
 */
import type { Study, Superposition, TimeFn } from "./types";
import type { Sheet } from "./sheet";
import { toSI } from "./units";

export interface BaseData {
  /** Индексы строк таблицы, вошедших в расчёт. */
  rows: number[];
  /** Время от начала исследования, с. */
  dt_s: number[];
  /** Давление, Па. */
  p_Pa: number[];
  /** Дебит, м³/с (NaN, если столбца нет). */
  q_m3_s: number[];
}

/**
 * Собрать исходные ряды исследования в СИ.
 * Строки без времени или давления пропускаются. Время отсчитывается от первой строки.
 * @param study исследование
 * @param sheet вычисленная таблица
 * @returns ряды по строкам
 */
export function baseData(study: Study, sheet: Sheet): BaseData {
  const out: BaseData = { rows: [], dt_s: [], p_Pa: [], q_m3_s: [] };
  const tCol = study.columns.find((c) => c.id === study.roles.time);
  const pCol = study.columns.find((c) => c.id === study.roles.pressure);
  if (!tCol || !pCol) return out;
  const qCol = study.columns.find((c) => c.id === study.roles.rate);
  const tv = sheet.numeric(tCol.id);
  const pv = sheet.numeric(pCol.id);
  const qv = qCol ? sheet.numeric(qCol.id) : null;
  let t0: number | null = null;
  for (let r = 0; r < sheet.rowCount; r++) {
    const t = tv[r] ?? Number.NaN;
    const p = pv[r] ?? Number.NaN;
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    const tSI = tCol.quantity === "datetime" ? t : toSI(t, "time", tCol.unit);
    if (t0 === null) t0 = tSI;
    out.rows.push(r);
    out.dt_s.push(tSI - t0);
    out.p_Pa.push(toSI(p, "pressure", pCol.unit));
    const q = qv && qCol ? (qv[r] ?? Number.NaN) : Number.NaN;
    out.q_m3_s.push(Number.isFinite(q) && qCol ? toSI(q, "rate", qCol.unit) : Number.NaN);
  }
  return out;
}

/**
 * Перепад давления относительно первой точки.
 * @param study исследование (тип КВД/КСД)
 * @param base ряды в СИ
 * @returns Δp, Па (положительный для обоих типов)
 */
export function deltaP(study: Study, base: BaseData): number[] {
  const p0 = base.p_Pa[0] ?? 0;
  return base.p_Pa.map((p) => (study.testType === "buildup" ? p - p0 : p0 - p));
}

export interface RateEvent {
  /** Начало режима относительно начала исследования, с (может быть < 0). */
  t_s: number;
  q_m3_s: number;
}

/**
 * История дебитов: режим до исследования (для КВД) + изменения дебита в таблице.
 * @param study исследование
 * @param base ряды в СИ
 * @returns список режимов по возрастанию времени
 */
export function rateEvents(study: Study, base: BaseData): RateEvent[] {
  const ev: RateEvent[] = [];
  if (study.testType === "buildup") ev.push({ t_s: -study.tpSeconds, q_m3_s: study.rateBeforeM3s });
  let last = study.testType === "buildup" ? study.rateBeforeM3s : Number.NaN;
  for (let i = 0; i < base.dt_s.length; i++) {
    const q = base.q_m3_s[i] ?? Number.NaN;
    if (!Number.isFinite(q)) continue;
    if (!Number.isFinite(last) || Math.abs(q - last) > 1e-12 * Math.max(1, Math.abs(last))) {
      ev.push({ t_s: base.dt_s[i] ?? 0, q_m3_s: q });
      last = q;
    }
  }
  if (study.testType === "buildup" && (ev.length === 1 || (ev[1]?.t_s ?? 0) > 0)) {
    ev.splice(1, 0, { t_s: 0, q_m3_s: 0 });
  }
  if (ev.length === 0) ev.push({ t_s: 0, q_m3_s: study.rateBeforeM3s });
  return ev;
}

/**
 * Изменение дебита последнего режима |q_n − q_{n−1}|, м³/с (для нормировки).
 * @param events история дебитов
 * @returns модуль скачка дебита или NaN
 */
export function lastRateStep(events: RateEvent[]): number {
  const n = events.length;
  const qn = events[n - 1]?.q_m3_s ?? Number.NaN;
  const qp = n > 1 ? (events[n - 2]?.q_m3_s ?? 0) : 0;
  const d = Math.abs(qn - qp);
  return d > 0 ? d : Number.NaN;
}

/**
 * Функция времени от времени в часах.
 * @param fn вид функции
 * @param t_h время, ч (> 0)
 * @returns значение функции
 */
export function timeFn(fn: TimeFn, t_h: number): number {
  switch (fn) {
    case "dt":
      return t_h;
    case "log":
      return Math.log10(t_h);
    case "sqrt":
      return Math.sqrt(t_h);
    case "qrt":
      return Math.sqrt(Math.sqrt(t_h));
    case "invsqrt":
      return 1 / Math.sqrt(t_h);
  }
}

/**
 * Функция времени с учётом суперпозиции.
 * - none: f(Δt)
 * - buildup: f(Δt) − f(tp + Δt) + f(tp)  (двухрежимная, для КВД)
 * - agarwal: f(te), te = tp·Δt/(tp + Δt)
 * - multirate: Σ (q_j − q_{j−1})/(q_n − q_{n−1}) · f(Δt − t_j)
 * @param fn функция времени
 * @param sup способ суперпозиции
 * @param dt_s время от начала исследования, с
 * @param tp_s время работы до остановки, с
 * @param events история дебитов (для multirate)
 * @returns значение или NaN, если не определено (например, Δt = 0 под логарифмом)
 */
export function superposedTime(
  fn: TimeFn,
  sup: Superposition,
  dt_s: number,
  tp_s: number,
  events: RateEvent[],
): number {
  const H = 3600;
  const f = (t_s: number): number => (t_s > 0 ? timeFn(fn, t_s / H) : Number.NaN);
  switch (sup) {
    case "none":
      return f(dt_s);
    case "buildup":
      return tp_s > 0 ? f(dt_s) - f(tp_s + dt_s) + f(tp_s) : f(dt_s);
    case "agarwal":
      return tp_s > 0 ? f((tp_s * dt_s) / (tp_s + dt_s)) : f(dt_s);
    case "multirate": {
      const n = events.length;
      const dq = (events[n - 1]?.q_m3_s ?? 0) - (n > 1 ? (events[n - 2]?.q_m3_s ?? 0) : 0);
      if (dq === 0) return f(dt_s);
      let s = 0;
      let prevQ = 0;
      for (const e of events) {
        if (e.t_s >= dt_s) break;
        s += ((e.q_m3_s - prevQ) / dq) * f(dt_s - e.t_s);
        prevQ = e.q_m3_s;
      }
      return s;
    }
  }
}

/**
 * Натуральная «логарифмическая» функция суперпозиции — аргумент для производной Бурде.
 * @param sup способ суперпозиции
 * @param dt_s время, с
 * @param tp_s время работы до остановки, с
 * @param events история дебитов
 * @returns значение в ln-единицах
 */
export function lnSuperposition(sup: Superposition, dt_s: number, tp_s: number, events: RateEvent[]): number {
  return superposedTime("log", sup, dt_s, tp_s, events) * Math.LN10;
}

/**
 * Производная Бурде с окном сглаживания L.
 * Для каждой точки берутся ближайшие точки слева и справа, отстоящие по X не меньше чем на L,
 * и вычисляется взвешенная средняя наклонов.
 * @param x аргумент (обычно ln-функция времени), по возрастанию
 * @param y функция (Δp)
 * @param L окно сглаживания (0 — соседние точки)
 * @returns массив производных dy/dx (NaN на краях, где окно не набирается)
 */
export function bourdetDerivative(x: number[], y: number[], L: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    const xi = x[i] ?? Number.NaN;
    const yi = y[i] ?? Number.NaN;
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    let j = i - 1;
    while (j >= 0 && (!Number.isFinite(x[j] ?? Number.NaN) || xi - (x[j] ?? 0) < L)) j--;
    let k = i + 1;
    while (k < n && (!Number.isFinite(x[k] ?? Number.NaN) || (x[k] ?? 0) - xi < L)) k++;
    const xj = x[j];
    const xk = x[k];
    const yj = y[j];
    const yk = y[k];
    if (j < 0 || k >= n || xj === undefined || xk === undefined || yj === undefined || yk === undefined) {
      // На краях — односторонняя разность, если есть хотя бы одна сторона.
      if (j >= 0 && xj !== undefined && yj !== undefined && xi !== xj) out[i] = (yi - yj) / (xi - xj);
      else if (k < n && xk !== undefined && yk !== undefined && xk !== xi) out[i] = (yk - yi) / (xk - xi);
      continue;
    }
    const dl = xi - xj;
    const dr = xk - xi;
    if (dl <= 0 || dr <= 0) continue;
    const sl = (yi - yj) / dl;
    const sr = (yk - yi) / dr;
    out[i] = (sl * dr + sr * dl) / (dl + dr);
  }
  return out;
}
