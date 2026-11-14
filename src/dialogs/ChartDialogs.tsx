/**
 * Диалоги графиков.
 *
 * Схема:
 *   FlexDialog          — произвольный график (шаблон, функция времени, суперпозиция, P/Δp, нормировка, шкалы);
 *                         с rows — «пользовательский график по выделенным данным» + тренд и инварианта
 *   ColumnsChartDialog  — график по столбцам: X-столбец и серии Y
 *   ChartSettingsDialog — параметры существующего графика (те же поля + диапазоны осей, тема)
 *   TrendDialog         — линия тренда по выделенным точкам выбранной серии
 *   Preview             — живой предпросмотр через ChartView
 */
import { useMemo, useState } from "react";
import { useApp } from "../store";
import { Modal, NumInput } from "./common";
import type { ChartDef, FitType, Marker, Superposition, TimeFn } from "../core/types";
import { newChart, uid } from "../core/factory";
import { buildChartData, COLORS } from "../charts/series";
import { ChartView } from "../charts/ChartView";
import { makeTrend, lineStats } from "../charts/trend";
import { fmt, FIT_LABELS } from "../core/regression";
import { autoView, fromAxis, toAxis } from "../charts/geometry";
import { toSI } from "../core/units";
import { representativeRate } from "../core/welltest";

/** Графики истории не имеют параметров функции времени/давления. */
const isHistoryKind = (k: ChartDef["kind"]): boolean => k === "history" || k === "rates" || k === "combo";

const TIME_FNS: [TimeFn, string, string][] = [
  ["dt", "Δt", ""],
  ["log", "log(Δt)", ""],
  ["sqrt", "√Δt", "линейный поток"],
  ["qrt", "⁴√Δt", "билинейный поток"],
  ["invsqrt", "1/√Δt", "сферический поток"],
];
const SUPS: [Superposition, string][] = [
  ["none", "Нет (Δt от начала)"],
  ["buildup", "КВД (двухрежимная, по tp)"],
  ["multirate", "Мультирежимная"],
  ["agarwal", "Время Агарвала"],
];

interface Preset {
  label: string;
  patch: Partial<ChartDef>;
}
const PRESETS: Preset[] = [
  { label: "Пользовательский", patch: {} },
  { label: "Log-log", patch: { kind: "loglog", xLog: true, yLog: true } },
  { label: "Semilog", patch: { kind: "semilog", superposition: "buildup", xLog: false, yLog: false, yFn: "p" } },
  { label: "Хорнер (log, суперпозиция КВД)", patch: { kind: "flex", timeFn: "log", superposition: "buildup", yFn: "p", xLog: false, yLog: false } },
  { label: "Линейный поток (√t)", patch: { kind: "flex", timeFn: "sqrt", superposition: "none", yFn: "dp", xLog: false, yLog: false } },
  { label: "Билинейный поток (⁴√t)", patch: { kind: "flex", timeFn: "qrt", superposition: "none", yFn: "dp", xLog: false, yLog: false } },
  { label: "Сферический поток (1/√t)", patch: { kind: "flex", timeFn: "invsqrt", superposition: "none", yFn: "p", xLog: false, yLog: false } },
  { label: "История давления", patch: { kind: "history", xLog: false, yLog: false } },
];

function Radio<T extends string>(props: { name: string; value: T; current: T; label: React.ReactNode; onChange(v: T): void; disabled?: boolean }) {
  return (
    <label className={`radio${props.disabled ? " dis" : ""}`}>
      <input type="radio" name={props.name} checked={props.value === props.current} disabled={props.disabled} onChange={() => props.onChange(props.value)} />
      {props.label}
    </label>
  );
}

/** Живой предпросмотр графика. */
function Preview({ chart, height = 300 }: { chart: ChartDef; height?: number }) {
  const project = useApp((s) => s.project);
  const sel = useApp((s) => s.selection[chart.studyId]);
  const data = useMemo(() => buildChartData(chart, project), [chart, project]);
  // Масштаб предпросмотра сбрасывается при смене вида графика, функций и шкал.
  const viewKey = `${chart.kind}|${chart.timeFn}|${chart.superposition}|${chart.yFn}|${chart.xLog}|${chart.yLog}|${chart.normalizeByRate}`;
  const [local, setLocal] = useState<{ key: string; view: ChartDef["view"] }>({ key: viewKey, view: undefined });
  const view = local.key === viewKey ? local.view : undefined;
  const setView = (v: ChartDef["view"]): void => setLocal({ key: viewKey, view: v });
  const c = { ...chart, view: view ?? chart.view };
  return (
    <div className="preview" style={{ height }}>
      <ChartView
        chart={c}
        data={data}
        selected={new Set(sel ?? [])}
        tool="pan"
        multi={false}
        selectedLineId={null}
        onView={setView}
        onSelectRows={() => undefined}
        onAddLine={() => undefined}
        onUpdateLine={() => undefined}
        onSelectLine={() => undefined}
        onContextMenu={() => undefined}
        onActivate={() => undefined}
      />
    </div>
  );
}

/** Поля параметров функции времени / давления (общие для FlexDialog и ChartSettingsDialog). */
function FlexFields({ c, set }: { c: ChartDef; set(p: Partial<ChartDef>): void }) {
  const loglog = c.kind === "loglog";
  return (
    <div className="two-col">
      <div className="col gap">
        {!loglog && !isHistoryKind(c.kind) && (
          <fieldset>
            <legend>Функция времени (ось X)</legend>
            {c.kind === "semilog" ? (
              <div className="muted small">Semilog: log(Δt) с суперпозицией</div>
            ) : (
              TIME_FNS.map(([v, l, hint]) => (
                <Radio key={v} name="tf" value={v} current={c.timeFn} onChange={(timeFn) => set({ timeFn, kind: "flex" })} label={<><span className="mono">{l}</span> {hint && <span className="muted small">— {hint}</span>}</>} />
              ))
            )}
          </fieldset>
        )}
        {!isHistoryKind(c.kind) && (
          <fieldset>
            <legend>Суперпозиция{loglog ? " (для производной)" : ""}</legend>
            {SUPS.map(([v, l]) => (
              <Radio key={v} name="sup" value={v} current={c.superposition} onChange={(superposition) => set({ superposition })} label={l} />
            ))}
          </fieldset>
        )}
        {loglog && (
          <fieldset>
            <legend>Производная Бурде</legend>
            <label className="row gap small">Сглаживание L <NumInput label="Сглаживание L" value={c.derivL} onChange={(derivL) => set({ derivL: Math.max(0, derivL) })} className="narrow" /></label>
          </fieldset>
        )}
      </div>
      <div className="col gap">
        {!loglog && !isHistoryKind(c.kind) && (
          <fieldset>
            <legend>Функция давления (ось Y)</legend>
            <Radio name="yf" value="p" current={c.yFn} onChange={(yFn) => set({ yFn })} label="P" />
            <Radio name="yf" value="dp" current={c.yFn} onChange={(yFn) => set({ yFn })} label="Δp" />
            <Radio name="yf2" value="x" current="" disabled onChange={() => undefined} label="P², m(P), P/Z — для газа (позже)" />
          </fieldset>
        )}
        {!isHistoryKind(c.kind) && (
          <fieldset>
            <legend>Нормировка</legend>
            <label className="row gap small">
              <input type="checkbox" checked={c.normalizeByRate} onChange={(e) => set({ normalizeByRate: e.target.checked })} /> Делить на скачок дебита (Δp/Δq)
            </label>
          </fieldset>
        )}
        <fieldset>
          <legend>Шкала</legend>
          <div className="two-col tight">
            <b className="small muted">Ось X</b>
            <b className="small muted">Ось Y</b>
            <Radio name="sx" value="lin" current={c.xLog ? "log" : "lin"} onChange={() => set({ xLog: false, view: undefined, defaultView: undefined, lines: [] })} label="Линейная" />
            <Radio name="sy" value="lin" current={c.yLog ? "log" : "lin"} onChange={() => set({ yLog: false, view: undefined, defaultView: undefined, lines: [] })} label="Линейная" />
            <Radio name="sx" value="log" current={c.xLog ? "log" : "lin"} onChange={() => set({ xLog: true, view: undefined, defaultView: undefined, lines: [] })} label="Логарифм." />
            <Radio name="sy" value="log" current={c.yLog ? "log" : "lin"} onChange={() => set({ yLog: true, view: undefined, defaultView: undefined, lines: [] })} label="Логарифм." />
          </div>
        </fieldset>
      </div>
    </div>
  );
}

/** Произвольный график; с rows — по выделенным данным. */
export function FlexDialog({ rows }: { rows?: number[] }) {
  const st = useApp.getState();
  const studyId = useApp((s) => s.activeStudyId) ?? "";
  const study = useApp((s) => s.project.studies.find((x) => x.id === studyId));
  const fromSel = rows !== undefined;
  const [c, setC] = useState<ChartDef>(() =>
    newChart("flex", studyId, {
      name: fromSel ? `Поиск инварианты — ${study?.name ?? ""}` : "Линейный поток: Δp от √t",
      timeFn: "sqrt",
      yFn: "dp",
      rows: rows && rows.length > 0 ? rows : undefined,
    }),
  );
  const [preset, setPreset] = useState(0);
  const [withTrend, setWithTrend] = useState(fromSel);
  const set = (p: Partial<ChartDef>): void => setC((x) => ({ ...x, ...p }));
  const project = useApp((s) => s.project);
  const data = useMemo(() => buildChartData(c, project), [c, project]);
  const trend = useMemo(() => {
    if (!withTrend || !c.rows || c.kind !== "flex") return null;
    const key = data.series[0]?.key;
    if (!key) return null;
    const r = makeTrend(c, data, key, c.rows, "axis", 1);
    return typeof r === "string" ? null : r;
  }, [withTrend, c, data]);
  const slope = trend?.trend?.coeffs[0];
  const sqrtLinear = c.kind === "flex" && c.timeFn === "sqrt" && !c.xLog && !c.yLog && !c.normalizeByRate;

  const create = (): void => {
    const chart = { ...c, lines: trend ? [{ id: uid(), name: "Тренд", color: "#A78BFA", ...trend }] : [] };
    st.addChart(chart);
    st.setDialog(null);
  };
  const toCalc = (): void => {
    if (slope === undefined || !study) return;
    const calc = useApp.getState().project.calc;
    const prev = calc.perStudy[study.id] ?? { rate_m3_s: representativeRate(study), porosity: 0.13, invariant_Pa_s05: 0 };
    st.updateCalc({ perStudy: { ...calc.perStudy, [study.id]: { ...prev, invariant_Pa_s05: toSI(Math.abs(slope), "invariant", "atm/h05") } } });
    alert(`Инварианта m = ${fmt(Math.abs(slope), 5)} атм/ч^0.5 передана в калькулятор (${study.name})`);
  };

  return (
    <Modal
      title={fromSel ? "Пользовательский график по выделенным данным" : "Произвольный график"}
      sub={study?.name}
      width={1180}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" onClick={create}>Создать график</button>
        </>
      }
    >
      {fromSel && (
        <div className={`banner ${c.rows ? "blue" : "warn"}`}>
          {c.rows
            ? `Источник: ${study?.name}, выделено строк: ${c.rows.length} (номера ${Math.min(...c.rows) + 1}–${Math.max(...c.rows) + 1})`
            : "Строки не выделены — график будет построен по всем данным. Выделите строки в таблице или на графике."}
        </div>
      )}
      <div className="flex-dialog">
        <div className="col gap">
          <div className="row gap">
            <label className="lbl">
              Шаблон
              <select
                className="input"
                value={preset}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setPreset(i);
                  set({ ...(PRESETS[i]?.patch ?? {}), view: undefined, lines: [] });
                }}
              >
                {PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="lbl grow">
              Название
              <input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
          </div>
          <FlexFields c={c} set={set} />
          {fromSel && (
            <label className="row gap small">
              <input type="checkbox" checked={withTrend} onChange={(e) => setWithTrend(e.target.checked)} /> Сразу построить прямую-тренд по точкам
            </label>
          )}
        </div>
        <div className="col gap">
          <b className="small">Предпросмотр</b>
          <Preview chart={{ ...c, lines: trend ? [{ id: "t", name: "Тренд", color: "#A78BFA", ...trend }] : [] }} height={360} />
          {slope !== undefined && (
            <div className="banner violet row gap">
              <span>
                Наклон прямой{sqrtLinear ? " (инварианта)" : ""}: <b className="mono">m = {fmt(slope, 5)}</b>
                {sqrtLinear ? " атм/ч^0.5" : ""} · R² = <span className="mono">{fmt(trend?.trend?.r2 ?? Number.NaN, 4)}</span>
              </span>
              <span className="grow" />
              {sqrtLinear && (
                <button type="button" className="btn violet small" onClick={toCalc}>→ В калькулятор</button>
              )}
            </div>
          )}
          <p className="muted small">Колесо мыши — масштаб, перетаскивание — сдвиг. После создания график появится в окнах и в списке «Графики».</p>
        </div>
      </div>
    </Modal>
  );
}

const MARKERS: [Marker, string][] = [
  ["cross", "+ крест"],
  ["circle", "○ круг"],
  ["dot", "● точка"],
  ["line", "— линия"],
];

/** График по столбцам таблицы. */
export function ColumnsChartDialog() {
  const st = useApp.getState();
  const studyId = useApp((s) => s.activeStudyId) ?? "";
  const study = useApp((s) => s.project.studies.find((x) => x.id === studyId));
  const selRows = useApp((s) => s.selection[studyId]);
  const cols = study?.columns ?? [];
  const [onlySel, setOnlySel] = useState(false);
  const [c, setC] = useState<ChartDef>(() =>
    newChart("columns", studyId, {
      name: "По столбцам",
      xLog: false,
      yLog: false,
      xColumn: cols[0]?.id,
      yColumns: cols[1] ? [{ columnId: cols[1].id, color: COLORS.dp, marker: "cross" }] : [],
    }),
  );
  const set = (p: Partial<ChartDef>): void => setC((x) => ({ ...x, ...p }));
  const ys = c.yColumns ?? [];
  const chart = { ...c, rows: onlySel && selRows?.length ? selRows : undefined };
  return (
    <Modal
      title="График по столбцам"
      sub={study?.name}
      width={1080}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" disabled={!c.xColumn || ys.length === 0} onClick={() => { st.addChart(chart); st.setDialog(null); }}>Создать график</button>
        </>
      }
    >
      <div className="flex-dialog">
        <div className="col gap">
          <label className="lbl">Название графика<input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="row gap">
            <label className="lbl grow">
              Ось X — столбец
              <select className="input" value={c.xColumn} onChange={(e) => set({ xColumn: e.target.value })}>
                {cols.map((col, i) => (
                  <option key={col.id} value={col.id}>{String.fromCharCode(65 + i)} — {col.name}</option>
                ))}
              </select>
            </label>
            <label className="lbl">
              Шкала X
              <select className="input" value={c.xLog ? "log" : "lin"} onChange={(e) => set({ xLog: e.target.value === "log", view: undefined })}>
                <option value="lin">Линейная</option>
                <option value="log">Логарифм.</option>
              </select>
            </label>
          </div>
          <div className="row gap small">
            <b className="grow">Ось Y — столбцы (серии)</b>
            <label>Шкала Y{" "}
              <select className="input small" value={c.yLog ? "log" : "lin"} onChange={(e) => set({ yLog: e.target.value === "log", view: undefined })}>
                <option value="lin">Линейная</option>
                <option value="log">Логарифм.</option>
              </select>
            </label>
          </div>
          {ys.map((y, k) => (
            <div key={k} className="series-row">
              <select className="input" value={y.columnId} aria-label="Столбец Y" onChange={(e) => set({ yColumns: ys.map((q, i) => (i === k ? { ...q, columnId: e.target.value } : q)) })}>
                {cols.map((col, i) => (
                  <option key={col.id} value={col.id}>{String.fromCharCode(65 + i)} — {col.name}</option>
                ))}
              </select>
              <select className="input" value={y.marker} aria-label="Маркер" onChange={(e) => set({ yColumns: ys.map((q, i) => (i === k ? { ...q, marker: e.target.value as Marker } : q)) })}>
                {MARKERS.map(([m, l]) => (
                  <option key={m} value={m}>{l}</option>
                ))}
              </select>
              <input type="color" value={y.color} aria-label="Цвет серии" onChange={(e) => set({ yColumns: ys.map((q, i) => (i === k ? { ...q, color: e.target.value } : q)) })} />
              <button type="button" className="icon-btn" aria-label="Удалить серию" onClick={() => set({ yColumns: ys.filter((_, i) => i !== k) })}>✕</button>
            </div>
          ))}
          <button
            type="button"
            className="btn dashed small"
            onClick={() => set({ yColumns: [...ys, { columnId: cols[Math.min(ys.length + 1, cols.length - 1)]?.id ?? "", color: COLORS.overlay[ys.length % 6] ?? "#60A5FA", marker: "dot" }] })}
          >
            + Добавить серию Y
          </button>
          <label className="row gap small">
            <input type="checkbox" checked={onlySel} disabled={!selRows?.length} onChange={(e) => setOnlySel(e.target.checked)} />
            Только выделенные строки {selRows?.length ? `(${selRows.length})` : "(нет выделения)"}
          </label>
        </div>
        <div className="col gap">
          <b className="small">Предпросмотр</b>
          <Preview chart={chart} height={380} />
        </div>
      </div>
    </Modal>
  );
}

/** Параметры существующего графика. */
export function ChartSettingsDialog({ chartId }: { chartId: string }) {
  const st = useApp.getState();
  const orig = useApp((s) => s.project.charts.find((c) => c.id === chartId));
  const project = useApp((s) => s.project);
  const [c, setC] = useState<ChartDef | undefined>(orig);
  const data = useMemo(() => (c ? buildChartData(c, project) : null), [c, project]);
  if (!c || !orig || !data) return null;
  const set = (p: Partial<ChartDef>): void => setC({ ...c, ...p });
  const v = c.view ?? c.defaultView ?? autoView(data.series, c.xLog, c.yLog);
  const setRange = (k: keyof NonNullable<ChartDef["view"]>, val: number, log: boolean): void => {
    const a = toAxis(val, log);
    if (Number.isFinite(a)) set({ view: { ...v, [k]: a } });
  };
  const study = project.studies.find((s) => s.id === c.studyId);
  return (
    <Modal
      title="Параметры графика"
      sub={study?.name}
      width={1080}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" onClick={() => { st.updateChart(c.id, c); st.setDialog(null); }}>Применить</button>
        </>
      }
    >
      <div className="flex-dialog">
        <div className="col gap">
          <label className="lbl">Название<input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} /></label>
          {c.kind !== "columns" && <FlexFields c={c} set={set} />}
          <fieldset>
            <legend>Диапазоны осей</legend>
            <div className="range-grid">
              <span>X от</span>
              <NumInput label="X минимум" value={fromAxis(v.xmin, c.xLog)} onChange={(x) => setRange("xmin", x, c.xLog)} />
              <span>до</span>
              <NumInput label="X максимум" value={fromAxis(v.xmax, c.xLog)} onChange={(x) => setRange("xmax", x, c.xLog)} />
              <span>Y от</span>
              <NumInput label="Y минимум" value={fromAxis(v.ymin, c.yLog)} onChange={(x) => setRange("ymin", x, c.yLog)} />
              <span>до</span>
              <NumInput label="Y максимум" value={fromAxis(v.ymax, c.yLog)} onChange={(x) => setRange("ymax", x, c.yLog)} />
            </div>
            <button type="button" className="btn small" onClick={() => set({ view: undefined, defaultView: undefined })}>Автомасштаб</button>
          </fieldset>
          <div className="row gap small">
            <label><input type="checkbox" checked={c.showGrid} onChange={(e) => set({ showGrid: e.target.checked })} /> Сетка</label>
            <label><input type="checkbox" checked={c.theme === "dark"} onChange={(e) => set({ theme: e.target.checked ? "dark" : "light" })} /> Тёмный фон</label>
            {c.rows && <button type="button" className="btn small" onClick={() => set({ rows: undefined })}>Показать все строки (сейчас {c.rows.length})</button>}
          </div>
          {orig.lines.length > 0 && (orig.xLog !== c.xLog || orig.yLog !== c.yLog) && <div className="banner warn small">При смене шкалы прямые графика будут удалены.</div>}
        </div>
        <div className="col gap">
          <b className="small">Предпросмотр</b>
          <Preview chart={c} height={420} />
        </div>
      </div>
    </Modal>
  );
}

/** Линия тренда по выделенным точкам. */
export function TrendDialog({ chartId }: { chartId: string }) {
  const st = useApp.getState();
  const project = useApp((s) => s.project);
  const chart = project.charts.find((c) => c.id === chartId);
  const rows = useApp((s) => (chart ? s.selection[chart.studyId] : undefined));
  const data = useMemo(() => (chart ? buildChartData(chart, project) : null), [chart, project]);
  const sel = useMemo(() => new Set(rows ?? []), [rows]);
  const candidates = (data?.series ?? []).filter((s) => s.studyId === chart?.studyId && s.points.some((p) => sel.has(p.row)));
  const [seriesKey, setSeriesKey] = useState(candidates[0]?.key ?? "");
  const [fit, setFit] = useState<FitType>("axis");
  const [degree, setDegree] = useState(2);
  const [fixed, setFixed] = useState<number | undefined>(undefined);
  const [name, setName] = useState(`Тренд ${(chart?.lines.length ?? 0) + 1}`);
  if (!chart || !data) return null;
  const res = seriesKey ? makeTrend(chart, data, seriesKey, rows ?? [], fit, degree, fixed) : "Выделите точки на графике или строки в таблице";
  const preview = typeof res === "string" ? null : { id: "p", name, color: "#A78BFA", ...res };
  const stats = preview ? lineStats(preview, chart, data, sel) : null;
  return (
    <Modal
      title="Линия тренда по выделенным точкам"
      sub={chart.name}
      width={560}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button
            type="button"
            className="btn primary"
            disabled={!preview}
            onClick={() => {
              if (!preview) return;
              st.addLine(chart.id, { ...preview, id: uid() });
              st.selectLine(useApp.getState().selectedLine, true);
              st.setDialog(null);
            }}
          >
            Построить
          </button>
        </>
      }
    >
      <div className="col gap">
        {candidates.length === 0 && <div className="banner warn">Нет выделенных точек на этом графике. Выделите точки инструментами группы «Данные» или строки в таблице.</div>}
        <label className="lbl">Название<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="lbl">
          Серия
          <select className="input" value={seriesKey} onChange={(e) => setSeriesKey(e.target.value)}>
            {candidates.map((s) => (
              <option key={s.key} value={s.key}>{s.name} — выделено {s.points.filter((p) => sel.has(p.row)).length} т.</option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Тип аппроксимации
          <select className="input" value={fit} onChange={(e) => setFit(e.target.value as FitType)}>
            {(Object.keys(FIT_LABELS) as FitType[]).map((f) => (
              <option key={f} value={f}>{FIT_LABELS[f]}</option>
            ))}
          </select>
        </label>
        {fit === "poly" && (
          <label className="lbl">Степень полинома (1–6)<NumInput label="Степень" value={degree} onChange={(d) => setDegree(Math.max(1, Math.min(6, Math.round(d))))} /></label>
        )}
        {(fit === "axis" || fit === "linear" || fit === "power") && (
          <label className="row gap small">
            <input type="checkbox" checked={fixed !== undefined} onChange={(e) => setFixed(e.target.checked ? (chart.xLog && chart.yLog ? 0.5 : 1) : undefined)} />
            Фиксировать наклон {fixed !== undefined && <NumInput label="Наклон" value={fixed} onChange={setFixed} className="narrow" />}
            <span className="muted">(на log-log: ½ — линейный поток, ¼ — билинейный, 1 — ВСС, 0 — радиальный)</span>
          </label>
        )}
        {stats && (
          <div className="banner violet">
            <div className="mono">{stats.equation}</div>
            {stats.slope !== null && <div>Наклон в осях: <b className="mono">{fmt(stats.slope, 5)}</b></div>}
            <div>R² = <span className="mono">{fmt(stats.r2 ?? Number.NaN, 5)}</span></div>
          </div>
        )}
        {typeof res === "string" && candidates.length > 0 && <div className="banner warn">{res}</div>}
      </div>
    </Modal>
  );
}
