/**
 * Единицы измерения и перевод в СИ.
 *
 * Схема: UNITS[dimension] → список Unit; toSI()/fromSI() переводят значение по ключу единицы.
 * Ключ единицы уникален внутри измерения. Для температуры используется смещение (°C → K).
 *
 * Измерения (dimension) — это не только физический смысл столбца таблицы (Quantity),
 * но и величины калькулятора (длина, проницаемость, вязкость …).
 */

export interface Unit {
  key: string;
  label: string;
  /** Множитель: значение_СИ = value * factor + offset. */
  factor: number;
  offset?: number;
}

export type Dimension =
  | "time"
  | "pressure"
  | "rate"
  | "temperature"
  | "length"
  | "area"
  | "permeability"
  | "viscosity"
  | "compressibility"
  | "density"
  | "fvf"
  | "fraction"
  | "invariant"
  | "count"
  | "none";

const ATM = 101_325;
const PSI = 6_894.757;
const DAY = 86_400;
const HOUR = 3_600;
const BBL = 0.158_987_3;
const MD = 9.869_233e-16;

export const UNITS: Record<Dimension, Unit[]> = {
  time: [
    { key: "h", label: "ч", factor: HOUR },
    { key: "min", label: "мин", factor: 60 },
    { key: "s", label: "с", factor: 1 },
    { key: "d", label: "сут", factor: DAY },
  ],
  pressure: [
    { key: "atm", label: "атм", factor: ATM },
    { key: "bar", label: "бар", factor: 1e5 },
    { key: "MPa", label: "МПа", factor: 1e6 },
    { key: "kPa", label: "кПа", factor: 1e3 },
    { key: "kgf/cm2", label: "кгс/см²", factor: 98_066.5 },
    { key: "psi", label: "psi", factor: PSI },
    { key: "Pa", label: "Па", factor: 1 },
  ],
  rate: [
    { key: "m3/d", label: "м³/сут", factor: 1 / DAY },
    { key: "m3/h", label: "м³/ч", factor: 1 / HOUR },
    { key: "m3/s", label: "м³/с", factor: 1 },
    { key: "bbl/d", label: "bbl/d", factor: BBL / DAY },
  ],
  temperature: [
    { key: "C", label: "°C", factor: 1, offset: 273.15 },
    { key: "K", label: "K", factor: 1 },
  ],
  length: [
    { key: "m", label: "м", factor: 1 },
    { key: "ft", label: "фут", factor: 0.3048 },
    { key: "km", label: "км", factor: 1000 },
  ],
  area: [
    { key: "m2", label: "м²", factor: 1 },
    { key: "km2", label: "км²", factor: 1e6 },
    { key: "ft2", label: "фут²", factor: 0.092_903_04 },
  ],
  permeability: [
    { key: "mD", label: "мД", factor: MD },
    { key: "D", label: "Д", factor: MD * 1000 },
    { key: "um2", label: "мкм²", factor: 1e-12 },
    { key: "m2", label: "м²", factor: 1 },
  ],
  viscosity: [
    { key: "cP", label: "сПз", factor: 1e-3 },
    { key: "mPa*s", label: "мПа·с", factor: 1e-3 },
    { key: "Pa*s", label: "Па·с", factor: 1 },
  ],
  compressibility: [
    { key: "1/atm", label: "1/атм", factor: 1 / ATM },
    { key: "1/bar", label: "1/бар", factor: 1e-5 },
    { key: "1/MPa", label: "1/МПа", factor: 1e-6 },
    { key: "1/psi", label: "1/psi", factor: 1 / PSI },
    { key: "1/Pa", label: "1/Па", factor: 1 },
  ],
  density: [
    { key: "kg/m3", label: "кг/м³", factor: 1 },
    { key: "g/cm3", label: "г/см³", factor: 1000 },
  ],
  fvf: [
    { key: "m3/m3", label: "м³/м³", factor: 1 },
  ],
  fraction: [
    { key: "frac", label: "д.ед.", factor: 1 },
    { key: "pct", label: "%", factor: 0.01 },
  ],
  invariant: [
    { key: "atm/h05", label: "атм/ч^0.5", factor: ATM / Math.sqrt(HOUR) },
    { key: "bar/h05", label: "бар/ч^0.5", factor: 1e5 / Math.sqrt(HOUR) },
    { key: "MPa/h05", label: "МПа/ч^0.5", factor: 1e6 / Math.sqrt(HOUR) },
    { key: "psi/h05", label: "psi/ч^0.5", factor: PSI / Math.sqrt(HOUR) },
    { key: "Pa/s05", label: "Па/с^0.5", factor: 1 },
  ],
  count: [{ key: "pcs", label: "шт", factor: 1 }],
  none: [{ key: "-", label: "—", factor: 1 }],
};

/**
 * Найти единицу по измерению и ключу.
 * @param dim измерение
 * @param key ключ единицы
 * @returns единица; если ключ не найден — первая (базовая для отображения) единица измерения
 */
export function getUnit(dim: Dimension, key: string): Unit {
  const list = UNITS[dim];
  const found = list.find((u) => u.key === key);
  if (found) return found;
  const first = list[0];
  if (!first) throw new Error(`Нет единиц для измерения ${dim}`);
  return first;
}

/**
 * Перевести значение в СИ.
 * @param value значение в единице `key`
 * @param dim измерение
 * @param key ключ единицы
 * @returns значение в СИ
 */
export function toSI(value: number, dim: Dimension, key: string): number {
  const u = getUnit(dim, key);
  return value * u.factor + (u.offset ?? 0);
}

/**
 * Перевести значение из СИ в единицу `key`.
 * @param valueSI значение в СИ
 * @param dim измерение
 * @param key ключ целевой единицы
 * @returns значение в единице `key`
 */
export function fromSI(valueSI: number, dim: Dimension, key: string): number {
  const u = getUnit(dim, key);
  return (valueSI - (u.offset ?? 0)) / u.factor;
}

/**
 * Измерение, соответствующее физическому смыслу столбца таблицы.
 * @param q физический смысл столбца
 * @returns измерение для списка единиц
 */
export function dimensionOfQuantity(q: string): Dimension {
  switch (q) {
    case "time":
      return "time";
    case "pressure":
      return "pressure";
    case "rate":
      return "rate";
    case "temperature":
      return "temperature";
    default:
      return "none";
  }
}

/** Подпись единицы по измерению и ключу. */
export function unitLabel(dim: Dimension, key: string): string {
  return getUnit(dim, key).label;
}

/** Единицы отображения на графиках (фиксированы в этой версии). */
export const DISPLAY = {
  time: "h",
  pressure: "atm",
  rate: "m3/d",
} as const;
