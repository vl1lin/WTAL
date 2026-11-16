/**
 * Пользовательские шаблоны расчётов калькулятора.
 *
 * Схема:
 *   CalcTemplate { params[], formulas[] }
 *   ├─ checkTemplate(tpl)            → список проблем (обозначения, неизвестные имена, порядок формул)
 *   ├─ compileFormula(expr, known)   → Node (AST формулы таблицы) — обозначения заменяются на [sym]
 *   └─ evalTemplate(tpl, inputs_SI)  → значения формул в СИ и ошибки
 *        параметр: СИ → единица параметра → подстановка в формулу
 *        формула:  результат в единице формулы → СИ
 *
 * Язык формул — тот же, что в столбцах ƒx (core/formula.ts): + - * / ^, SQRT LN LG EXP ABS PI MIN MAX …
 * Десятичный разделитель — запятая или точка; аргументы функций — через «;».
 */
import { evaluate, isError, parse, FormulaError, type Node } from "./formula";
import { fromSI, toSI, type Dimension } from "./units";
import type { CalcTemplate, TplFormula, TplParam } from "./types";

/** Допустимое обозначение: буква (латиница, кириллица, греческий) или «_», затем буквы, цифры, «_». */
export const SYM_RE = /^[A-Za-zА-Яа-яЁёΑ-Ωα-ω_][A-Za-zА-Яа-яЁёΑ-Ωα-ω_0-9]*$/;
const ID_RE = /[A-Za-zА-Яа-яЁёΑ-Ωα-ω_][A-Za-zА-Яа-яЁёΑ-Ωα-ω_0-9]*/g;

/**
 * Привести текст формулы к языку таблицы: «=» в начале не обязателен, «·×» → «*», «−» → «-»,
 * десятичная запятая между цифрами → точка, обозначения → [sym].
 * @param expr формула пользователя
 * @param known известные обозначения
 * @returns текст для parse() и неизвестные имена
 */
export function prepareFormula(expr: string, known: ReadonlySet<string>): { text: string; unknown: string[] } {
  let t = expr.trim().replace(/^=/, "");
  t = t.replace(/[·×]/g, "*").replace(/[−–]/g, "-").replace(/(\d),(\d)/g, "$1.$2");
  const unknown: string[] = [];
  let out = "";
  let last = 0;
  for (const m of t.matchAll(ID_RE)) {
    const s = m.index;
    const id = m[0];
    const prev = t[s - 1] ?? "";
    // Часть числа (1e-5, 2.5E3) или имя функции перед «(» — не обозначение.
    if (/[0-9.]/.test(prev) && /^[eE]\d*$/.test(id)) continue;
    const after = t.slice(s + id.length).trimStart();
    if (after.startsWith("(")) continue;
    out += t.slice(last, s);
    if (known.has(id)) out += `[${id}]`;
    else {
      out += id;
      if (!unknown.includes(id)) unknown.push(id);
    }
    last = s + id.length;
  }
  out += t.slice(last);
  return { text: out, unknown };
}

/**
 * Разобрать формулу шаблона.
 * @param expr текст формулы
 * @param known обозначения, доступные этой формуле
 * @returns AST или текст ошибки
 */
export function compileFormula(expr: string, known: ReadonlySet<string>): Node | string {
  if (!expr.trim() || expr.trim() === "=") return "Пустая формула";
  const { text, unknown } = prepareFormula(expr, known);
  if (unknown.length > 0) return `Неизвестное обозначение: ${unknown.join(", ")}`;
  try {
    return parse(text);
  } catch (e) {
    return e instanceof FormulaError ? e.message : "Ошибка в формуле";
  }
}

/** Проблема шаблона: к какому обозначению относится и текст. */
export interface TplIssue {
  id: string;
  text: string;
}

/**
 * Проверить шаблон: обозначения, их уникальность и формулы (ссылаться можно только на то, что выше).
 * @param tpl шаблон
 * @returns проблемы (пусто — шаблон корректен)
 */
export function checkTemplate(tpl: CalcTemplate): TplIssue[] {
  const issues: TplIssue[] = [];
  const seen = new Set<string>();
  const all = new Set([...tpl.params.map((p) => p.sym), ...tpl.formulas.map((f) => f.sym)]);
  for (const item of [...tpl.params, ...tpl.formulas]) {
    if (!SYM_RE.test(item.sym)) issues.push({ id: item.id, text: `«${item.sym}»: обозначение — буквы, цифры и «_», начинается с буквы` });
    else if (seen.has(item.sym)) issues.push({ id: item.id, text: `«${item.sym}» встречается дважды` });
    seen.add(item.sym);
  }
  const known = new Set(tpl.params.map((p) => p.sym));
  for (const f of tpl.formulas) {
    const r = compileFormula(f.expr, known);
    if (typeof r === "string") {
      const later = prepareFormula(f.expr, known).unknown.filter((u) => all.has(u));
      issues.push({ id: f.id, text: later.length > 0 ? `${f.sym}: ${later.join(", ")} — ниже по списку, перенесите формулу выше` : `${f.sym}: ${r}` });
    }
    known.add(f.sym);
  }
  return issues;
}

/** Значение в единице параметра/формулы ↔ СИ (для «—» без пересчёта). */
const toUnit = (si: number, dim: Dimension, unit: string): number => (dim === "none" ? si : fromSI(si, dim, unit));
const fromUnit = (v: number, dim: Dimension, unit: string): number => (dim === "none" ? v : toSI(v, dim, unit));

/** Результат вычисления шаблона для одной строки. */
export interface TplResult {
  /** sym → значение в СИ (NaN — не посчитано). */
  values: Record<string, number>;
  /** sym → текст ошибки. */
  errors: Record<string, string>;
}

/**
 * Посчитать шаблон.
 * @param tpl шаблон
 * @param inputs sym параметра → значение в СИ (NaN — нет значения)
 * @returns значения параметров и формул в СИ и ошибки формул
 */
export function evalTemplate(tpl: CalcTemplate, inputs: Record<string, number>): TplResult {
  const syms: string[] = [];
  const vals: number[] = []; // в единицах формул
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const ctx = {
    row: 0,
    rowCount: 1,
    cell: (col: number) => (Number.isFinite(vals[col] ?? Number.NaN) ? (vals[col] ?? null) : { error: "#НЕТ" }),
    columnByName: (name: string) => syms.indexOf(name),
  };
  const missing = new Set<string>();
  for (const p of tpl.params) {
    const si = inputs[p.sym] ?? Number.NaN;
    syms.push(p.sym);
    vals.push(Number.isFinite(si) ? toUnit(si, p.dim, p.unit) : Number.NaN);
    values[p.sym] = si;
    if (!Number.isFinite(si)) missing.add(p.sym);
  }
  const known = new Set(syms);
  for (const f of tpl.formulas) {
    const node = compileFormula(f.expr, known);
    let v = Number.NaN;
    if (typeof node === "string") errors[f.sym] = node;
    else {
      const r = evaluate(node, ctx);
      if (typeof r === "number" && Number.isFinite(r)) v = r;
      else {
        const need = prepareFormula(f.expr, known).text.match(/\[([^\]]+)\]/g)?.map((x) => x.slice(1, -1)).filter((x) => missing.has(x)) ?? [];
        errors[f.sym] = need.length > 0 ? `нет значения: ${[...new Set(need)].join(", ")}` : isError(r) ? r.error : "не число";
        missing.add(f.sym);
      }
    }
    syms.push(f.sym);
    vals.push(v);
    known.add(f.sym);
    values[f.sym] = Number.isFinite(v) ? fromUnit(v, f.dim, f.unit) : Number.NaN;
  }
  return { values, errors };
}

/**
 * Итог по группе.
 * @param xs значения (NaN пропускаются)
 * @param agg вид итога
 * @returns итог или NaN
 */
export function aggregate(xs: number[], agg: TplFormula["agg"]): number {
  const v = xs.filter(Number.isFinite);
  if (v.length === 0 || agg === "none") return Number.NaN;
  if (agg === "sum") return v.reduce((a, b) => a + b, 0);
  if (agg === "min") return Math.min(...v);
  if (agg === "max") return Math.max(...v);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Подпись единицы параметра/формулы. */
export function itemUnitLabel(p: Pick<TplParam, "dim" | "unit" | "unitText">, label: (dim: Dimension, key: string) => string): string {
  return p.dim === "none" ? (p.unitText ?? "") : label(p.dim, p.unit);
}
