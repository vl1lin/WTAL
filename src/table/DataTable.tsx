/**
 * Таблица данных исследования в стиле Excel.
 *
 * Схема:
 *   DataTable(study)
 *   ├─ панель: число строк, выделение, «+ Пустой столбец», «+ Столбец ƒx», «Построить по выделенному»
 *   ├─ строка формулы: адрес ячейки + содержимое (правка → store.setCell)
 *   ├─ сетка (виртуализация строк):
 *   │    буквы столбцов / имена+единицы (клик — сортировка, двойной клик — свойства)
 *   │    номера строк (клик — выделить строку, Shift — диапазон)
 *   │    ячейки: выбор диапазона мышью, ввод, F2/двойной клик — правка, Enter/Tab — перемещение,
 *   │            Delete — очистить, Ctrl+C/V — копировать/вставить, Ctrl+D и маркер — заполнить вниз
 *   └─ меню ПКМ: заполнить, копировать, вставить, очистить, вставить столбец/строку, свойства
 *
 * Переключатель «Давление | Дебиты» открывает одну из двух таблиц исследования (part = "p" | "q").
 * Выделение строк таблицы давления (несколько строк диапазона или номера строк) синхронизируется с графиками.
 * Сортировка — только порядок отображения: строки неразрывны, данные и формулы не переставляются.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Study } from "../core/types";
import { useApp } from "../store";
import { sheetOf } from "../charts/series";
import { rateSheetOf } from "../core/welltest";
import type { TablePart } from "../core/types";
import { uid } from "../core/factory";
import { colLetter, shiftFormula } from "../core/formula";
import { dimensionOfQuantity, unitLabel } from "../core/units";

const ROW_H = 24;
const COL_W = 108;
const HEAD_W = 46;

interface Cell {
  c: number;
  r: number;
}

export function DataTable({ study, part }: { study: Study; part: TablePart }) {
  const st = useApp.getState();
  const isP = part === "p";
  // Выделение строк связано с графиками только для таблицы давления.
  const selKey = isP ? study.id : `${study.id}:q`;
  const selRows = useApp((s) => s.selection[selKey]);
  const sheet = isP ? sheetOf(study) : rateSheetOf(study);
  const columns = isP ? study.columns : study.rateColumns;
  const nCols = columns.length;
  const nRows = Math.max(sheet.rowCount, 1);
  const [active, setActive] = useState<Cell>({ c: 0, r: 0 });
  const [anchor, setAnchor] = useState<Cell>({ c: 0, r: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; col: number } | null>(null);
  const [scroll, setScroll] = useState({ top: 0, h: 400 });
  const [barText, setBarText] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mouseDown = useRef<"cells" | "rows" | "fill" | null>(null);
  const [fillTo, setFillTo] = useState<number | null>(null);

  // Порядок отображения строк (индексы реальных строк).
  const order = useMemo(() => {
    const idx = Array.from({ length: nRows }, (_, i) => i);
    if (!sort) return idx;
    const col = columns[sort.col];
    if (!col) return idx;
    const v = sheet.numeric(col.id);
    return idx.sort((a, b) => {
      const va = v[a] ?? Number.NaN;
      const vb = v[b] ?? Number.NaN;
      if (Number.isNaN(va) && Number.isNaN(vb)) return a - b;
      if (Number.isNaN(va)) return 1;
      if (Number.isNaN(vb)) return -1;
      return (va - vb) * sort.dir || a - b;
    });
  }, [nRows, sort, columns, sheet]);
  const realRow = (d: number): number => order[d] ?? d;

  const selected = useMemo(() => new Set(selRows ?? []), [selRows]);
  const r0 = Math.min(active.r, anchor.r);
  const r1 = Math.max(active.r, anchor.r);
  const c0 = Math.min(active.c, anchor.c);
  const c1 = Math.max(active.c, anchor.c);
  const inRange = (c: number, d: number): boolean => c >= c0 && c <= c1 && d >= r0 && d <= r1;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Сброс при смене исследования.
  useEffect(() => {
    setActive({ c: 0, r: 0 });
    setAnchor({ c: 0, r: 0 });
    setEditing(null);
    setSort(null);
  }, [study.id]);

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 5);
  const last = Math.min(nRows - 1, Math.ceil((scroll.top + scroll.h) / ROW_H) + 5);

  const rawAt = (c: number, d: number): string => columns[c]?.cells[realRow(d)] ?? "";
  const activeRaw = rawAt(active.c, active.r);
  const activeCol = columns[active.c];
  const shownRaw = activeRaw === "" && activeCol?.formula ? activeCol.formula : activeRaw;

  /** Синхронизировать выделение строк с графиками. */
  const syncRows = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const rows: number[] = [];
    for (let d = lo; d <= hi; d++) rows.push(realRow(d));
    st.setSelection(selKey, rows);
  };

  const move = (dc: number, dr: number, extend: boolean): void => {
    const n = { c: Math.max(0, Math.min(nCols - 1, active.c + dc)), r: Math.max(0, Math.min(nRows, active.r + dr)) };
    setActive(n);
    if (!extend) setAnchor(n);
    scrollInto(n.r);
  };
  const scrollInto = (d: number): void => {
    const el = boxRef.current;
    if (!el) return;
    const y = d * ROW_H;
    const headH = 2 * ROW_H + 8;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + el.clientHeight - headH) el.scrollTop = y + ROW_H - el.clientHeight + headH;
  };

  const commit = (value: string, c = active.c, d = active.r): void => {
    st.setCell(study.id, c, realRow(d), value.trim() === "" ? "" : value, part);
  };

  /** Заполнить вниз: первая строка диапазона копируется в остальные со сдвигом ссылок. */
  const fillDown = (toD: number = r1): void => {
    if (sort) {
      alert("Снимите сортировку, чтобы заполнять ячейки вниз.");
      return;
    }
    const upd: { col: number; row: number; value: string }[] = [];
    for (let c = c0; c <= c1; c++) {
      const src = columns[c]?.cells[r0] ?? "";
      for (let r = r0 + 1; r <= toD; r++) upd.push({ col: c, row: r, value: shiftFormula(src, r - r0, 0) });
    }
    st.setCells(study.id, upd, part);
  };

  const clearRange = (): void => {
    const upd: { col: number; row: number; value: string }[] = [];
    for (let c = c0; c <= c1; c++) for (let d = r0; d <= r1; d++) upd.push({ col: c, row: realRow(d), value: "" });
    st.setCells(study.id, upd, part);
  };

  const copyRange = (): string => {
    const lines: string[] = [];
    for (let d = r0; d <= r1; d++) {
      const cells: string[] = [];
      for (let c = c0; c <= c1; c++) cells.push(sheet.display(c, realRow(d)));
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  };

  const pasteText = (text: string): void => {
    const rows = text.replace(/\r/g, "").split("\n");
    if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
    const upd: { col: number; row: number; value: string }[] = [];
    rows.forEach((line, i) => {
      line.split("\t").forEach((v, j) => {
        const c = active.c + j;
        if (c >= nCols) return;
        const d = active.r + i;
        const row = d < nRows ? realRow(d) : d;
        upd.push({ col: c, row, value: v });
      });
    });
    st.setCells(study.id, upd, part);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (editing !== null) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === "c" || e.key === "с")) {
      void navigator.clipboard?.writeText(copyRange());
      e.preventDefault();
      return;
    }
    if (ctrl && (e.key === "d" || e.key === "в")) {
      fillDown();
      e.preventDefault();
      return;
    }
    if (ctrl && (e.key === "a" || e.key === "ф")) {
      setAnchor({ c: 0, r: 0 });
      setActive({ c: nCols - 1, r: nRows - 1 });
      syncRows(0, nRows - 1);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowUp":
        move(0, -1, e.shiftKey);
        break;
      case "ArrowDown":
        move(0, 1, e.shiftKey);
        break;
      case "ArrowLeft":
        move(-1, 0, e.shiftKey);
        break;
      case "ArrowRight":
        move(1, 0, e.shiftKey);
        break;
      case "Tab":
        move(e.shiftKey ? -1 : 1, 0, false);
        break;
      case "Enter":
      case "F2":
        setEditing(shownRaw === activeRaw ? activeRaw : "");
        break;
      case "Delete":
      case "Backspace":
        clearRange();
        break;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) {
          setEditing(e.key);
          e.preventDefault();
          return;
        }
        return;
    }
    e.preventDefault();
  };

  const cellFromEvent = (e: React.MouseEvent): Cell | null => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
    if (!t) return null;
    return { c: Number(t.dataset.c), r: Number(t.dataset.r) };
  };

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest(".fill-handle")) {
      mouseDown.current = "fill";
      setFillTo(r1);
      e.preventDefault();
      return;
    }
    const rh = t.closest<HTMLElement>("[data-rowhead]");
    if (rh) {
      const d = Number(rh.dataset.rowhead);
      mouseDown.current = "rows";
      const a = e.shiftKey ? anchor : { c: 0, r: d };
      setAnchor({ c: 0, r: a.r });
      setActive({ c: nCols - 1, r: d });
      syncRows(a.r, d);
      boxRef.current?.focus();
      e.preventDefault();
      return;
    }
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (editing !== null) setEditing(null);
    mouseDown.current = "cells";
    setActive(cell);
    if (!e.shiftKey) setAnchor(cell);
    else if (anchor.r !== cell.r) syncRows(anchor.r, cell.r);
    boxRef.current?.focus();
  };
  const onMouseOver = (e: React.MouseEvent): void => {
    if (!mouseDown.current) return;
    if (mouseDown.current === "fill") {
      const cell = cellFromEvent(e);
      if (cell) setFillTo(Math.max(r1, cell.r));
      return;
    }
    const rh = (e.target as HTMLElement).closest<HTMLElement>("[data-rowhead]");
    const cell = cellFromEvent(e) ?? (rh ? { c: nCols - 1, r: Number(rh.dataset.rowhead) } : null);
    if (!cell) return;
    if (mouseDown.current === "rows") {
      setActive({ c: nCols - 1, r: cell.r });
      syncRows(anchor.r, cell.r);
    } else {
      setActive(cell);
      if (cell.r !== anchor.r) syncRows(anchor.r, cell.r);
    }
  };
  useEffect(() => {
    const up = (): void => {
      if (mouseDown.current === "fill" && fillTo !== null && fillTo > r1) fillDown(fillTo);
      mouseDown.current = null;
      setFillTo(null);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });

  const sortBy = (c: number): void => {
    setSort((s) => (!s || s.col !== c ? { col: c, dir: 1 } : s.dir === 1 ? { col: c, dir: -1 } : null));
  };

  const roleOf = (id: string): string => {
    if (!isP) return study.rateRoles.time === id ? "t" : study.rateRoles.rate === id ? "q" : "";
    const r = study.roles;
    return r.time === id ? "t" : r.pressure === id ? "P" : r.rate === id ? "q" : "";
  };

  const rowsShown: number[] = [];
  for (let d = first; d <= last; d++) rowsShown.push(d);

  if (isP && nCols === 0) {
    return (
      <div className="table-panel">
        <div className="table-toolbar">
          <div role="tablist" aria-label="Таблица" className="seg small-seg">
            <button type="button" role="tab" aria-selected className="on">Давление</button>
            <button type="button" role="tab" aria-selected={false} onClick={() => st.setTablePart("q")}>Дебиты</button>
          </div>
        </div>
        <div className="empty-table">
          <b>{study.isMain ? "Загрузите историю скважины" : "Таблица давления пуста"}</b>
          <p className="muted small">
            {study.isMain
              ? "Сюда загружается вся запись давления и история дебитов. На графике «давление + дебит» выделите нужный участок и создайте из него исследование («Данные» → «Создать исследование»)."
              : "Вставьте данные давления: время и давление."}
          </p>
          <button type="button" className="btn primary" onClick={() => st.setDialog({ kind: "import", part: "p" })}>Загрузить давление</button>
          <button type="button" className="btn" onClick={() => st.setDialog({ kind: "import", part: "q" })}>Загрузить дебиты</button>
          {study.isMain && (
            <button type="button" className="btn" onClick={() => st.loadDemo()}>Открыть демо-историю</button>
          )}
        </div>
      </div>
    );
  }

  if (!isP && nCols === 0) {
    return (
      <div className="table-panel">
        <div className="table-toolbar">
          <div role="tablist" aria-label="Таблица" className="seg small-seg">
            <button type="button" role="tab" aria-selected={false} onClick={() => st.setTablePart("p")}>Давление</button>
            <button type="button" role="tab" aria-selected className="on">Дебиты</button>
          </div>
        </div>
        <div className="empty-table">
          <b>Истории дебитов пока нет</b>
          <p className="muted small">
            Каждая строка — режим: время его начала и дебит. По ней считаются Δt (от последнего изменения дебита),
            суперпозиция и нормировка Δp/Δq. Время — датой или числом в той же шкале, что и время давления.
          </p>
          <button type="button" className="btn primary" onClick={() => st.setDialog({ kind: "import", part: "q" })}>
            Загрузить дебиты
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              st.replaceTable(study.id, "q", [
                { id: uid(), name: "Начало режима", quantity: "time", unit: "h", cells: new Array<string>(10).fill("") },
                { id: uid(), name: "Дебит", quantity: "rate", unit: "m3/d", cells: new Array<string>(10).fill("") },
              ])
            }
          >
            Ввести вручную
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="table-panel" onContextMenu={(e) => e.preventDefault()}>
      <div className="table-toolbar">
        <div role="tablist" aria-label="Таблица" className="seg small-seg">
          <button type="button" role="tab" aria-selected={isP} className={isP ? "on" : ""} onClick={() => st.setTablePart("p")}>
            Давление
          </button>
          <button type="button" role="tab" aria-selected={!isP} className={!isP ? "on" : ""} onClick={() => st.setTablePart("q")}>
            Дебиты{study.rateColumns.length > 0 ? ` (${rateRowCount(study)})` : ""}
          </button>
        </div>
        {isP ? (
          <span className="muted small">{sheet.rowCount} строк</span>
        ) : (
          <label className="small muted">
            время ={" "}
            <select
              className="input small"
              aria-label="Что означает время в таблице дебитов"
              value={study.rateTimeMode ?? "start"}
              onChange={(e) => st.updateStudy(study.id, { rateTimeMode: e.target.value === "end" ? "end" : "start" })}
            >
              <option value="start">начало режима</option>
              <option value="end">конец режима (Saphir)</option>
            </select>
          </label>
        )}
        {selected.size > 0 && (
          <button type="button" className="badge yellow" title="Снять выделение" onClick={() => st.setSelection(selKey, [])}>
            Выделено: {selected.size} ✕
          </button>
        )}

        <span className="grow" />
        {sort && (
          <button type="button" className="btn small" onClick={() => setSort(null)}>
            Снять сортировку
          </button>
        )}
      </div>
      <div className="formula-bar">
        <span className="addr" aria-label="Адрес ячейки">
          {colLetter(active.c)}
          {realRow(active.r) + 1}
        </span>
        <i className="fx" aria-hidden="true">ƒx</i>
        <input
          className="input mono grow"
          aria-label="Содержимое ячейки"
          value={barText ?? shownRaw}
          onFocus={() => setBarText(activeRaw === "" && activeCol?.formula ? "" : activeRaw)}
          onChange={(e) => setBarText(e.target.value)}
          placeholder={activeCol?.formula ? `формула столбца: ${activeCol.formula}` : ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(barText ?? "");
              setBarText(null);
              boxRef.current?.focus();
            }
            if (e.key === "Escape") {
              setBarText(null);
              boxRef.current?.focus();
            }
          }}
          onBlur={() => {
            if (barText !== null && barText !== activeRaw) commit(barText);
            setBarText(null);
          }}
        />
      </div>
      <div
        ref={boxRef}
        className="sheet"
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}
        onMouseDown={onMouseDown}
        onMouseOver={onMouseOver}
        onDoubleClick={(e) => {
          const c = cellFromEvent(e);
          if (c) setEditing(rawAt(c.c, c.r));
        }}
        onPaste={(e) => {
          if (editing !== null) return;
          pasteText(e.clipboardData.getData("text"));
          e.preventDefault();
        }}
        onContextMenu={(e) => {
          const c = cellFromEvent(e);
          if (c && !inRange(c.c, c.r)) {
            setActive(c);
            setAnchor(c);
          }
          setMenu({ x: e.clientX, y: e.clientY, col: c?.c ?? active.c });
        }}
      >
        <table style={{ width: HEAD_W + nCols * COL_W + COL_W / 2 }}>
          <thead>
            <tr className="letters">
              <th style={{ width: HEAD_W }} />
              {columns.map((c, i) => (
                <th key={c.id} style={{ width: COL_W }} className={i >= c0 && i <= c1 ? "hl" : ""}>
                  {colLetter(i)}
                </th>
              ))}
              <th style={{ width: COL_W / 2 }} />
            </tr>
            <tr className="names">
              <th />
              {columns.map((c, i) => {
                const fx = Boolean(c.formula);
                const role = roleOf(c.id);
                const unit = unitLabel(dimensionOfQuantity(c.quantity), c.unit);
                return (
                  <th
                    key={c.id}
                    className={fx ? "fxcol" : ""}
                    title="Клик — сортировка, двойной клик — свойства столбца"
                    onClick={() => sortBy(i)}
                    onDoubleClick={() => st.setDialog({ kind: "columnProps", columnId: c.id, part })}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, col: i });
                    }}
                  >
                    <span className="name">
                      {fx && <i className="fx">ƒx </i>}
                      {c.name}
                      {role && <span className="role">{role}</span>}
                      {sort?.col === i && <span className="sort">{sort.dir === 1 ? " ▲" : " ▼"}</span>}
                    </span>
                    <span className="unit">{unit === "—" ? c.quantity === "datetime" ? "дата" : "" : unit}</span>
                  </th>
                );
              })}
              <th>
                <button
                  type="button"
                  className="add-col"
                  aria-label="Добавить пустой столбец"
                  title="Добавить пустой столбец"
                  onClick={() => st.addColumn(study.id, { name: `Столбец ${colLetter(nCols)}` }, undefined, part)}
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: first * ROW_H }} />
            {rowsShown.map((d) => {
              const r = realRow(d);
              const isSel = selected.has(r);
              return (
                <tr key={d} className={isSel ? "sel" : ""}>
                  <th data-rowhead={d} className={d >= r0 && d <= r1 ? "hl" : ""}>
                    {r + 1}
                  </th>
                  {columns.map((c, ci) => {
                    const isActive = ci === active.c && d === active.r;
                    const inR = inRange(ci, d);
                    const err = sheet.errorAt(ci, r);
                    const text = sheet.display(ci, r);
                    const isFormula = (c.cells[r] ?? "").startsWith("=") || (!c.cells[r] && Boolean(c.formula));
                    const filling = fillTo !== null && ci >= c0 && ci <= c1 && d > r1 && d <= fillTo;
                    return (
                      <td
                        key={c.id}
                        data-c={ci}
                        data-r={d}
                        className={`${inR ? "inr" : ""}${isActive ? " act" : ""}${err ? " err" : ""}${isFormula ? " f" : ""}${filling ? " filling" : ""}${c.formula ? " fxcol" : ""}`}
                        title={err ?? undefined}
                      >
                        {isActive && editing !== null ? (
                          <CellEditor
                            initial={editing}
                            onDone={(v, dr, dc) => {
                              if (v !== null) commit(v);
                              setEditing(null);
                              if (dr || dc) move(dc, dr, false);
                              boxRef.current?.focus();
                            }}
                          />
                        ) : (
                          text
                        )}
                        {ci === c1 && d === r1 && editing === null && <span className="fill-handle" title="Потяните вниз, чтобы заполнить" />}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              );
            })}
            <tr style={{ height: Math.max(0, (nRows - 1 - last) * ROW_H) }} />
          </tbody>
        </table>
      </div>
      {menu && (
        <CellMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ["Заполнить вниз", "Ctrl+D", () => fillDown()],
            ["Копировать", "Ctrl+C", () => void navigator.clipboard?.writeText(copyRange())],
            ["Вставить", "Ctrl+V", () => void navigator.clipboard?.readText().then(pasteText).catch(() => alert("Нажмите Ctrl+V в таблице"))],
            ["Очистить", "Del", clearRange],
            null,
            ["Вставить столбец слева", "", () => st.addColumn(study.id, { name: `Столбец ${colLetter(nCols)}` }, menu.col, part)],
            ["Вставить столбец справа", "", () => st.addColumn(study.id, { name: `Столбец ${colLetter(nCols)}` }, menu.col + 1, part)],
            ["Вставить строку выше", "", () => (sort ? alert("Снимите сортировку") : st.insertRow(study.id, realRow(active.r), part))],
            null,
            ["Свойства столбца…", "", () => {
              const col = columns[menu.col];
              if (col) st.setDialog({ kind: "columnProps", columnId: col.id, part });
            }],
            ...(isP
              ? ([["Построить график по выделенным строкам…", "", () => st.setDialog({ kind: "flex", rows: useApp.getState().selection[study.id] ?? [] })]] as MenuItem[])
              : []),
          ]}
        />
      )}
    </div>
  );
}

/** Поле правки ячейки. Enter — вниз, Tab — вправо, Esc — отмена. */
function CellEditor({ initial, onDone }: { initial: string; onDone(v: string | null, dr: number, dc: number): void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (val: string | null, dr: number, dc: number): void => {
    if (done.current) return;
    done.current = true;
    onDone(val, dr, dc);
  };
  return (
    <input
      className="cell-input"
      autoFocus
      value={v}
      aria-label="Правка ячейки"
      onChange={(e) => setV(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(v, 1, 0);
        else if (e.key === "Tab") {
          e.preventDefault();
          finish(v, 0, e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") finish(null, 0, 0);
      }}
      onBlur={() => finish(v, 0, 0)}
    />
  );
}

type MenuItem = [string, string, () => void] | null;

function CellMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div ref={ref} className="menu" role="menu" style={{ position: "fixed", left: Math.min(x, window.innerWidth - 290), top: Math.min(y, window.innerHeight - 340) }}>
      {items.map((it, i) =>
        it ? (
          <button
            key={i}
            type="button"
            role="menuitem"
            onClick={() => {
              it[2]();
              onClose();
            }}
          >
            <span>{it[0]}</span>
            <span className="muted">{it[1]}</span>
          </button>
        ) : (
          <hr key={i} />
        ),
      )}
    </div>
  );
}


/** Число заполненных строк таблицы дебитов (для подписи вкладки). */
function rateRowCount(study: Study): number {
  let n = 0;
  const len = study.rateColumns.reduce((m, c) => Math.max(m, c.cells.length), 0);
  for (let r = 0; r < len; r++) if (study.rateColumns.some((c) => (c.cells[r] ?? "").trim() !== "")) n++;
  return n;
}
