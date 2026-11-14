/**
 * Расчёты ГДИС.
 *
 * Схема:
 *   таблица дебитов ──rateTable()──► режимы (абсолютное время начала, дебит)
 *   таблица давления + режимы ──baseData()──► BaseData (СИ)
 *        tStart_s — начало анализируемого периода = последнее изменение дебита
 *                   (если таблицы дебитов нет — первая строка давления)
 *        dt_s     — время от начала периода (Δt), hist_s — время от первой строки давления
 *   ├─ deltaP()                         — Δp от давления p0 в момент tStart (КВД: p − p0, КСД: p0 − p), Па
 *   ├─ rateEvents()                     — история дебитов относительно tStart (для суперпозиции)
 *   ├─ producingTime()                  — tp: длительность работы до последнего изменения режима
 *   ├─ superposedTime(fn, sup, …)       — функция времени с суперпозицией (ось X)
 *   └─ bourdetDerivative(x, y, L)       — производная Бурде dΔp/dX по ln-времени
 *
 * Время в таблицах: «Дата и время» (абсолютное) или число в единицах времени. Если давление
 * задано датой, а дебиты числом — числа дебитов считаются от первой строки давления.
 * Все входы и выходы — в СИ, кроме функций времени: они берутся от времени в часах,
 * чтобы √Δt был в ч^0.5 (как принято при поиске инварианты).
 */
import type { Study, Superposition, TimeFn } from "./types";
import { computeSheet, type Sheet } from "./sheet";
import { toSI } from "./units";

export interface RateRow {
  /** Абсолютное время начала режима, с (дата — секунды эпохи, число — в СИ). */
  tAbs_s: number;
  q_m3_s: number;
}

export interface RateTable {
  rows: RateRow[];
  /** Время задано датой. */
  isDate: boolean;
}

const rateSheetCache = new WeakMap<Study, Sheet>();

/**
 * Вычисленная таблица дебитов (кэшируется по объекту исследования).
 * @param study исследование
 * @returns Sheet таблицы дебитов
 */
export function rateSheetOf(study: Study): Sheet {
  let s = rateSheetCache.get(study);
  if (!s) {
    s = computeSheet({ ...study, columns: study.rateColumns });
    rateSheetCache.set(study, s);
  }
  return s;
}

/**
 * Режимы из таблицы дебитов, по возрастанию времени.
 * @param study исследование
 * @returns режимы или null, если таблица пуста / не назначены столбцы
 */
export function rateTable(study: Study): RateTable | null {
  const tCol = study.rateColumns.find((c) => c.id === study.rateRoles.time);
  const qCol = study.rateColumns.find((c) => c.id === study.rateRoles.rate);
  if (!tCol || !qCol) return null;
  const sh = rateSheetOf(study);
  const tv = sh.numeric(tCol.id);
  const qv = sh.numeric(qCol.id);
  const rows: RateRow[] = [];
  for (let r = 0; r < sh.rowCount; r++) {
    const t = tv[r] ?? Number.NaN;
    const q = qv[r] ?? Number.NaN;
    if (!Number.isFinite(t) || !Number.isFinite(q)) continue;
    rows.push({ tAbs_s: tCol.quantity === "datetime" ? t : toSI(t, "time", tCol.unit), q_m3_s: toSI(q, "rate", qCol.unit) });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.tAbs_s - b.tAbs_s);
  return { rows, isDate: tCol.quantity === "datetime" };
}

export interface BaseData {
  /** Индексы строк таблицы давления, вошедших в расчёт. */
  rows: number[];
  /** Время от начала анализируемого периода (Δt), с; до начала периода — отрицательное. */
  dt_s: number[];
  /** Время от первой строки давления, с (для графика истории). */
  hist_s: number[];
  /** Давление, Па. */
  p_Pa: number[];
  /** Дебит из таблицы давления (устаревший способ), м³/с; NaN, если столбца нет. */
  q_m3_s: number[];
  /** Начало анализируемого периода относительно первой строки давления, с. */
  tStart_s: number;
  /** Давление в начале периода, Па. */
  p0_Pa: number;
  /** Режимы из таблицы дебитов, приведённые ко времени давления (hist-шкала), или null. */
  rates: { t_s: number; q_m3_s: number }[] | null;
  /** Предупреждение о несовместимом времени таблиц. */
  warning?: string;
}

/**
 * Собрать исходные ряды исследования в СИ.
 * Строки без времени или давления пропускаются.
 * @param study исследование
 * @param sheet вычисленная таблица давления
 * @returns ряды по строкам, начало периода, давление p0 и режимы
 */
export function baseData(study: Study, sheet: Sheet): BaseData {
  const out: BaseData = { rows: [], dt_s: [], hist_s: [], p_Pa: [], q_m3_s: [], tStart_s: 0, p0_Pa: Number.NaN, rates: null };
  const tCol = study.columns.find((c) => c.id === study.roles.time);
  const pCol = study.columns.find((c) => c.id === study.roles.pressure);
  if (!tCol || !pCol) return out;
  const qCol = study.columns.find((c) => c.id === study.roles.rate);
  const tv = sheet.numeric(tCol.id);
  const pv = sheet.numeric(pCol.id);
  const qv = qCol ? sheet.numeric(qCol.id) : null;
  const pIsDate = tCol.quantity === "datetime";
  let t0: number | null = null;
  for (let r = 0; r < sheet.rowCount; r++) {
    const t = tv[r] ?? Number.NaN;
    const p = pv[r] ?? Number.NaN;
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    const tSI = pIsDate ? t : toSI(t, "time", tCol.unit);
    if (t0 === null) t0 = tSI;
    out.rows.push(r);
    out.hist_s.push(tSI - t0);
    out.p_Pa.push(toSI(p, "pressure", pCol.unit));
    const q = qv && qCol ? (qv[r] ?? Number.NaN) : Number.NaN;
    out.q_m3_s.push(Number.isFinite(q) && qCol ? toSI(q, "rate", qCol.unit) : Number.NaN);
  }
  if (t0 === null) return out;

  // Режимы в шкале «время от первой строки давления».
  const rt = rateTable(study);
  if (rt) {
    if (rt.isDate && !pIsDate) {
      out.warning = "Дебиты заданы датой, а давление — числом: время таблиц не совместить";
    } else {
      const base = rt.isDate === pIsDate ? t0 : 0;
      out.rates = rt.rows.map((r) => ({ t_s: r.tAbs_s - base, q_m3_s: r.q_m3_s }));
    }
  }

  // Начало периода — последнее изменение дебита не позже последней точки давления.
  const lastHist = out.hist_s[out.hist_s.length - 1] ?? 0;
  if (out.rates && out.rates.length > 0) {
    let start = Number.NaN;
    let prevQ = Number.NaN;
    for (const e of out.rates) {
      const changed = !Number.isFinite(prevQ) || Math.abs(e.q_m3_s - prevQ) > 1e-12 * Math.max(1, Math.abs(prevQ));
      if (changed && e.t_s <= lastHist) start = e.t_s;
      prevQ = e.q_m3_s;
    }
    out.tStart_s = Number.isFinite(start) ? Math.max(0, start) : 0;
  }
  // p0 — давление в последней точке не позже начала периода (или первая точка).
  let i0 = 0;
  for (let i = 0; i < out.hist_s.length; i++) if ((out.hist_s[i] ?? 0) <= out.tStart_s + 1e-9) i0 = i;
  out.p0_Pa = out.p_Pa[i0] ?? Number.NaN;
  out.dt_s = out.hist_s.map((h) => h - out.tStart_s);
  return out;
}

/**
 * Перепад давления относительно давления в начале периода.
 * @param study исследование (тип КВД/КСД)
 * @param base ряды в СИ
 * @returns Δp, Па (положительный для обоих типов)
 */
export function deltaP(study: Study, base: BaseData): number[] {
  const p0 = base.p0_Pa;
  return base.p_Pa.map((p) => (study.testType === "buildup" ? p - p0 : p0 - p));
}

export interface RateEvent {
  /** Начало режима относительно начала анализируемого периода, с (может быть < 0). */
  t_s: number;
  q_m3_s: number;
}

/**
 * История дебитов относительно начала периода.
 * Если есть таблица дебитов — берётся она; иначе режим до исследования из tp и «дебита до остановки»
 * плюс изменения дебита в столбце таблицы давления (устаревший способ).
 * @param study исследование
 * @param base ряды в СИ
 * @returns список режимов по возрастанию времени (повторяющиеся дебиты объединены)
 */
export function rateEvents(study: Study, base: BaseData): RateEvent[] {
  const ev: RateEvent[] = [];
  const push = (t_s: number, q: number): void => {
    const last = ev[ev.length - 1];
    if (last && Math.abs(last.q_m3_s - q) <= 1e-12 * Math.max(1, Math.abs(q))) return;
    ev.push({ t_s, q_m3_s: q });
  };
  if (base.rates && base.rates.length > 0) {
    for (const r of base.rates) if (r.t_s <= base.tStart_s + 1e-9) push(r.t_s - base.tStart_s, r.q_m3_s);
    return ev;
  }
  if (study.testType === "buildup") push(-study.tpSeconds, study.rateBeforeM3s);
  for (let i = 0; i < base.dt_s.length; i++) {
    const q = base.q_m3_s[i] ?? Number.NaN;
    if (Number.isFinite(q)) push(base.dt_s[i] ?? 0, q);
  }
  if (study.testType === "buildup" && (ev.length === 1 || (ev[1]?.t_s ?? 0) > 0)) {
    ev.splice(1, 0, { t_s: 0, q_m3_s: 0 });
  }
  if (ev.length === 0) ev.push({ t_s: 0, q_m3_s: study.rateBeforeM3s });
  return ev;
}

/**
 * Время работы до начала периода tp, с (для Хорнера, Агарвала, двухрежимной суперпозиции).
 * @param study исследование
 * @param events история дебитов относительно начала периода
 * @param base ряды (наличие таблицы дебитов)
 * @returns tp, с
 */
export function producingTime(study: Study, events: RateEvent[], base: BaseData): number {
  if (base.rates && base.rates.length > 0) {
    const first = events[0];
    return first && first.t_s < 0 ? -first.t_s : 0;
  }
  return study.tpSeconds;
}

/**
 * Дебит, характеризующий исследование (для калькулятора): до остановки — для КВД, текущий — для КСД.
 * @param study исследование
 * @returns дебит, м³/с
 */
export function representativeRate(study: Study): number {
  const rt = rateTable(study);
  if (!rt) return study.rateBeforeM3s;
  const qs = rt.rows.map((r) => r.q_m3_s);
  const nonzero = qs.filter((q) => q > 0);
  return nonzero[nonzero.length - 1] ?? study.rateBeforeM3s;
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
