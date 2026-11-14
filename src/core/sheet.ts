/**
 * Вычисление таблицы исследования.
 *
 * Схема:
 *   Study.columns[].cells (строки) ──computeSheet()──► Sheet
 *        Sheet.value(col,row)   — вычисленное значение ячейки (формулы, ƒx-столбцы, даты)
 *        Sheet.numeric(colId)   — столбец чисел (NaN для пустых/ошибок)
 *        Sheet.display(col,row) — текст для отображения в таблице
 *
 * Ячейка вычисляется лениво с мемоизацией; циклические ссылки дают ошибку #ЦИКЛ.
 * Даты (столбец «Дата и время») переводятся в секунды от 1970-01-01 (UTC).
 */
import type { Column, Study } from "./types";
import { evaluate, isError, parse, parseUserNumber, FormulaError, type Node, type Value } from "./formula";

export interface Sheet {
  rowCount: number;
  value(col: number, row: number): Value;
  numeric(columnId: string): Float64Array;
  display(col: number, row: number): string;
  /** Текст ошибки, если ячейка — ошибочная формула. */
  errorAt(col: number, row: number): string | null;
}

const DATE_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?)?$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/;

/**
 * Разобрать дату/время в секунды от эпохи.
 * Форматы: ДД.ММ.ГГГГ [чч:мм[:сс]] и ГГГГ-ММ-ДД[ чч:мм[:сс]].
 * @param s строка с датой
 * @returns секунды (UTC) или null
 */
export function parseDateTime(s: string): number | null {
  const t = s.trim();
  let y: number, mo: number, d: number, h = 0, mi = 0, sec = 0;
  let m = DATE_RE.exec(t);
  if (m) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
    if (y < 100) y += 2000;
  } else {
    m = ISO_RE.exec(t);
    if (!m) return null;
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  }
  if (m[4] !== undefined) h = Number(m[4]);
  if (m[5] !== undefined) mi = Number(m[5]);
  if (m[6] !== undefined) sec = Number(m[6].replace(",", "."));
  return Date.UTC(y, mo - 1, d, h, mi) / 1000 + sec;
}

/**
 * Форматировать число для таблицы.
 * @param v число
 * @returns строка с разумным числом значащих цифр
 */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(4);
  return String(Number(v.toPrecision(7)));
}

/**
 * Построить вычисляемую таблицу для исследования.
 * @param study исследование
 * @returns объект Sheet с ленивым вычислением
 */
export function computeSheet(study: Study): Sheet {
  const cols = study.columns;
  const rowCount = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const nameIndex = new Map<string, number>();
  cols.forEach((c, i) => nameIndex.set(c.name.trim().toLowerCase(), i));

  const memo: (Value | undefined)[][] = cols.map(() => new Array<Value | undefined>(rowCount));
  const busy: Uint8Array[] = cols.map(() => new Uint8Array(rowCount));
  const astCache = new Map<string, Node | FormulaError>();

  const getAst = (text: string): Node | FormulaError => {
    let a = astCache.get(text);
    if (!a) {
      try {
        a = parse(text);
      } catch (e) {
        a = e instanceof FormulaError ? e : new FormulaError(String(e));
      }
      astCache.set(text, a);
    }
    return a;
  };

  const rawOf = (c: Column, row: number): string => {
    const raw = c.cells[row] ?? "";
    if (raw.trim() === "" && c.formula && c.formula.trim() !== "") return c.formula;
    return raw;
  };

  function value(col: number, row: number): Value {
    const c = cols[col];
    if (!c || row < 0 || row >= rowCount) return null;
    const colMemo = memo[col];
    const colBusy = busy[col];
    if (!colMemo || !colBusy) return null;
    const cached = colMemo[row];
    if (cached !== undefined) return cached;
    if (colBusy[row]) return { error: "#ЦИКЛ" };
    colBusy[row] = 1;
    let v: Value;
    const raw = rawOf(c, row);
    if (raw.startsWith("=")) {
      const ast = getAst(raw);
      v =
        ast instanceof FormulaError
          ? { error: "#ОШИБКА" }
          : evaluate(ast, {
              row,
              rowCount,
              cell: value,
              columnByName: (n) => nameIndex.get(n.trim().toLowerCase()) ?? -1,
            });
    } else if (raw.trim() === "") {
      v = null;
    } else if (c.quantity === "datetime") {
      v = parseDateTime(raw) ?? raw;
    } else {
      v = parseUserNumber(raw) ?? raw;
    }
    colBusy[row] = 0;
    colMemo[row] = v;
    return v;
  }

  const numericCache = new Map<string, Float64Array>();
  function numeric(columnId: string): Float64Array {
    const hit = numericCache.get(columnId);
    if (hit) return hit;
    const ci = cols.findIndex((c) => c.id === columnId);
    const out = new Float64Array(rowCount).fill(Number.NaN);
    if (ci >= 0) {
      for (let r = 0; r < rowCount; r++) {
        const v = value(ci, r);
        if (typeof v === "number") out[r] = v;
        else if (typeof v === "boolean") out[r] = v ? 1 : 0;
      }
    }
    numericCache.set(columnId, out);
    return out;
  }

  function display(col: number, row: number): string {
    const c = cols[col];
    if (!c) return "";
    const v = value(col, row);
    if (v === null) return "";
    if (isError(v)) return v.error;
    if (typeof v === "boolean") return v ? "ИСТИНА" : "ЛОЖЬ";
    if (typeof v === "number") {
      if (c.quantity === "datetime" && !rawOf(c, row).startsWith("=")) return rawOf(c, row);
      return fmtNum(v);
    }
    return v;
  }

  function errorAt(col: number, row: number): string | null {
    const v = value(col, row);
    if (!isError(v)) return null;
    const c = cols[col];
    if (!c) return v.error;
    const raw = rawOf(c, row);
    const ast = raw.startsWith("=") ? getAst(raw) : null;
    return ast instanceof FormulaError ? ast.message : v.error;
  }

  return { rowCount, value, numeric, display, errorAt };
}

/** Результат разбора вставленного текста. */
export interface ParsedPaste {
  headers: string[] | null;
  rows: string[][];
  delimiter: string;
}

/**
 * Определить разделитель столбцов в тексте.
 * @param text вставленный текст
 * @returns "\t", ";", "," или " "
 */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const count = (ch: string): number => sample.split(ch).length - 1;
  if (count("\t") > 0) return "\t";
  if (count(";") > 0) return ";";
  const lines = sample.split("\n").filter((l) => l.trim() !== "");
  const commas = lines.map((l) => l.split(",").length - 1);
  const first = commas[0] ?? 0;
  if (first > 0 && commas.every((c) => c === first)) return ",";
  return " ";
}

/**
 * Разобрать текст из буфера обмена в таблицу.
 * @param text текст (строки через перевод строки)
 * @param delimiter разделитель или "auto"
 * @param headerRow первая (после пропуска) строка — заголовки
 * @param skip сколько строк пропустить сверху
 * @returns заголовки и строки значений
 */
export function parsePasted(text: string, delimiter: string, headerRow: boolean, skip: number): ParsedPaste {
  const delim = delimiter === "auto" ? detectDelimiter(text) : delimiter;
  const lines = text
    .split(/\r?\n/)
    .slice(skip)
    .filter((l) => l.trim() !== "");
  const split = (l: string): string[] =>
    delim === " " ? l.trim().split(/\s+/) : l.split(delim).map((s) => s.trim());
  const all = lines.map(split);
  // Дата и время, разделённые пробелом, при разделителе-пробеле склеиваем обратно.
  if (delim === " ") {
    for (const r of all) {
      const a = r[0];
      const b = r[1];
      if (a !== undefined && b !== undefined && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(a) && /^\d{1,2}:\d{2}/.test(b)) {
        r.splice(0, 2, `${a} ${b}`);
      }
    }
  }
  if (headerRow && all.length > 0) {
    const [h, ...rows] = all;
    return { headers: h ?? null, rows, delimiter: delim };
  }
  return { headers: null, rows: all, delimiter: delim };
}
