/**
 * Создание объектов проекта со значениями по умолчанию и демо-данные.
 *
 * Схема:
 *   uid()                 — идентификатор
 *   newChart(kind, …)     — график с параметрами по умолчанию для вида
 *   defaultCalc()         — входные данные калькулятора (значения из Excel пользователя)
 *   emptyProject()        — пустой проект
 *   demoStudy(name, …)    — синтетическая КВД/КСД горизонтальной скважины с ГРП + история дебитов
 *   autoRoles(study)      — назначить столбцы времени/давления/дебита по физическому смыслу
 */
import type { CalcState, ChartDef, ChartKind, Project, Study } from "./types";

const ATM = 101_325;
const MD = 9.869_233e-16;

/** Уникальный идентификатор. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const KIND_NAMES: Record<ChartKind, string> = {
  loglog: "Log-log",
  semilog: "Semilog",
  history: "История давления",
  rates: "История дебитов",
  combo: "История: давление и дебит",
  flex: "Произвольный",
  columns: "По столбцам",
};

/**
 * Новый график.
 * @param kind вид графика
 * @param studyId исследование
 * @param patch переопределяемые поля
 * @returns описание графика
 */
export function newChart(kind: ChartKind, studyId: string, patch: Partial<ChartDef> = {}): ChartDef {
  return {
    id: uid(),
    studyId,
    name: KIND_NAMES[kind],
    kind,
    xLog: kind === "loglog",
    yLog: kind === "loglog",
    theme: "dark",
    showGrid: true,
    timeFn: "sqrt",
    superposition: "none",
    yFn: "dp",
    normalizeByRate: false,
    derivL: 0.1,
    lines: [],
    visible: true,
    minimized: false,
    maximized: false,
    rect: { x: 0, y: 0, w: 520, h: 360 },
    ...patch,
  };
}

/** Входные данные калькулятора по умолчанию (из Excel «Расчет площади поверхности трещин ГРП»). */
export function defaultCalc(): CalcState {
  return {
    h_m: 19,
    fractures: 6,
    waterCut: 0.14,
    kRad_m2: 0.35 * MD,
    oil: { fvf: 1.135, viscosity_Pa_s: 1.44e-3, compressibility_1_Pa: 0.000133 / ATM, density_kg_m3: 870.5 },
    water: { fvf: 1, viscosity_Pa_s: 0.38e-3, compressibility_1_Pa: 0.000044 / ATM, density_kg_m3: 1008 },
    rockCompressibility_1_Pa: 0.000054 / ATM,
    perStudy: {},
    units: {},
    mode: "all",
    selected: [],
  };
}

/** Пустой проект. */
export function emptyProject(): Project {
  return { version: 1, studies: [], charts: [], groups: [], calc: defaultCalc() };
}

/**
 * Синтетическая КВД: влияние ствола → линейный поток (наклон ½) → радиальный режим.
 * @param name имя исследования
 * @param scale множитель амплитуды Δp
 * @param shift множитель времени
 * @returns исследование со столбцами «Время», «Давление», «Расход»
 */
export function demoStudy(name: string, scale = 1, shift = 1, testType: Study["testType"] = "buildup"): Study {
  const t: number[] = [];
  for (let i = 0; i < 110; i++) t.push(0.02 * 10 ** (i * 0.04));
  // Производная (атм) как функция времени; Δp получаем интегрированием по ln t.
  const der = (x: number): number => {
    const s = x / shift;
    return scale * ((48 * (s / 0.8)) / (1 + (s / 0.8) ** 1.25) + (9 * Math.sqrt(s)) / (1 + Math.sqrt(s / 300)));
  };
  const dp: number[] = [];
  let acc = der(t[0] ?? 0.02);
  t.forEach((ti, i) => {
    if (i > 0) {
      const tp = t[i - 1] ?? ti;
      acc += 0.5 * (der(ti) + der(tp)) * Math.log(ti / tp);
    }
    dp.push(acc);
  });
  const noise = (i: number): number => 1 + 0.004 * Math.sin(i * 12.9898);
  const p0 = 165.4;
  return {
    id: uid(),
    name,
    columns: [
      { id: uid(), name: "Время", quantity: "time", unit: "h", cells: ["0", ...t.map((x) => x.toPrecision(6))] },
      {
        id: uid(),
        name: "Давление",
        quantity: "pressure",
        unit: "atm",
        cells: [p0.toFixed(3), ...dp.map((d, i) => (p0 + (testType === "buildup" ? 1 : -1) * d * noise(i) * 0.12).toFixed(3))],
      },
    ],
    roles: {},
    // История режимов: работа 2000 ч до начала записи, затем остановка (КВД) или пуск (КСД).
    rateColumns: [
      { id: uid(), name: "Начало режима", quantity: "time", unit: "h", cells: testType === "buildup" ? ["-2000", "0"] : ["-500", "0"] },
      { id: uid(), name: "Дебит", quantity: "rate", unit: "m3/d", cells: testType === "buildup" ? ["22", "0"] : ["0", "22"] },
    ],
    rateRoles: {},
    testType,
    tpSeconds: 2000 * 3600,
    rateBeforeM3s: 22 / 86_400,
  };
}

/**
 * Назначить роли столбцов по физическому смыслу (первый подходящий столбец).
 * @param s исследование
 * @returns исследование с заполненными ролями
 */
export function autoRoles(s: Study): Study {
  const find = (...q: string[]): string | undefined => s.columns.find((c) => q.includes(c.quantity))?.id;
  const findQ = (...q: string[]): string | undefined => s.rateColumns.find((c) => q.includes(c.quantity))?.id;
  return {
    ...s,
    roles: {
      time: s.roles.time ?? find("time") ?? find("datetime"),
      pressure: s.roles.pressure ?? find("pressure"),
      rate: s.roles.rate ?? find("rate"),
    },
    rateRoles: {
      time: s.rateRoles.time ?? findQ("datetime") ?? findQ("time"),
      rate: s.rateRoles.rate ?? findQ("rate"),
    },
  };
}
