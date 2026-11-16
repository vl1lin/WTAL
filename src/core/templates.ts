/**
 * Готовые заготовки шаблонов расчётов.
 *
 * Схема: emptyTemplate() — пустой; fractureTemplate() — копия встроенного расчёта трещин ГРП;
 * hornerTemplate() — пример (проницаемость и скин по КВД). Все значения по умолчанию — в СИ.
 */
import { uid } from "./factory";
import type { CalcState, CalcTemplate, ParamSource, TplFormula, TplParam } from "./types";
import { mixture } from "./fracture";
import type { Dimension } from "./units";

const ATM = 101_325;
const MD = 9.869_233e-16;
const MANUAL: ParamSource = { kind: "manual" };

/**
 * Параметр шаблона.
 * @param sym обозначение
 * @param name название
 * @param dim величина
 * @param unit единица в формуле
 * @param perStudy своё значение у каждого исследования
 * @param def значение по умолчанию в СИ
 * @param source источник значения
 */
export function param(sym: string, name: string, dim: Dimension, unit: string, perStudy: boolean, def = Number.NaN, source: ParamSource = MANUAL): TplParam {
  return { id: uid(), sym, name, dim, unit, perStudy, default: def, source };
}

/**
 * Формула шаблона.
 * @param sym обозначение
 * @param name название
 * @param expr формула
 * @param dim величина результата
 * @param unit единица результата формулы
 * @param result выводить в таблицу
 * @param agg итог по группе
 */
export function formula(sym: string, name: string, expr: string, dim: Dimension, unit: string, result = true, agg: TplFormula["agg"] = "mean"): TplFormula {
  return { id: uid(), sym, name, expr, dim, unit, result, agg };
}

/** Пустой шаблон. */
export function emptyTemplate(name = "Новый шаблон"): CalcTemplate {
  return { id: uid(), name, description: "", params: [param("x", "Параметр", "none", "-", true, Number.NaN)], formulas: [formula("y", "Результат", "= 2 * x", "none", "-")] };
}

/**
 * Копия встроенного расчёта трещин ГРП по инварианте (формулы в СИ).
 * @param calc состояние встроенного расчёта — значения по умолчанию берутся из него (свойства смеси)
 */
export function fractureTemplate(calc?: CalcState): CalcTemplate {
  const mx = calc ? mixture(calc) : null;
  return {
    id: uid(),
    name: "Площадь трещин ГРП (копия)",
    description: "Копия встроенного расчёта. Свойства смеси вводятся готовыми значениями.",
    params: [
      param("q", "Дебит", "rate", "m3/s", true, Number.NaN, { kind: "study", what: "rate" }),
      param("φ", "Пористость", "fraction", "frac", true, 0.13),
      param("m", "Инварианта (наклон Δp от √Δt)", "invariant", "Pa/s05", true, Number.NaN, { kind: "line", axes: "linear", what: "slope", at: 1, abs: true }),
      param("B", "Объёмный коэффициент смеси", "fvf", "m3/m3", false, mx?.fvf ?? 1.1),
      param("μ", "Вязкость смеси", "viscosity", "Pa*s", false, mx?.viscosity_Pa_s ?? 1.1e-3),
      param("ct", "Общая сжимаемость", "compressibility", "1/Pa", false, mx?.compressibility_1_Pa ?? 1.7e-4 / ATM),
      param("K", "Проницаемость K_рад", "permeability", "m2", false, calc?.kRad_m2 ?? 0.35 * MD),
      param("n", "Число трещин", "count", "pcs", false, calc?.fractures ?? 6),
      param("h", "Эффективная толщина", "length", "m", false, calc?.h_m ?? 19),
    ],
    formulas: [
      formula("k", "Проницаемость без учёта трещин", "= K / n", "permeability", "m2", false, "none"),
      formula("A", "Площадь трещин", "= 2 * q * B / (SQRT(PI()) * m) * SQRT(μ / (ct * k * φ))", "area", "m2"),
      formula("Sxf", "Сумма полудлин", "= A / (4 * h * n)", "length", "m"),
      formula("xf", "Средняя полудлина", "= Sxf / n", "length", "m"),
    ],
  };
}

/** Пример: проницаемость и скин по КВД (метод Хорнера), формулы в СИ. */
export function hornerTemplate(): CalcTemplate {
  return {
    id: uid(),
    name: "Проницаемость и скин (Хорнер)",
    description: "По прямой радиального притока на графике Semilog. Формулы в СИ, ввод и вывод — в любых единицах.",
    params: [
      param("m", "Наклон прямой (на цикл)", "pressure", "Pa", true, Number.NaN, { kind: "line", axes: "semilog", what: "slope", at: 1, abs: true }),
      param("p1h", "Давление на прямой при Δt = 1 ч", "pressure", "Pa", true, Number.NaN, { kind: "line", axes: "semilog", what: "yAtX", at: 1, abs: false }),
      param("pwf", "Давление в момент остановки", "pressure", "Pa", true, Number.NaN, { kind: "table", what: "pFirst" }),
      param("q", "Дебит до остановки", "rate", "m3/s", true, Number.NaN, { kind: "study", what: "rate" }),
      param("h", "Эффективная толщина", "length", "m", true, 19),
      param("φ", "Пористость", "fraction", "frac", true, 0.13),
      param("B", "Объёмный коэффициент", "fvf", "m3/m3", false, 1.135),
      param("μ", "Вязкость", "viscosity", "Pa*s", false, 1.44e-3),
      param("ct", "Общая сжимаемость", "compressibility", "1/Pa", false, 1.3e-4 / ATM),
      param("rw", "Радиус скважины", "length", "m", false, 0.108),
    ],
    formulas: [
      formula("k", "Проницаемость", "= q * B * μ * LN(10) / (4 * PI() * m * h)", "permeability", "m2"),
      formula("s", "Скин-фактор", "= 1,151 * ((p1h - pwf) / m - LG(k * 3600 / (φ * μ * ct * rw^2)) + 0,3513)", "none", "-"),
      formula("dps", "Потери давления на скине", "= 0,87 * m * s", "pressure", "Pa"),
    ],
  };
}
