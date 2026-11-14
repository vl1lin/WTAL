/**
 * Модель данных проекта.
 *
 * Схема:
 *   Project
 *   ├─ studies: Study[]            — «Главная страница» (isMain: вся история скважины) и исследования (КВД_1 …),
 *   │                                 созданные из выделенных на главной странице участков
 *   │    ├─ columns: Column[]      — таблица давления: время, давление, ƒx-столбцы, пустые столбцы
 *   │    └─ rateColumns: Column[]  — таблица дебитов (история режимов): время начала режима, дебит
 *   ├─ charts: ChartDef[]          — графики; каждый принадлежит исследованию (studyId)
 *   │    └─ lines: LineDef[]       — прямые (по 2 точкам и линии тренда) в координатах осей
 *   ├─ groups: StudyGroup[]        — группы исследований для калькулятора
 *   └─ calc: CalcState             — входные данные калькулятора (в СИ)
 *
 * Все значения ячеек хранятся строками (как ввёл пользователь), числа вычисляются
 * модулем core/sheet.ts. Физические расчёты (core/welltest.ts) работают в СИ.
 */

/** Физический смысл столбца. */
export type Quantity =
  | "time"
  | "datetime"
  | "pressure"
  | "rate"
  | "temperature"
  | "dimensionless"
  | "other";

/** Столбец таблицы исследования. */
export interface Column {
  id: string;
  name: string;
  quantity: Quantity;
  /** Ключ единицы из core/units.ts (например "h", "atm", "m3/d"). */
  unit: string;
  /** Сырые значения ячеек: число ("12,5"), текст или формула ("=B2-B1"). */
  cells: string[];
  /** Формула столбца (ƒx) — применяется к ячейкам без собственного значения. */
  formula?: string;
}

/** Тип исследования — влияет на расчёт Δp и суперпозиции. */
export type TestType = "buildup" | "drawdown";

/** Какая таблица исследования: давление или дебиты. */
export type TablePart = "p" | "q";

export interface Study {
  id: string;
  name: string;
  /** Таблица давления. */
  columns: Column[];
  /** Какие столбцы таблицы давления считаются временем, давлением и (устар.) дебитом. */
  roles: { time?: string; pressure?: string; rate?: string };
  /** Таблица дебитов: каждая строка — режим, время в ней — начало режима. */
  rateColumns: Column[];
  rateRoles: { time?: string; rate?: string };
  /** Что означает время в таблице дебитов: начало режима (по умолчанию) или его конец (как в выгрузках Saphir). */
  rateTimeMode?: "start" | "end";
  /** Тип периода определяется по дебитам (по умолчанию) или задан вручную полем testType. */
  testTypeAuto?: boolean;
  /** Отсчёт Δt: от последней смены дебита (по умолчанию) или от первой строки давления. */
  dtFrom?: "rateChange" | "firstPoint";
  /** Главная страница: вся история скважины, из неё создаются исследования. */
  isMain?: boolean;
  testType: TestType;
  /** Время работы до остановки tp, с — используется, только если таблица дебитов пуста. */
  tpSeconds: number;
  /** Дебит до остановки, м³/с — используется, только если таблица дебитов пуста. */
  rateBeforeM3s: number;
}

/** Функция времени для оси X. */
export type TimeFn = "dt" | "log" | "sqrt" | "qrt" | "invsqrt";
/** Способ суперпозиции. */
export type Superposition = "none" | "buildup" | "multirate" | "agarwal";

/** combo — два графика в одном окне: давление сверху, дебит снизу, общая ось времени. */
export type ChartKind = "loglog" | "semilog" | "history" | "rates" | "combo" | "flex" | "columns";

/** Вид линии тренда. "axis" — прямая в текущих осях (наклон на log-log = показатель степени). */
export type FitType = "axis" | "linear" | "power" | "log" | "exp" | "poly";

/** Точка в координатах осей (для лог-оси хранится log10 значения). */
export interface AxisPoint {
  x: number;
  y: number;
}

export interface LineDef {
  id: string;
  name: string;
  color: string;
  /** Прямая в координатах осей (для "two-point" и тренда "axis"). */
  p1?: AxisPoint;
  p2?: AxisPoint;
  /** Тренд: тип аппроксимации, по каким строкам и серии построен, коэффициенты. */
  trend?: {
    fit: FitType;
    degree: number;
    fixedSlope?: number;
    seriesKey: string;
    rows: number[];
    /** Коэффициенты в «естественном» виде, см. core/regression.ts. */
    coeffs: number[];
    r2: number;
  };
}

/** Видимая область графика в координатах осей. */
export interface View {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartDef {
  id: string;
  studyId: string;
  name: string;
  kind: ChartKind;
  xLog: boolean;
  yLog: boolean;
  theme: "dark" | "light";
  showGrid: boolean;
  /** Параметры произвольного графика. */
  timeFn: TimeFn;
  superposition: Superposition;
  yFn: "p" | "dp";
  normalizeByRate: boolean;
  /** Сглаживание производной Бурде L (в логарифмических циклах ln). */
  derivL: number;
  /** Для графика по столбцам: X и Y-серии. */
  xColumn?: string;
  yColumns?: { columnId: string; color: string; marker: Marker }[];
  /** Ограничение строк (график по выделенным данным). */
  rows?: number[];
  /** Дополнительные исследования для наложения (только log-log производные). */
  overlayStudyIds?: string[];
  view?: View;
  defaultView?: View;
  /** Нижний график (дебит) в виде combo: своя ось Y, ось X общая с view. */
  view2?: View;
  lines: LineDef[];
  visible: boolean;
  minimized: boolean;
  maximized: boolean;
  rect: WindowRect;
}

export type Marker = "cross" | "circle" | "dot" | "line" | "step";

export interface StudyGroup {
  id: string;
  name: string;
  studyIds: string[];
}

/** Входные данные калькулятора, все в СИ. */
export interface CalcState {
  h_m: number;
  fractures: number;
  waterCut: number;
  kRad_m2: number;
  oil: FluidProps;
  water: FluidProps;
  rockCompressibility_1_Pa: number;
  perStudy: Record<string, { rate_m3_s: number; porosity: number; invariant_Pa_s05: number }>;
  /** Выбранные единицы отображения для каждого поля калькулятора. */
  units: Record<string, string>;
  mode: "all" | "selected" | "groups";
  selected: string[];
}

export interface FluidProps {
  fvf: number;
  viscosity_Pa_s: number;
  compressibility_1_Pa: number;
  density_kg_m3: number;
}

export interface Project {
  version: 1;
  studies: Study[];
  charts: ChartDef[];
  groups: StudyGroup[];
  calc: CalcState;
}
