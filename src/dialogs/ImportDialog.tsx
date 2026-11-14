/**
 * Окно загрузки данных. Давление и дебиты загружаются отдельно.
 *
 * Схема:
 *   что загружаем: «Давление» (таблица давления) | «Дебиты» (история режимов: время начала, дебит)
 *   куда: новое исследование | существующее (таблица заменяется)
 *   текст (буфер обмена / файл / ручной ввод) ──parsePasted()──► строки
 *   назначение столбцов: имя, физический смысл, единицы
 *   «Загрузить» → store.addStudy(…) или store.replaceTable(studyId, part, columns)
 */
import { useMemo, useState } from "react";
import { useApp } from "../store";
import { Modal, NumInput, UnitSelect } from "./common";
import { parsePasted, parseDateTime } from "../core/sheet";
import { parseUserNumber } from "../core/formula";
import type { ChartKind, Column, Quantity, Study, TablePart, TestType } from "../core/types";
import { dimensionOfQuantity, UNITS } from "../core/units";
import { newChart, uid } from "../core/factory";

const QUANTITIES: [Quantity, string][] = [
  ["datetime", "Дата и время"],
  ["time", "Время"],
  ["pressure", "Давление"],
  ["rate", "Расход"],
  ["temperature", "Температура"],
  ["dimensionless", "Безразмерная"],
  ["other", "Другое"],
];

interface ColMap {
  name: string;
  quantity: Quantity;
  unit: string;
  use: boolean;
}

/**
 * Угадать физический смысл столбца по заголовку и значениям.
 * @param header заголовок
 * @param sample первое значение
 * @returns смысл и единица
 */
function guess(header: string, sample: string): { quantity: Quantity; unit: string } {
  const h = header.toLowerCase();
  if (parseDateTime(sample) !== null && parseUserNumber(sample) === null) return { quantity: "datetime", unit: "-" };
  if (/давл|pres|^p\b|p\s|атм|бар|мпа|psi/.test(h)) {
    const unit = /мпа|mpa/.test(h) ? "MPa" : /бар|bar/.test(h) ? "bar" : /psi/.test(h) ? "psi" : /кгс/.test(h) ? "kgf/cm2" : "atm";
    return { quantity: "pressure", unit };
  }
  if (/расх|дебит|rate|^q\b|q\s|м3|m3/.test(h)) return { quantity: "rate", unit: /ч\b|\/h/.test(h) ? "m3/h" : "m3/d" };
  if (/врем|time|^t\b|t\s|час|^dt/.test(h)) {
    const unit = /мин|min/.test(h) ? "min" : /сут|day/.test(h) ? "d" : /\bс\b|sec/.test(h) ? "s" : "h";
    return { quantity: "time", unit };
  }
  if (/темп|temp/.test(h)) return { quantity: "temperature", unit: "C" };
  return { quantity: "other", unit: "-" };
}

export function ImportDialog({ initialPart }: { initialPart: TablePart }) {
  const st = useApp.getState();
  const studies = useApp((s) => s.project.studies);
  const activeId = useApp((s) => s.activeStudyId);
  const [part, setPart] = useState<TablePart>(initialPart);
  // Давление по умолчанию — в новое исследование, дебиты — в активное.
  const [target, setTarget] = useState<string>(initialPart === "q" && activeId ? activeId : "new");
  const [src, setSrc] = useState<"paste" | "file" | "manual">("paste");
  const [text, setText] = useState("");
  const [delim, setDelim] = useState("auto");
  const [header, setHeader] = useState(true);
  const [skip, setSkip] = useState(0);
  const [name, setName] = useState(`Исследование ${studies.length + 1}`);
  const [testType, setTestType] = useState<TestType>("buildup");
  const [maps, setMaps] = useState<ColMap[]>([]);
  const [charts, setCharts] = useState<Record<ChartKind, boolean>>({ loglog: true, history: false, flex: true, semilog: false, rates: false, combo: true, columns: false });

  const parsed = useMemo(() => (text.trim() ? parsePasted(text, delim, header, skip) : null), [text, delim, header, skip]);
  const nCols = parsed ? Math.max(parsed.headers?.length ?? 0, ...parsed.rows.map((r) => r.length)) : 0;
  const targetStudy = studies.find((s) => s.id === target);
  const isNew = target === "new" || !targetStudy;

  // Пересобрать сопоставление столбцов при изменении структуры.
  const mapKey = `${nCols}|${parsed?.headers?.join("|") ?? ""}|${part}`;
  const [lastKey, setLastKey] = useState("");
  if (parsed && mapKey !== lastKey) {
    setLastKey(mapKey);
    setMaps(
      Array.from({ length: nCols }, (_, i) => {
        const h = parsed.headers?.[i] ?? `Столбец ${i + 1}`;
        const g = guess(h, parsed.rows[0]?.[i] ?? "");
        // В таблице дебитов давление не нужно.
        const use = !(part === "q" && g.quantity === "pressure");
        return { name: h, ...g, use };
      }),
    );
  }

  const readFile = (f: File): void => {
    const r = new FileReader();
    r.onload = () => {
      setText(String(r.result ?? ""));
      setSrc("paste");
    };
    r.readAsText(f);
  };

  const buildColumns = (): Column[] => {
    if (src === "manual" || !parsed) {
      const n = part === "q" ? 10 : 50;
      return part === "q"
        ? [
            { id: uid(), name: "Начало режима", quantity: "time", unit: "h", cells: new Array<string>(n).fill("") },
            { id: uid(), name: "Дебит", quantity: "rate", unit: "m3/d", cells: new Array<string>(n).fill("") },
          ]
        : [
            { id: uid(), name: "Время", quantity: "time", unit: "h", cells: new Array<string>(n).fill("") },
            { id: uid(), name: "Давление", quantity: "pressure", unit: "atm", cells: new Array<string>(n).fill("") },
          ];
    }
    return maps
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.use)
      .map(({ m, i }) => ({ id: uid(), name: m.name, quantity: m.quantity, unit: m.unit, cells: parsed.rows.map((r) => r[i] ?? "") }));
  };

  const load = (): void => {
    const cols = buildColumns();
    if (isNew) {
      const study: Study = {
        id: uid(),
        name,
        columns: part === "p" ? cols : [],
        roles: {},
        rateColumns: part === "q" ? cols : [],
        rateRoles: {},
        testType,
        tpSeconds: 0,
        rateBeforeM3s: 0,
      };
      const kinds = (Object.keys(charts) as ChartKind[]).filter((k) => charts[k] && (part === "p" || k === "rates" || k === "combo"));
      st.addStudy(study, kinds);
    } else {
      if (tableHasData(part === "q" ? targetStudy.rateColumns : targetStudy.columns) &&
        !confirm(`Заменить таблицу ${part === "q" ? "дебитов" : "давления"} исследования «${targetStudy.name}»?`)) return;
      st.replaceTable(targetStudy.id, part, cols);
      const has = (k: ChartKind): boolean => useApp.getState().project.charts.some((c) => c.studyId === targetStudy.id && c.kind === k);
      if (part === "q" && !has("rates") && !has("combo")) {
        st.addChart(newChart("combo", targetStudy.id, { name: "История: давление и дебит" }));
      }
      st.updateStudy(targetStudy.id, { testType });
      st.setActiveStudy(targetStudy.id);
    }
    st.setTablePart(part);
    st.setDialog(null);
  };

  const errors = parsed ? parsed.rows.filter((r) => r.length !== nCols).length : 0;
  const placeholder =
    part === "q"
      ? "Начало режима\tДебит, м3/сут\n01.03.2026 00:00\t22\n12.03.2026 08:00\t0"
      : "Дата/время\tP заб, атм\n12.03.2026 08:00\t153,2\n…";

  return (
    <Modal
      title="Загрузка данных"
      width={1120}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="muted small grow">
            {parsed ? `Распознано ${parsed.rows.length} строк × ${nCols} столбцов${errors ? `, строк с другим числом столбцов: ${errors}` : ""}` : "Вставьте данные или выберите файл"}
          </span>
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" disabled={src !== "manual" && !parsed} onClick={load}>Загрузить</button>
        </>
      }
    >
      <div className="row gap wrap">
        <div role="group" aria-label="Что загружаем" className="seg">
          <button type="button" aria-pressed={part === "p"} className={part === "p" ? "on" : ""} onClick={() => setPart("p")}>Давление</button>
          <button type="button" aria-pressed={part === "q"} className={part === "q" ? "on" : ""} onClick={() => { setPart("q"); if (target === "new" && activeId) setTarget(activeId); }}>Дебиты</button>
        </div>
        <label className="row gap small">
          Куда
          <select className="input" value={isNew ? "new" : target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">Новое исследование</option>
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {part === "q" ? (tableHasData(s.rateColumns) ? "заменить дебиты" : "добавить дебиты") : tableHasData(s.columns) ? "заменить давление" : "добавить давление"}
              </option>
            ))}
          </select>
        </label>
        {isNew && <label className="row gap small">Название <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>}
        <label className="row gap small">
          Тип
          <select className="input" value={isNew ? testType : (targetStudy?.testType ?? testType)} onChange={(e) => setTestType(e.target.value as TestType)}>
            <option value="buildup">КВД (восстановление)</option>
            <option value="drawdown">КСД / падение давления</option>
          </select>
        </label>
      </div>
      <div className={`banner ${part === "q" ? "violet" : "blue"} small`} style={{ marginTop: 10 }}>
        {part === "q"
          ? "История дебитов: каждая строка — режим, время — момент его начала (датой или числом в той же шкале, что и время давления). Δt отсчитывается от последнего изменения дебита; по истории строятся суперпозиция и нормировка Δp/Δq."
          : "Давление: столбец времени (дата или число) и давление. Дебиты загружаются отдельно — переключатель «Дебиты» вверху или вкладка «Дебиты» над таблицей."}
      </div>
      <div className="row gap wrap" style={{ marginTop: 10 }}>
        <div role="tablist" className="tabs-line">
          {([["paste", "Из буфера обмена"], ["file", "Файл (CSV / TXT)"], ["manual", "Ввести вручную"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={src === k} className={src === k ? "on" : ""} onClick={() => setSrc(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="import-grid">
        <div className="col gap">
          {src === "file" && (
            <label className="drop">
              <input type="file" accept=".csv,.txt,.tsv,.dat" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              Выберите файл CSV/TXT — содержимое появится в поле редактирования
            </label>
          )}
          {src === "manual" ? (
            <div className="hint-box">
              {part === "q"
                ? "Будет создана пустая таблица дебитов на 10 строк: «Начало режима» (ч) и «Дебит» (м³/сут)."
                : "Будет создана пустая таблица на 50 строк: «Время» (ч) и «Давление» (атм)."}{" "}
              Данные можно вводить и вставлять прямо в таблицу (Ctrl+V).
            </div>
          ) : (
            <>
              <div className="row gap small">
                <b className="grow">1. Вставьте данные (Ctrl+V) и при необходимости поправьте</b>
                <label>Разделитель{" "}
                  <select className="input small" value={delim} onChange={(e) => setDelim(e.target.value)}>
                    <option value="auto">Авто</option>
                    <option value={"\t"}>Табуляция</option>
                    <option value=";">;</option>
                    <option value=",">,</option>
                    <option value=" ">Пробел</option>
                  </select>
                </label>
              </div>
              <textarea className="paste-area" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Данные из буфера обмена" />
              <div className="row gap small wrap">
                <label><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Первая строка — заголовки</label>
                <label className="row gap">Пропустить строк сверху <NumInput label="Пропустить строк" value={skip} onChange={(v) => setSkip(Math.max(0, Math.round(v)))} className="narrow" /></label>
                <span className="muted">Десятичная запятая распознаётся автоматически</span>
              </div>
            </>
          )}
        </div>
        {src !== "manual" && (
          <div className="col gap">
            <b className="small">2. Назначьте столбцы</b>
            <div className="map-head small muted">
              <span />
              <span>Название</span>
              <span>Физический смысл</span>
              <span>Единицы</span>
            </div>
            <div className="map-list">
              {maps.map((m, i) => (
                <div key={i} className="map-row">
                  <input type="checkbox" checked={m.use} aria-label="Загружать столбец" onChange={(e) => setMaps(maps.map((x, k) => (k === i ? { ...x, use: e.target.checked } : x)))} />
                  <input className="input" value={m.name} aria-label="Название столбца" onChange={(e) => setMaps(maps.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  <select
                    className="input"
                    value={m.quantity}
                    aria-label="Физический смысл"
                    onChange={(e) => {
                      const q = e.target.value as Quantity;
                      const unit = UNITS[dimensionOfQuantity(q)][0]?.key ?? "-";
                      setMaps(maps.map((x, k) => (k === i ? { ...x, quantity: q, unit } : x)));
                    }}
                  >
                    {QUANTITIES.map(([q, l]) => (
                      <option key={q} value={q}>{l}</option>
                    ))}
                  </select>
                  {m.quantity === "datetime" ? (
                    <span className="muted small">ДД.ММ.ГГГГ чч:мм</span>
                  ) : (
                    <UnitSelect dim={dimensionOfQuantity(m.quantity)} value={m.unit} label={m.name} onChange={(u) => setMaps(maps.map((x, k) => (k === i ? { ...x, unit: u } : x)))} />
                  )}
                </div>
              ))}
              {maps.length === 0 && <div className="muted small">Столбцы появятся после вставки данных</div>}
            </div>
            <div className="hint-box small">
              {part === "q"
                ? "Нужны два столбца: время начала режима (Время или Дата и время) и Расход."
                : "Нужны время (Время или Дата и время) и Давление. Столбцы для расчётов можно поменять в настройках исследования (⚙ на вкладке)."}
            </div>
          </div>
        )}
      </div>
      {part === "p" && isNew && (
        <div className="row gap wrap small" style={{ marginTop: 12 }}>
          <b>Создать графики:</b>
          {([["loglog", "Log-log"], ["combo", "Давление + дебит"], ["flex", "√t (линейный поток)"], ["semilog", "Semilog"], ["history", "История давления"], ["rates", "История дебитов"]] as const).map(([k, l]) => (
            <label key={k}><input type="checkbox" checked={charts[k]} onChange={(e) => setCharts({ ...charts, [k]: e.target.checked })} /> {l}</label>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** В таблице есть хотя бы одна непустая ячейка. */
function tableHasData(cols: Column[]): boolean {
  return cols.some((c) => c.cells.some((v) => v.trim() !== ""));
}
