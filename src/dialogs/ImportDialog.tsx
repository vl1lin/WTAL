/**
 * Окно загрузки данных.
 *
 * Схема:
 *   текст (буфер обмена / файл / ручной ввод) ──parsePasted()──► строки
 *   назначение столбцов: имя, физический смысл, единицы
 *   параметры исследования: имя, КВД/КСД, tp, дебит до остановки
 *   «Загрузить» → store.addStudy(study, выбранные графики)
 */
import { useMemo, useState } from "react";
import { useApp } from "../store";
import { Modal, NumInput, UnitSelect } from "./common";
import { parsePasted, parseDateTime } from "../core/sheet";
import { parseUserNumber } from "../core/formula";
import type { ChartKind, Quantity, Study, TestType } from "../core/types";
import { dimensionOfQuantity, toSI, UNITS } from "../core/units";
import { uid } from "../core/factory";

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

export function ImportDialog() {
  const st = useApp.getState();
  const nStudies = useApp((s) => s.project.studies.length);
  const [src, setSrc] = useState<"paste" | "file" | "manual">("paste");
  const [text, setText] = useState("");
  const [delim, setDelim] = useState("auto");
  const [header, setHeader] = useState(true);
  const [skip, setSkip] = useState(0);
  const [name, setName] = useState(`Исследование ${nStudies + 1}`);
  const [testType, setTestType] = useState<TestType>("buildup");
  const [tpH, setTpH] = useState(0);
  const [qBefore, setQBefore] = useState(0);
  const [maps, setMaps] = useState<ColMap[]>([]);
  const [charts, setCharts] = useState<Record<ChartKind, boolean>>({ loglog: true, history: true, flex: true, semilog: false, columns: false });

  const parsed = useMemo(() => (text.trim() ? parsePasted(text, delim, header, skip) : null), [text, delim, header, skip]);
  const nCols = parsed ? Math.max(parsed.headers?.length ?? 0, ...parsed.rows.map((r) => r.length)) : 0;

  // Пересобрать сопоставление столбцов при изменении структуры.
  const mapKey = `${nCols}|${parsed?.headers?.join("|") ?? ""}`;
  const [lastKey, setLastKey] = useState("");
  if (parsed && mapKey !== lastKey) {
    setLastKey(mapKey);
    setMaps(
      Array.from({ length: nCols }, (_, i) => {
        const h = parsed.headers?.[i] ?? `Столбец ${i + 1}`;
        const g = guess(h, parsed.rows[0]?.[i] ?? "");
        return { name: h, ...g, use: true };
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

  const load = (): void => {
    let study: Study;
    if (src === "manual" || !parsed) {
      study = {
        id: uid(),
        name,
        columns: [
          { id: uid(), name: "Время", quantity: "time", unit: "h", cells: new Array<string>(50).fill("") },
          { id: uid(), name: "Давление", quantity: "pressure", unit: "atm", cells: new Array<string>(50).fill("") },
          { id: uid(), name: "Расход", quantity: "rate", unit: "m3/d", cells: new Array<string>(50).fill("") },
        ],
        roles: {},
        testType,
        tpSeconds: tpH * 3600,
        rateBeforeM3s: toSI(qBefore, "rate", "m3/d"),
      };
    } else {
      study = {
        id: uid(),
        name,
        columns: maps
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.use)
          .map(({ m, i }) => ({
            id: uid(),
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            cells: parsed.rows.map((r) => r[i] ?? ""),
          })),
        roles: {},
        testType,
        tpSeconds: tpH * 3600,
        rateBeforeM3s: toSI(qBefore, "rate", "m3/d"),
      };
    }
    st.addStudy(study, (Object.keys(charts) as ChartKind[]).filter((k) => charts[k]));
    st.setDialog(null);
  };

  const errors = parsed ? parsed.rows.filter((r) => r.length !== nCols).length : 0;

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
        <div role="tablist" className="tabs-line">
          {([["paste", "Из буфера обмена"], ["file", "Файл (CSV / TXT)"], ["manual", "Ввести вручную"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={src === k} className={src === k ? "on" : ""} onClick={() => setSrc(k)}>{l}</button>
          ))}
        </div>
        <span className="grow" />
        <label className="row gap small">Исследование <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="row gap wrap small" style={{ marginTop: 10 }}>
        <label className="row gap">Тип
          <select className="input" value={testType} onChange={(e) => setTestType(e.target.value as TestType)}>
            <option value="buildup">КВД (восстановление)</option>
            <option value="drawdown">КСД / падение давления</option>
          </select>
        </label>
        <label className="row gap">tp, ч <NumInput label="Время работы до остановки tp" value={tpH} onChange={setTpH} className="narrow" /></label>
        <label className="row gap">Дебит до остановки, м³/сут <NumInput label="Дебит до остановки" value={qBefore} onChange={setQBefore} className="narrow" /></label>
        <span className="muted">нужны для суперпозиции и нормировки</span>
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
            <div className="hint-box">Будет создана пустая таблица на 50 строк со столбцами «Время», «Давление», «Расход». Данные можно вводить и вставлять прямо в таблицу (Ctrl+V).</div>
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
              <textarea className="paste-area" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Дата/время\tT, ч\tP заб, атм\tQ, м3/сут\n…"} aria-label="Данные из буфера обмена" />
              <div className="row gap small">
                <label><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Первая строка — заголовки</label>
                <label>Пропустить строк сверху <NumInput label="Пропустить строк" value={skip} onChange={(v) => setSkip(Math.max(0, Math.round(v)))} className="narrow" /></label>
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
              Время, давление и расход берутся из первых столбцов с таким смыслом; изменить можно в настройках исследования (⚙ на вкладке).
            </div>
          </div>
        )}
      </div>
      <div className="row gap wrap small" style={{ marginTop: 12 }}>
        <b>Создать графики:</b>
        {([["loglog", "Log-log"], ["history", "История"], ["flex", "√t (линейный поток)"], ["semilog", "Semilog"]] as const).map(([k, l]) => (
          <label key={k}><input type="checkbox" checked={charts[k]} onChange={(e) => setCharts({ ...charts, [k]: e.target.checked })} /> {l}</label>
        ))}
      </div>
    </Modal>
  );
}
