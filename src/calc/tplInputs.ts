/**
 * Значения параметров шаблона для строки калькулятора.
 *
 * Схема (для каждого параметра, всё в СИ):
 *   общий параметр        → values.common[sym] ?? default
 *   своё значение строки  → values.rows[rowId][sym]                     (origin "own")
 *   источник:
 *     manual   → default                                                 (origin "default")
 *     line     → прямая на графике исследования (выбранная или последняя) (origin "linked")
 *     table    → давление/время анализируемого периода                  (origin "linked")
 *     study    → дебит перед изменением режима, время работы tp          (origin "linked")
 *     template → результат другого шаблона для той же строки            (origin "linked")
 *   Строки, не связанные с исследованием (свои строки), берут только default и свои значения.
 *
 * Значение с графика считается в единицах графика (первая единица величины: атм, ч, м³/сут …).
 */
import type { CalcTemplate, ChartDef, LineDef, ParamSource, Project, Study, TplParam, TplValues } from "../core/types";
import { UNITS, toSI } from "../core/units";
import { fromAxis, toAxis } from "../charts/geometry";
import { computeSheet } from "../core/sheet";
import { baseData, producingTime, rateEvents, representativeRate } from "../core/welltest";
import { evalTemplate } from "../core/calcTemplate";

export type Origin = "own" | "linked" | "default" | "common" | "missing";

/** Значение параметра и откуда оно взято. */
export interface ParamValue {
  si: number;
  origin: Origin;
  /** Пояснение: какая прямая, почему нет значения. */
  note: string;
}

/** Пустые значения калькулятора для шаблона. */
export function emptyValues(): TplValues {
  return { common: {}, rows: {}, lines: {}, custom: [], units: {} };
}

/**
 * Прямые исследования, подходящие под источник (по виду осей графика).
 * @param project проект
 * @param study исследование
 * @param src источник «прямая»
 * @returns пары график–прямая (прямые, заданные двумя точками)
 */
export function candidateLines(project: Project, study: Study, src: Extract<ParamSource, { kind: "line" }>): { chart: ChartDef; line: LineDef }[] {
  const fit = (c: ChartDef): boolean =>
    src.axes === "any" ||
    (src.axes === "loglog" && c.xLog && c.yLog) ||
    (src.axes === "semilog" && c.xLog && !c.yLog) ||
    (src.axes === "linear" && !c.xLog && !c.yLog);
  return project.charts
    .filter((c) => c.studyId === study.id && fit(c))
    .flatMap((c) => c.lines.filter((l) => l.p1 && l.p2 && !l.curve).map((l) => ({ chart: c, line: l })));
}

/**
 * Величина прямой в единицах графика.
 * @param line прямая (точки в координатах осей: lg для логарифмических)
 * @param chart график прямой
 * @param src что брать
 * @returns значение или NaN
 */
export function lineValue(line: LineDef, chart: ChartDef, src: Extract<ParamSource, { kind: "line" }>): number {
  if (!line.p1 || !line.p2) return Number.NaN;
  const dx = line.p2.x - line.p1.x;
  if (dx === 0) return Number.NaN;
  const a = (line.p2.y - line.p1.y) / dx;
  const b = line.p1.y - a * line.p1.x;
  let v = Number.NaN;
  if (src.what === "slope") v = a;
  else if (src.what === "intercept") v = fromAxis(b, chart.yLog);
  else if (src.what === "yAtX") v = fromAxis(a * toAxis(src.at, chart.xLog) + b, chart.yLog);
  else if (a !== 0) v = fromAxis((toAxis(src.at, chart.yLog) - b) / a, chart.xLog);
  return src.abs ? Math.abs(v) : v;
}

/** Значение «в единицах графика» → СИ (единица графика = первая единица величины). */
function chartToSI(v: number, p: TplParam): number {
  if (p.dim === "none") return v;
  const key = UNITS[p.dim][0]?.key ?? "";
  return toSI(v, p.dim, key);
}

/**
 * Значение из таблицы исследования (анализируемый период).
 * @param study исследование
 * @param what что брать
 * @returns значение в СИ или NaN
 */
function tableValue(study: Study, what: Extract<ParamSource, { kind: "table" }>["what"]): number {
  const b = baseData(study, computeSheet(study));
  const idx = b.dt_s.map((d, i) => (d >= -1e-9 ? i : -1)).filter((i) => i >= 0);
  const ps = idx.map((i) => b.p_Pa[i] ?? Number.NaN).filter(Number.isFinite);
  if (ps.length === 0) return Number.NaN;
  switch (what) {
    case "pFirst":
      return ps[0] ?? Number.NaN;
    case "pLast":
      return ps[ps.length - 1] ?? Number.NaN;
    case "pMin":
      return Math.min(...ps);
    case "pMax":
      return Math.max(...ps);
    case "dtLast":
      return b.dt_s[idx[idx.length - 1] ?? -1] ?? Number.NaN;
  }
}

/**
 * Значения всех параметров шаблона для строки.
 * @param tpl шаблон
 * @param rowId id строки (id исследования или своей строки)
 * @param study исследование строки (null — своя строка)
 * @param project проект (графики, прямые, другие шаблоны)
 * @param depth глубина ссылок на другие шаблоны (защита от зацикливания)
 * @returns sym → значение
 */
export function resolveInputs(tpl: CalcTemplate, rowId: string, study: Study | null, project: Project, depth = 0): Record<string, ParamValue> {
  const values = project.calc.tplValues?.[tpl.id] ?? emptyValues();
  const out: Record<string, ParamValue> = {};
  for (const p of tpl.params) {
    if (!p.perStudy) {
      const c = values.common[p.sym];
      out[p.sym] = c !== undefined && Number.isFinite(c) ? { si: c, origin: "common", note: "" } : { si: p.default, origin: Number.isFinite(p.default) ? "common" : "missing", note: "" };
      continue;
    }
    const own = values.rows[rowId]?.[p.sym];
    if (own !== undefined && Number.isFinite(own)) {
      out[p.sym] = { si: own, origin: "own", note: "своё значение" };
      continue;
    }
    const def: ParamValue = Number.isFinite(p.default) ? { si: p.default, origin: "default", note: "по умолчанию" } : { si: Number.NaN, origin: "missing", note: "введите значение" };
    const src = p.source;
    if (src.kind === "manual" || !study) {
      out[p.sym] = def;
      continue;
    }
    if (src.kind === "line") {
      const cands = candidateLines(project, study, src);
      const chosen = values.lines[rowId]?.[p.sym];
      const pick = cands.find((c) => c.line.id === chosen) ?? cands[cands.length - 1];
      const v = pick ? lineValue(pick.line, pick.chart, src) : Number.NaN;
      out[p.sym] = Number.isFinite(v)
        ? { si: chartToSI(v, p), origin: "linked", note: `${pick?.chart.name ?? ""} · ${pick?.line.name ?? ""}` }
        : { ...def, origin: Number.isFinite(def.si) ? "default" : "missing", note: "нет подходящей прямой" };
      continue;
    }
    let v = Number.NaN;
    let note = "";
    if (src.kind === "table") {
      v = tableValue(study, src.what);
      note = "из таблицы исследования";
    } else if (src.kind === "study") {
      if (src.what === "rate") v = representativeRate(study);
      else {
        const b = baseData(study, computeSheet(study));
        v = producingTime(study, rateEvents(study, b), b);
      }
      note = "из исследования";
    } else if (src.kind === "template") {
      const other = project.calc.templates?.find((t) => t.id === src.templateId);
      if (other && other.id !== tpl.id && depth < 4) {
        const res = evalTemplate(other, Object.fromEntries(Object.entries(resolveInputs(other, rowId, study, project, depth + 1)).map(([k, x]) => [k, x.si])));
        v = res.values[src.sym] ?? Number.NaN;
        note = `из шаблона «${other.name}»`;
      } else note = "шаблон не найден";
    }
    out[p.sym] = Number.isFinite(v) ? { si: v, origin: "linked", note } : { ...def, note: note || def.note };
  }
  return out;
}
