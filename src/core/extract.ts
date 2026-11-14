/**
 * Создание исследования из участка истории скважины (главной страницы) и демо-история.
 *
 * Схема:
 *   главная страница (Study, isMain) + выделенные строки давления
 *     └─ studyFromSelection() → новое исследование:
 *          таблица давления — выделенные строки (формулы заменены значениями),
 *          таблица дебитов — вся история режимов (нужна для суперпозиции; режимы после
 *          последней точки давления в расчёт не попадают)
 *   demoHistory() — синтетическая история: несколько пусков и остановок с датами
 */
import type { Column, Study } from "./types";
import { computeSheet } from "./sheet";
import { autoRoles, uid } from "./factory";
import { baseData, effectiveTestType } from "./welltest";

/**
 * Скопировать столбцы с новыми id; значения формул заменяются вычисленными.
 * @param cols столбцы
 * @param rows строки для копирования (все — если undefined)
 * @param display функция отображаемого значения ячейки (для формул)
 * @returns новые столбцы и соответствие старых id новым
 */
function copyColumns(
  cols: Column[],
  rows: number[] | undefined,
  display: (col: number, row: number) => string,
): { columns: Column[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const n = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const take = rows ?? Array.from({ length: n }, (_, i) => i);
  const columns = cols.map((c, ci) => {
    const id = uid();
    ids.set(c.id, id);
    const cells = take.map((r) => {
      const raw = c.cells[r] ?? "";
      const isFormula = raw.startsWith("=") || (raw.trim() === "" && Boolean(c.formula));
      return isFormula ? display(ci, r) : raw;
    });
    return { id, name: c.name, quantity: c.quantity, unit: c.unit, cells };
  });
  return { columns, ids };
}

/**
 * Новое исследование из выделенных строк главной страницы.
 * @param main главная страница
 * @param rows выделенные строки таблицы давления
 * @param name имя исследования
 * @returns исследование (тип КВД/КСД определён по дебитам)
 */
export function studyFromSelection(main: Study, rows: number[], name: string): Study {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const pSheet = computeSheet(main);
  const qSheet = computeSheet({ ...main, columns: main.rateColumns });
  const p = copyColumns(main.columns, sorted, (c, r) => pSheet.display(c, r));
  const q = copyColumns(main.rateColumns, undefined, (c, r) => qSheet.display(c, r));
  const mapId = (id: string | undefined, m: Map<string, string>): string | undefined => (id ? m.get(id) : undefined);
  const study: Study = autoRoles({
    id: uid(),
    name,
    columns: p.columns,
    roles: {
      time: mapId(main.roles.time, p.ids),
      pressure: mapId(main.roles.pressure, p.ids),
      rate: mapId(main.roles.rate, p.ids),
    },
    rateColumns: q.columns,
    rateRoles: { time: mapId(main.rateRoles.time, q.ids), rate: mapId(main.rateRoles.rate, q.ids) },
    rateTimeMode: main.rateTimeMode,
    testType: main.testType,
    tpSeconds: main.tpSeconds,
    rateBeforeM3s: main.rateBeforeM3s,
  });
  const b = baseData(study, computeSheet(study));
  return { ...study, testType: effectiveTestType(study, b) };
}

/**
 * Синтетическая история скважины: пуски и остановки, давление по суперпозиции радиального притока.
 * Начало — 01.03.2026 00:00, время датами.
 * @returns столбцы давления и дебитов
 */
export function demoHistory(): { pressure: Column[]; rates: Column[] } {
  // Режимы: [начало, ч; дебит, м³/сут]
  const regimes: [number, number][] = [
    [0, 60],
    [200, 0],
    [260, 40],
    [420, 0],
    [470, 35],
  ];
  const end = 620;
  const times = new Set<number>();
  for (let t = 0; t <= end; t += 1) times.add(t);
  regimes.forEach(([t0], k) => {
    const next = regimes[k + 1]?.[0] ?? end;
    for (let i = 0; i < 70; i++) {
      const t = t0 + 0.01 * 10 ** (i * 0.06);
      if (t < next) times.add(Math.round(t * 1e4) / 1e4);
    }
  });
  const ts = [...times].sort((a, b) => a - b);
  const pi = 250;
  const pressureAt = (t: number): number => {
    let s = 0;
    let prev = 0;
    for (const [tj, q] of regimes) {
      if (tj >= t) break;
      const dt = t - tj;
      // Ствол скважины сглаживает начало, далее — логарифм (радиальный режим).
      s += (q - prev) * 0.55 * Math.log(1 + dt / 0.4) * (1 - Math.exp(-dt / 0.15));
      prev = q;
    }
    return pi - s;
  };
  const base = Date.UTC(2026, 2, 1, 0, 0, 0);
  const fmt = (h: number): string => {
    const d = new Date(base + h * 3_600_000);
    const two = (x: number): string => String(x).padStart(2, "0");
    const sec = d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
    return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${sec.toFixed(1).padStart(4, "0")}`;
  };
  const noise = (i: number): number => 0.05 * Math.sin(i * 12.9898) * Math.cos(i * 4.1414);
  return {
    pressure: [
      { id: uid(), name: "Дата и время", quantity: "datetime", unit: "-", cells: ts.map(fmt) },
      { id: uid(), name: "P заб", quantity: "pressure", unit: "atm", cells: ts.map((t, i) => (pressureAt(t) + noise(i)).toFixed(3)) },
    ],
    rates: [
      { id: uid(), name: "Начало режима", quantity: "datetime", unit: "-", cells: regimes.map(([t]) => fmt(t)) },
      { id: uid(), name: "Дебит", quantity: "rate", unit: "m3/d", cells: regimes.map(([, q]) => String(q)) },
    ],
  };
}
