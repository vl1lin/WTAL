/**
 * Диалоги построителя графиков.
 *
 * Схема:
 *   BuilderImportDialog — данные графика «как есть» (например, выгрузка из Saphir):
 *     текст (буфер/файл) ──parsePasted()──► столбцы ──роль (X / Y / нет), имя, единица, маркер, цвет──►
 *       ├─ новый график: столбцы в исследовании построителя + ChartDef(kind="columns", шкалы по шаблону)
 *       └─ «+ Серия» к графику chartId: новые столбцы, серии Y со своим столбцом X (xColumnId)
 *   OverlayDialog — наложение нескольких графиков исследования построителя в один (серии со своими X).
 *
 * Пересчёта нет: значения строятся ровно так, как загружены.
 */
import { useMemo, useState } from "react";
import { useApp } from "../store";
import { Modal } from "../dialogs/common";
import { parsePasted } from "../core/sheet";
import { newChart, uid } from "../core/factory";
import type { ChartDef, Column, Marker } from "../core/types";

/** Цвета серий по порядку. */
export const SERIES_COLORS = ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#4B5563"];

type Template = "loglog" | "semilog" | "sqrt" | "custom";
const TEMPLATES: { id: Template; name: string; xLog: boolean; yLog: boolean; hint: string }[] = [
  { id: "loglog", name: "Log-log", xLog: true, yLog: true, hint: "Δt — Δp и производная, обе оси логарифмические" },
  { id: "semilog", name: "Semilog", xLog: true, yLog: false, hint: "логарифмическая ось X" },
  { id: "sqrt", name: "√t", xLog: false, yLog: false, hint: "Δp от √Δt — для инварианты" },
  { id: "custom", name: "Произвольный", xLog: false, yLog: false, hint: "линейные оси" },
];

type Role = "x" | "y" | "none";
interface ColSetup {
  role: Role;
  name: string;
  unit: string;
  marker: Marker;
  color: string;
}

/**
 * Отделить единицу из заголовка «Имя, ед.» или «Имя (ед.)».
 * @param h заголовок столбца
 * @returns имя и единица (может быть пустой)
 */
function splitHeader(h: string): { name: string; unit: string } {
  const m = /^(.*?)(?:,\s*|\s*\()([^,()]+?)\)?\s*$/.exec(h.trim());
  return m && m[1] ? { name: m[1].trim(), unit: (m[2] ?? "").trim() } : { name: h.trim(), unit: "" };
}

/**
 * Загрузка графика в построитель.
 * @param chartId если задан — добавить серии к этому графику, иначе создать новый
 */
export function BuilderImportDialog({ chartId }: { chartId?: string }) {
  const st = useApp.getState();
  const studyId = useApp((s) => s.activeStudyId);
  const allCharts = useApp((s) => s.project.charts);
  const charts = useMemo(() => allCharts.filter((c) => c.studyId === studyId), [allCharts, studyId]);
  const target = charts.find((c) => c.id === chartId);
  const [text, setText] = useState("");
  const [header, setHeader] = useState(true);
  const [delim, setDelim] = useState("auto");
  const [template, setTemplate] = useState<Template>("loglog");
  const [name, setName] = useState(`График ${charts.length + 1}`);
  const [setup, setSetup] = useState<ColSetup[]>([]);
  const [err, setErr] = useState("");

  const parsed = useMemo(() => (text.trim() ? parsePasted(text, delim, header, 0) : null), [text, delim, header]);
  const nCols = parsed ? Math.max(parsed.headers?.length ?? 0, ...parsed.rows.map((r) => r.length)) : 0;
  const key = `${nCols}|${parsed?.headers?.join("|") ?? ""}`;
  const [lastKey, setLastKey] = useState("");
  if (parsed && key !== lastKey) {
    // По умолчанию: первый столбец — X, остальные — серии Y (как в выгрузке Saphir: Δt, Δp, производная).
    setLastKey(key);
    const used = target?.yColumns?.length ?? 0;
    setSetup(
      Array.from({ length: nCols }, (_, i) => {
        const { name: n, unit } = splitHeader(parsed.headers?.[i] ?? (i === 0 ? "X" : `Y${i}`));
        return {
          role: i === 0 ? "x" : "y",
          name: n,
          unit,
          marker: template === "custom" ? "line" : i === 1 ? "cross" : "circle",
          color: SERIES_COLORS[(used + i - 1 + SERIES_COLORS.length) % SERIES_COLORS.length] ?? "#2563EB",
        };
      }),
    );
  }

  const patch = (i: number, p: Partial<ColSetup>): void =>
    setSetup((s) => s.map((c, k) => (k === i ? { ...c, ...p } : k !== i && p.role === "x" && c.role === "x" ? { ...c, role: "y" } : c)));

  const load = (): void => {
    if (!studyId || !parsed) return;
    const xi = setup.findIndex((c) => c.role === "x");
    const ys = setup.map((c, i) => ({ c, i })).filter(({ c }) => c.role === "y");
    if (xi < 0) return setErr("Выберите столбец для оси X");
    if (ys.length === 0) return setErr("Выберите хотя бы одну серию Y");
    const mkCol = (i: number): Column => {
      const c = setup[i];
      const title = c ? (c.unit ? `${c.name}, ${c.unit}` : c.name) : `Столбец ${i + 1}`;
      return { id: uid(), name: title, quantity: "other", unit: "-", cells: parsed.rows.map((r) => r[i] ?? "") };
    };
    const xCol = mkCol(xi);
    const yCols = ys.map(({ i }) => mkCol(i));
    const series = ys.map(({ c }, k) => ({ columnId: yCols[k]?.id ?? "", color: c.color, marker: c.marker, xColumnId: xCol.id }));
    const t = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];
    const chart: ChartDef = target
      ? { ...target, yColumns: [...(target.yColumns ?? []), ...series] }
      : newChart("columns", studyId, {
          name: name.trim() || "График",
          xLog: t?.xLog ?? false,
          yLog: t?.yLog ?? false,
          xColumn: xCol.id,
          yColumns: series,
        });
    st.builderAddData(studyId, [xCol, ...yCols], chart);
    st.setDialog(null);
  };

  return (
    <Modal
      title={target ? `Добавить серию к «${target.name}»` : "Загрузить график"}
      sub="Данные строятся как есть, без пересчёта — например, выгрузка log-log из Saphir"
      width={820}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          {err && <span className="warn small">{err}</span>}
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" disabled={!parsed} onClick={load}>
            {target ? "Добавить серии" : "Построить график"}
          </button>
        </>
      }
    >
      {!target && (
        <div className="form-row">
          <label className="field">
            <span>Название</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название графика" />
          </label>
          <div className="field">
            <span>Шаблон шкал</span>
            <div role="group" aria-label="Шаблон" className="seg">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" title={t.hint} aria-pressed={template === t.id} className={template === t.id ? "on" : ""} onClick={() => setTemplate(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="row gap">
        <button
          type="button"
          className="btn"
          onClick={() => {
            navigator.clipboard
              .readText()
              .then(setText)
              .catch(() => setErr("Браузер не дал доступ к буферу — вставьте Ctrl+V в поле ниже"));
          }}
        >
          Вставить из буфера
        </button>
        <label className="btn">
          Файл…
          <input
            type="file"
            accept=".txt,.csv,.tsv,.dat,.prn"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(setText);
              e.target.value = "";
            }}
          />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Первая строка — заголовки
        </label>
        <label className="small">
          Разделитель{" "}
          <select className="input small" value={delim} onChange={(e) => setDelim(e.target.value)} aria-label="Разделитель">
            <option value="auto">авто</option>
            <option value={"\t"}>табуляция</option>
            <option value=";">;</option>
            <option value=",">,</option>
            <option value=" ">пробел</option>
          </select>
        </label>
      </div>
      <textarea
        className="input mono paste-area builder-paste"
        aria-label="Данные графика"
        placeholder={"Вставьте столбцы (Ctrl+V), например:\nΔt, ч\tΔp, атм\tПроизводная, атм\n0,01\t0,52\t0,31\n…"}
        value={text}
        rows={6}
        onChange={(e) => setText(e.target.value)}
      />
      {parsed && (
        <table className="map-table">
          <thead>
            <tr>
              <th>Столбец</th>
              <th>Роль</th>
              <th>Имя</th>
              <th>Единица</th>
              <th>Маркер</th>
              <th>Цвет</th>
              <th>Пример</th>
            </tr>
          </thead>
          <tbody>
            {setup.map((c, i) => (
              <tr key={i} className={c.role === "none" ? "muted" : ""}>
                <td>{i + 1}</td>
                <td>
                  <select className="input small" value={c.role} aria-label={`Роль столбца ${i + 1}`} onChange={(e) => patch(i, { role: e.target.value as Role })}>
                    <option value="x">Ось X</option>
                    <option value="y">Серия Y</option>
                    <option value="none">Не использовать</option>
                  </select>
                </td>
                <td><input className="input small" value={c.name} aria-label={`Имя столбца ${i + 1}`} onChange={(e) => patch(i, { name: e.target.value })} /></td>
                <td><input className="input small unit-input" value={c.unit} aria-label={`Единица столбца ${i + 1}`} onChange={(e) => patch(i, { unit: e.target.value })} /></td>
                <td>
                  {c.role === "y" && (
                    <select className="input small" value={c.marker} aria-label={`Маркер столбца ${i + 1}`} onChange={(e) => patch(i, { marker: e.target.value as Marker })}>
                      <option value="cross">крестик</option>
                      <option value="circle">кружок</option>
                      <option value="dot">точка</option>
                      <option value="line">линия</option>
                    </select>
                  )}
                </td>
                <td>{c.role === "y" && <input type="color" value={c.color} aria-label={`Цвет столбца ${i + 1}`} onChange={(e) => patch(i, { color: e.target.value })} />}</td>
                <td className="mono small muted">{parsed.rows.slice(0, 2).map((r) => r[i] ?? "").join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {parsed && <p className="muted small">Строк данных: {parsed.rows.length}. Десятичная запятая и точка распознаются.</p>}
    </Modal>
  );
}

/** Наложение графиков построителя: новый график, в котором собраны серии выбранных графиков. */
export function OverlayDialog() {
  const st = useApp.getState();
  const studyId = useApp((s) => s.activeStudyId);
  const allCharts = useApp((s) => s.project.charts);
  const charts = useMemo(() => allCharts.filter((c) => c.studyId === studyId && c.kind === "columns"), [allCharts, studyId]);
  const [ids, setIds] = useState<string[]>(charts.slice(0, 2).map((c) => c.id));
  const [name, setName] = useState("Наложение");
  const [recolor, setRecolor] = useState(true);
  const picked = charts.filter((c) => ids.includes(c.id));

  const make = (): void => {
    const first = picked[0];
    if (!studyId || !first?.xColumn) return;
    const series = picked.flatMap((c, k) =>
      (c.yColumns ?? []).map((y) => ({
        ...y,
        xColumnId: y.xColumnId ?? c.xColumn,
        // Один цвет на исходный график — чтобы сразу было видно, где чьи точки.
        color: recolor ? (SERIES_COLORS[k % SERIES_COLORS.length] ?? y.color) : y.color,
      })),
    );
    st.addChart(newChart("columns", studyId, { name, xLog: first.xLog, yLog: first.yLog, xColumn: first.xColumn, yColumns: series }));
    st.setDialog(null);
  };

  return (
    <Modal
      title="Наложить графики"
      sub="Серии выбранных графиков в одном окне, у каждой — свой столбец X"
      width={520}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" disabled={picked.length < 2} onClick={make}>Наложить</button>
        </>
      }
    >
      <label className="field">
        <span>Название</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название наложения" />
      </label>
      <div className="check-list">
        {charts.map((c) => (
          <label key={c.id} className="check-line">
            <input
              type="checkbox"
              checked={ids.includes(c.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))}
            />
            {c.name} <span className="muted small">· {(c.yColumns ?? []).length} сер. · {c.xLog ? "log" : "lin"}/{c.yLog ? "log" : "lin"}</span>
          </label>
        ))}
        {charts.length < 2 && <p className="muted small">Загрузите хотя бы два графика.</p>}
      </div>
      <label className="check-line">
        <input type="checkbox" checked={recolor} onChange={(e) => setRecolor(e.target.checked)} /> Свой цвет для каждого исходного графика
      </label>
      <p className="muted small">Шкалы берутся у первого выбранного графика.</p>
    </Modal>
  );
}
