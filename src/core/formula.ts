/**
 * Excel-подобные формулы.
 *
 * Схема:
 *   текст "=SQRT([Время])+B2"
 *     └─ tokenize() → Token[]
 *          └─ parse() → Node (AST)
 *               ├─ evaluate(node, ctx) → Value       — вычисление в контексте таблицы
 *               └─ shiftFormula(text, dRow, dCol)     — сдвиг относительных ссылок (протяжка/копирование)
 *
 * Поддерживается:
 *   числа (десятичная точка), строки "…", ссылки A1 / $A$1, диапазоны A1:B10,
 *   ссылки на столбцы по имени [Имя] и со смещением строки [Имя]@-1,
 *   операторы + - * / ^ & = <> < > <= >=, унарный минус, проценты,
 *   функции SQRT LN LOG10 (LG) LOG EXP POW POWER ABS ROUND MIN MAX SUM AVERAGE COUNT IF AND OR NOT
 *   PI ROW DIFF FIRST LAST. Разделитель аргументов — «;» или «,».
 */

export type ErrorValue = { error: string };
export type Value = number | string | boolean | ErrorValue | null;

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; col: number; row: number; colAbs: boolean; rowAbs: boolean }
  | { t: "range"; a: Extract<Node, { t: "ref" }>; b: Extract<Node, { t: "ref" }> }
  | { t: "colref"; name: string; offset: number }
  | { t: "un"; op: "-" | "+" | "%"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

type Token =
  | { k: "num"; v: number; s: number; e: number }
  | { k: "str"; v: string; s: number; e: number }
  | { k: "ref"; v: string; s: number; e: number }
  | { k: "colref"; name: string; offset: number; s: number; e: number }
  | { k: "id"; v: string; s: number; e: number }
  | { k: "op"; v: string; s: number; e: number };

export class FormulaError extends Error {}

/**
 * Номер столбца → буквы (0 → A, 25 → Z, 26 → AA).
 * @param index индекс столбца с нуля
 * @returns буквенное обозначение
 */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Буквы → индекс столбца (A → 0).
 * @param letters буквенное обозначение столбца
 * @returns индекс с нуля
 */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const REF_RE = /^\$?[A-Za-z]{1,3}\$?\d+/;

/**
 * Разбить формулу на токены.
 * @param src текст формулы без ведущего «=»
 * @returns список токенов с позициями в исходной строке
 */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError("Неверное число");
      out.push({ k: "num", v: Number(m[0]), s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError("Не закрыта кавычка");
      out.push({ k: "str", v: src.slice(i + 1, end), s: i, e: end + 1 });
      i = end + 1;
      continue;
    }
    if (ch === "[") {
      const end = src.indexOf("]", i + 1);
      if (end < 0) throw new FormulaError("Не закрыта скобка ]");
      const name = src.slice(i + 1, end).trim();
      let j = end + 1;
      let offset = 0;
      const m = /^@([+-]?\d+)/.exec(src.slice(j));
      if (m && m[1] !== undefined) {
        offset = Number(m[1]);
        j += m[0].length;
      }
      out.push({ k: "colref", name, offset, s: i, e: j });
      i = j;
      continue;
    }
    const refm = REF_RE.exec(src.slice(i));
    if (refm && !/[A-Za-z0-9_(]/.test(src[i + refm[0].length] ?? "")) {
      out.push({ k: "ref", v: refm[0], s: i, e: i + refm[0].length });
      i += refm[0].length;
      continue;
    }
    const idm = /^[A-Za-zА-Яа-я_][A-Za-zА-Яа-я0-9_.]*/.exec(src.slice(i));
    if (idm) {
      out.push({ k: "id", v: idm[0].toUpperCase(), s: i, e: i + idm[0].length });
      i += idm[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ k: "op", v: two, s: i, e: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>(),;:%".includes(ch)) {
      out.push({ k: "op", v: ch, s: i, e: i + 1 });
      i++;
      continue;
    }
    throw new FormulaError(`Неожиданный символ «${ch}»`);
  }
  return out;
}

/**
 * Разобрать ссылку вида $A$1.
 * @param s текст ссылки
 * @returns узел ref (row — индекс строки с нуля)
 */
function parseRef(s: string): Extract<Node, { t: "ref" }> {
  const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(s);
  if (!m) throw new FormulaError(`Неверная ссылка ${s}`);
  return {
    t: "ref",
    colAbs: m[1] === "$",
    col: colIndex(m[2] ?? "A"),
    rowAbs: m[3] === "$",
    row: Number(m[4]) - 1,
  };
}

/**
 * Разобрать формулу в дерево.
 * @param text формула; ведущий «=» допускается
 * @returns корень AST
 * @throws FormulaError при синтаксической ошибке
 */
export function parse(text: string): Node {
  const src = text.startsWith("=") ? text.slice(1) : text;
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Token | undefined => toks[p];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t !== undefined && t.k === "op" && t.v === v;
  };
  const expect = (v: string): void => {
    if (!isOp(v)) throw new FormulaError(`Ожидалось «${v}»`);
    p++;
  };

  const levels: string[][] = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"]];

  function parseLevel(level: number): Node {
    if (level >= levels.length) return parsePow();
    let a = parseLevel(level + 1);
    for (;;) {
      const t = peek();
      const ops = levels[level] ?? [];
      if (t && t.k === "op" && ops.includes(t.v)) {
        p++;
        const b = parseLevel(level + 1);
        a = { t: "bin", op: t.v, a, b };
      } else return a;
    }
  }
  function parsePow(): Node {
    const a = parseUnary();
    if (isOp("^")) {
      p++;
      return { t: "bin", op: "^", a, b: parsePow() };
    }
    return a;
  }
  function parseUnary(): Node {
    if (isOp("-")) {
      p++;
      return { t: "un", op: "-", a: parseUnary() };
    }
    if (isOp("+")) {
      p++;
      return parseUnary();
    }
    let a = parsePrimary();
    while (isOp("%")) {
      p++;
      a = { t: "un", op: "%", a };
    }
    return a;
  }
  function parsePrimary(): Node {
    const t = peek();
    if (!t) throw new FormulaError("Неожиданный конец формулы");
    p++;
    switch (t.k) {
      case "num":
        return { t: "num", v: t.v };
      case "str":
        return { t: "str", v: t.v };
      case "colref":
        return { t: "colref", name: t.name, offset: t.offset };
      case "ref": {
        const a = parseRef(t.v);
        if (isOp(":")) {
          p++;
          const nt = peek();
          if (!nt || nt.k !== "ref") throw new FormulaError("Ожидалась ссылка после «:»");
          p++;
          return { t: "range", a, b: parseRef(nt.v) };
        }
        return a;
      }
      case "id": {
        if (isOp("(")) {
          p++;
          const args: Node[] = [];
          if (!isOp(")")) {
            for (;;) {
              args.push(parseLevel(0));
              if (isOp(";") || isOp(",")) {
                p++;
                continue;
              }
              break;
            }
          }
          expect(")");
          return { t: "call", name: t.v, args };
        }
        if (t.v === "TRUE" || t.v === "ИСТИНА") return { t: "bool", v: true };
        if (t.v === "FALSE" || t.v === "ЛОЖЬ") return { t: "bool", v: false };
        throw new FormulaError(`Неизвестное имя ${t.v}`);
      }
      case "op":
        if (t.v === "(") {
          const e = parseLevel(0);
          expect(")");
          return e;
        }
        throw new FormulaError(`Неожиданный оператор «${t.v}»`);
    }
  }

  const root = parseLevel(0);
  if (p < toks.length) throw new FormulaError("Лишние символы в формуле");
  return root;
}

/** Контекст вычисления: доступ к ячейкам таблицы. */
export interface EvalContext {
  /** Текущая строка (с нуля). */
  row: number;
  /** Число строк таблицы. */
  rowCount: number;
  /** Значение ячейки (col,row с нуля). */
  cell(col: number, row: number): Value;
  /** Индекс столбца по имени или -1. */
  columnByName(name: string): number;
}

export const isError = (v: Value): v is ErrorValue =>
  typeof v === "object" && v !== null && "error" in v;

/**
 * Привести значение к числу.
 * @param v значение
 * @returns число или ошибка
 */
function num(v: Value): number | ErrorValue {
  if (isError(v)) return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : { error: "#ЗНАЧ" };
}

/**
 * Значения диапазона/ссылки/выражения в виде плоского списка (для SUM, MIN …).
 * @param node аргумент функции
 * @param ctx контекст
 * @returns список значений
 */
function flatten(node: Node, ctx: EvalContext): Value[] {
  if (node.t === "range") {
    const c0 = Math.min(node.a.col, node.b.col);
    const c1 = Math.max(node.a.col, node.b.col);
    const r0 = Math.min(node.a.row, node.b.row);
    const r1 = Math.max(node.a.row, node.b.row);
    const out: Value[] = [];
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(ctx.cell(c, r));
    return out;
  }
  return [evaluate(node, ctx)];
}

/**
 * Вычислить значение аргумента в другой строке (для DIFF/FIRST/LAST).
 * Сдвигаются ссылки [Имя] и относительные ссылки A1.
 */
function evalAtRow(node: Node, ctx: EvalContext, row: number): Value {
  return evaluate(node, { ...ctx, row, cell: ctx.cell, columnByName: ctx.columnByName }, row - ctx.row);
}

const unaryMath: Record<string, (x: number) => number> = {
  SQRT: Math.sqrt,
  LN: Math.log,
  LOG10: Math.log10,
  LG: Math.log10,
  EXP: Math.exp,
  ABS: Math.abs,
};

/**
 * Вычислить узел формулы.
 * @param node узел AST
 * @param ctx контекст таблицы
 * @param rowShift сдвиг относительных ссылок (используется DIFF/FIRST/LAST)
 * @returns значение: число, строка, логическое или ошибка
 */
export function evaluate(node: Node, ctx: EvalContext, rowShift = 0): Value {
  switch (node.t) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "bool":
      return node.v;
    case "ref": {
      const r = node.rowAbs ? node.row : node.row + rowShift;
      if (r < 0 || r >= ctx.rowCount) return { error: "#ССЫЛКА" };
      return ctx.cell(node.col, r);
    }
    case "range":
      return { error: "#ЗНАЧ" };
    case "colref": {
      const c = ctx.columnByName(node.name);
      if (c < 0) return { error: `#ИМЯ [${node.name}]` };
      const r = ctx.row + node.offset;
      if (r < 0 || r >= ctx.rowCount) return { error: "#ССЫЛКА" };
      return ctx.cell(c, r);
    }
    case "un": {
      const a = num(evaluate(node.a, ctx, rowShift));
      if (isError(a)) return a;
      return node.op === "-" ? -a : node.op === "%" ? a / 100 : a;
    }
    case "bin": {
      const av = evaluate(node.a, ctx, rowShift);
      const bv = evaluate(node.b, ctx, rowShift);
      if (node.op === "&") {
        if (isError(av)) return av;
        if (isError(bv)) return bv;
        return `${String(av ?? "")}${String(bv ?? "")}`;
      }
      const a = num(av);
      const b = num(bv);
      if (isError(a)) return a;
      if (isError(b)) return b;
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0 ? { error: "#ДЕЛ/0" } : a / b;
        case "^":
          return a ** b;
        case "=":
          return a === b;
        case "<>":
          return a !== b;
        case "<":
          return a < b;
        case ">":
          return a > b;
        case "<=":
          return a <= b;
        case ">=":
          return a >= b;
        default:
          return { error: "#ОП" };
      }
    }
    case "call":
      return callFn(node.name, node.args, ctx, rowShift);
  }
}

/**
 * Вызвать встроенную функцию.
 * @param name имя функции (в верхнем регистре)
 * @param args аргументы-узлы
 * @param ctx контекст
 * @param rowShift сдвиг относительных ссылок
 * @returns результат функции
 */
function callFn(name: string, args: Node[], ctx: EvalContext, rowShift: number): Value {
  const arg = (i: number): number | ErrorValue => {
    const a = args[i];
    if (!a) return { error: "#АРГ" };
    return num(evaluate(a, ctx, rowShift));
  };
  const unary = unaryMath[name];
  if (unary) {
    const x = arg(0);
    if (isError(x)) return x;
    const y = unary(x);
    return Number.isFinite(y) ? y : { error: "#ЧИСЛО" };
  }
  const nums = (): number[] | ErrorValue => {
    const out: number[] = [];
    for (const a of args) {
      for (const v of flatten(a, ctx)) {
        if (v === null || v === "") continue;
        const n = num(v);
        if (isError(n)) return n;
        out.push(n);
      }
    }
    return out;
  };
  switch (name) {
    case "PI":
      return Math.PI;
    case "ROW":
      return ctx.row + 1;
    case "POW":
    case "POWER": {
      const x = arg(0);
      const n = arg(1);
      if (isError(x)) return x;
      if (isError(n)) return n;
      return x ** n;
    }
    case "LOG": {
      const x = arg(0);
      if (isError(x)) return x;
      if (args.length < 2) return Math.log10(x);
      const b = arg(1);
      if (isError(b)) return b;
      return Math.log(x) / Math.log(b);
    }
    case "ROUND": {
      const x = arg(0);
      const n = args.length > 1 ? arg(1) : 0;
      if (isError(x)) return x;
      if (isError(n)) return n;
      const f = 10 ** n;
      return Math.round(x * f) / f;
    }
    case "SUM":
    case "MIN":
    case "MAX":
    case "AVERAGE":
    case "COUNT": {
      const xs = nums();
      if (!Array.isArray(xs)) return xs;
      if (name === "COUNT") return xs.length;
      if (name === "SUM") return xs.reduce((s, x) => s + x, 0);
      if (xs.length === 0) return { error: "#ДЕЛ/0" };
      if (name === "MIN") return Math.min(...xs);
      if (name === "MAX") return Math.max(...xs);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    }
    case "IF": {
      const c = arg(0);
      if (isError(c)) return c;
      const branch = c !== 0 ? args[1] : args[2];
      return branch ? evaluate(branch, ctx, rowShift) : false;
    }
    case "AND":
    case "OR": {
      const xs = nums();
      if (!Array.isArray(xs)) return xs;
      return name === "AND" ? xs.every((x) => x !== 0) : xs.some((x) => x !== 0);
    }
    case "NOT": {
      const x = arg(0);
      return isError(x) ? x : x === 0;
    }
    case "DIFF": {
      const a = args[0];
      if (!a) return { error: "#АРГ" };
      if (ctx.row + rowShift <= 0) return { error: "#Н/Д" };
      const cur = num(evaluate(a, ctx, rowShift));
      const prev = num(evalAtRow(a, ctx, ctx.row - 1));
      if (isError(cur)) return cur;
      if (isError(prev)) return prev;
      return cur - prev;
    }
    case "FIRST":
    case "LAST": {
      const a = args[0];
      if (!a) return { error: "#АРГ" };
      return evalAtRow(a, ctx, name === "FIRST" ? 0 : ctx.rowCount - 1);
    }
    default:
      return { error: `#ИМЯ ${name}` };
  }
}

/**
 * Сдвинуть относительные ссылки A1 в формуле (протяжка, копирование, вставка).
 * Абсолютные части ($A, $1) и ссылки [Имя] не меняются.
 * @param text исходная формула (с «=»)
 * @param dRow сдвиг строк
 * @param dCol сдвиг столбцов
 * @returns формула со сдвинутыми ссылками; при ошибке разбора — исходный текст
 */
export function shiftFormula(text: string, dRow: number, dCol: number): string {
  if (!text.startsWith("=")) return text;
  const body = text.slice(1);
  let toks: Token[];
  try {
    toks = tokenize(body);
  } catch {
    return text;
  }
  let out = "";
  let last = 0;
  for (const t of toks) {
    if (t.k !== "ref") continue;
    const r = parseRef(t.v);
    const col = r.colAbs ? r.col : r.col + dCol;
    const row = r.rowAbs ? r.row : r.row + dRow;
    const repl =
      col < 0 || row < 0
        ? "#ССЫЛКА"
        : `${r.colAbs ? "$" : ""}${colLetter(col)}${r.rowAbs ? "$" : ""}${row + 1}`;
    out += body.slice(last, t.s) + repl;
    last = t.e;
  }
  return "=" + out + body.slice(last);
}

/**
 * Разобрать число, введённое пользователем (допускается запятая, пробелы-разделители).
 * @param s строка
 * @returns число или null, если строка не число
 */
export function parseUserNumber(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
