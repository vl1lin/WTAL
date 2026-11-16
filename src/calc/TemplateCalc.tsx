/**
 * Калькулятор по пользовательскому шаблону.
 *
 * Схема:
 *   CalcTemplate ─► общие параметры (поля над таблицей)
 *               └─► таблица: строки = исследования + свои строки,
 *                   столбцы = параметры «для каждого исследования» + результаты
 *   значение ячейки параметра: resolveInputs() (своё / из исследования / по умолчанию) → evalTemplate()
 *   Ввод числа в ячейку = своё значение (связь с исследованием снимается, ↺ — вернуть).
 *   Все значения в store — в СИ; на экране — в выбранных единицах (values.units).
 */
import { useState } from "react";
import { useApp } from "../store";
import { NumInput } from "../dialogs/common";
import { fmt } from "../core/regression";
import { UNITS, fromSI, toSI, unitLabel, type Dimension } from "../core/units";
import { aggregate, evalTemplate } from "../core/calcTemplate";
import { uid } from "../core/factory";
import type { CalcTemplate, Project, Study, TplFormula, TplParam, TplValues } from "../core/types";
import { GroupEditor } from "./Calculator";
import { candidateLines, emptyValues, lineValue, resolveInputs, type ParamValue } from "./tplInputs";

type Item = TplParam | TplFormula;

/** Значение СИ → единица отображения (для величины «—» без пересчёта). */
const show = (si: number, dim: Dimension, unit: string): number => (dim === "none" ? si : fromSI(si, dim, unit));
const back = (v: number, dim: Dimension, unit: string): number => (dim === "none" ? v : toSI(v, dim, unit));

/**
 * Изменить значения калькулятора для шаблона.
 * @param tplId id шаблона
 * @param fn изменение
 */
function patchValues(tplId: string, fn: (v: TplValues) => TplValues): void {
  const st = useApp.getState();
  const all = st.project.calc.tplValues ?? {};
  st.updateCalc({ tplValues: { ...all, [tplId]: fn(all[tplId] ?? emptyValues()) } });
}

/** Строка калькулятора. */
interface Row {
  id: string;
  name: string;
  study: Study | null;
}

/**
 * Посчитать строку шаблона.
 * @returns входы и результат
 */
function computeRow(tpl: CalcTemplate, row: Row, project: Project) {
  const inputs = resolveInputs(tpl, row.id, row.study, project);
  const res = evalTemplate(tpl, Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.si])));
  return { inputs, res };
}

export function TemplateCalc({ tpl, onEdit }: { tpl: CalcTemplate; onEdit(): void }) {
  const project = useApp((s) => s.project);
  const calc = project.calc;
  const st = useApp.getState();
  const values = calc.tplValues?.[tpl.id] ?? emptyValues();
  // Единица отображения: выбранная пользователем, иначе привычная (первая в списке величины: атм, м³/сут, мД …).
  const unitOf = (it: Item): string => values.units[it.sym] ?? (it.dim === "none" ? it.unit : (UNITS[it.dim][0]?.key ?? it.unit));
  const label = (it: Item, unit = unitOf(it)): string => (it.dim === "none" ? (it.unitText ?? "") : unitLabel(it.dim, unit));

  const studies = project.studies.filter((s) => !s.isMain);
  const rows: Row[] = [...studies.map((s) => ({ id: s.id, name: s.name, study: s })), ...values.custom.map((c) => ({ id: c.id, name: c.name, study: null }))];
  const isSel = (id: string): boolean => calc.selected.includes(id);
  const included = (r: Row): boolean => calc.mode !== "selected" || isSel(r.id);
  const computed = rows.map((r) => ({ row: r, ...computeRow(tpl, r, project) }));

  const common = tpl.params.filter((p) => !p.perStudy);
  const perRow = tpl.params.filter((p) => p.perStudy);
  const results = tpl.formulas.filter((f) => f.result);

  const unitSelect = (it: Item) =>
    it.dim === "none" || UNITS[it.dim].length <= 1 ? (
      <span className="unit-fixed">{label(it)}</span>
    ) : (
      <select
        className="input unit small"
        aria-label={`Единицы: ${it.sym}`}
        value={unitOf(it)}
        onChange={(e) => patchValues(tpl.id, (v) => ({ ...v, units: { ...v.units, [it.sym]: e.target.value } }))}
      >
        {UNITS[it.dim].map((u) => (
          <option key={u.key} value={u.key}>{u.label}</option>
        ))}
      </select>
    );

  const setOwn = (rowId: string, sym: string, si: number | null): void =>
    patchValues(tpl.id, (v) => {
      const row = { ...(v.rows[rowId] ?? {}) };
      if (si === null) delete row[sym];
      else row[sym] = si;
      return { ...v, rows: { ...v.rows, [rowId]: row } };
    });

  const copy = (): void => {
    const head = ["Строка", ...perRow.map((p) => `${p.sym}, ${label(p)}`), ...results.map((f) => `${f.sym}, ${label(f)}`)].join("\t");
    const lines = computed.filter((c) => included(c.row)).map((c) =>
      [c.row.name, ...perRow.map((p) => show(c.inputs[p.sym]?.si ?? Number.NaN, p.dim, unitOf(p))), ...results.map((f) => show(c.res.values[f.sym] ?? Number.NaN, f.dim, unitOf(f)))]
        .map((x) => (typeof x === "number" ? (Number.isFinite(x) ? String(x).replace(".", ",") : "") : x))
        .join("\t"),
    );
    void navigator.clipboard?.writeText([head, ...lines].join("\n"));
  };

  const groupRows =
    calc.mode === "groups"
      ? project.groups.flatMap((g) => {
          const members = computed.filter((c) => g.studyIds.includes(c.row.id));
          return members.length ? [{ id: g.id, name: g.name, n: members.length, members }] : [];
        })
      : [];

  return (
    <section className="calc-main">
      <div className="row gap">
        <div className="grow">
          <h2>{tpl.name}</h2>
          <p className="muted small">
            {tpl.description ? `${tpl.description} ` : ""}Фиолетовые значения взяты из исследования и обновляются сами; введённое число — своё значение (↺ — вернуть связь).
          </p>
        </div>
        <div role="group" aria-label="Рассчитать для" className="seg">
          {(["all", "selected", "groups"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={calc.mode === m} className={calc.mode === m ? "on" : ""} onClick={() => st.updateCalc({ mode: m })}>
              {m === "all" ? "Все" : m === "selected" ? "Выбранные" : "По группам"}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onEdit}>Изменить шаблон</button>
      </div>

      {common.length > 0 && (
        <div className="tpl-common">
          <b>Общие параметры</b>
          {common.map((p) => {
            const cur = values.common[p.sym];
            const si = cur !== undefined && Number.isFinite(cur) ? cur : p.default;
            return (
              <label key={p.id} className="lbl" title={p.name}>
                <span><b className="sym">{p.sym}</b> — {p.name}</span>
                <span className="qty">
                  <NumInput label={p.name} value={show(si, p.dim, unitOf(p))} onChange={(x) => patchValues(tpl.id, (v) => ({ ...v, common: { ...v.common, [p.sym]: back(x, p.dim, unitOf(p)) } }))} />
                  {unitSelect(p)}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div className="row gap">
        <b className="grow">Расчёт</b>
        <button
          type="button"
          className="btn small"
          title="Строка со своими значениями, не связанная с исследованиями"
          onClick={() => patchValues(tpl.id, (v) => ({ ...v, custom: [...v.custom, { id: `row:${uid()}`, name: `Свой расчёт ${v.custom.length + 1}` }] }))}
        >
          + Своя строка
        </button>
        {calc.mode === "groups" && <GroupEditor />}
        <button type="button" className="btn small" onClick={copy}>Копировать результаты</button>
      </div>
      <div className="calc-table-wrap">
        <table className="calc-table">
          <thead>
            <tr>
              <th className="left">Исследование</th>
              {perRow.map((p) => (
                <th key={p.id} className="in" title={p.name}><div className="th-u"><span><b>{p.sym}</b> <span className="muted">{p.name}</span></span>{unitSelect(p)}</div></th>
              ))}
              {results.map((f) => (
                <th key={f.id} className="res" title={f.name}><div className="th-u"><span><b>{f.sym}</b> <span className="muted">{f.name}</span></span>{unitSelect(f)}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computed.map(({ row, inputs, res }) => {
              const off = !included(row);
              return (
                <tr key={row.id} className={off ? "off" : row.study ? "" : "custom-row"}>
                  <td className="left">
                    {row.study ? (
                      <label className="row gap">
                        <input
                          type="checkbox"
                          checked={!off}
                          disabled={calc.mode !== "selected"}
                          aria-label={`Включить ${row.name}`}
                          onChange={(e) => st.updateCalc({ selected: e.target.checked ? [...calc.selected, row.id] : calc.selected.filter((x) => x !== row.id) })}
                        />
                        <b>{row.name}</b>
                      </label>
                    ) : (
                      <div className="row gap">
                        <input
                          className="input small row-name"
                          aria-label="Название строки"
                          value={row.name}
                          onChange={(e) => patchValues(tpl.id, (v) => ({ ...v, custom: v.custom.map((c) => (c.id === row.id ? { ...c, name: e.target.value } : c)) }))}
                        />
                        <button
                          type="button"
                          className="icon-btn row-del"
                          aria-label={`Удалить строку ${row.name}`}
                          onClick={() => patchValues(tpl.id, (v) => ({ ...v, custom: v.custom.filter((c) => c.id !== row.id) }))}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </td>
                  {perRow.map((p) => (
                    <ParamCell key={p.id} tpl={tpl} p={p} row={row} pv={inputs[p.sym]} unit={unitOf(p)} setOwn={setOwn} />
                  ))}
                  {results.map((f) => {
                    const v = res.values[f.sym] ?? Number.NaN;
                    return (
                      <td key={f.id} className="res mono" title={res.errors[f.sym] ?? ""}>
                        {off ? "" : Number.isFinite(v) ? fmt(show(v, f.dim, unitOf(f)), 5) : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {groupRows.map((g) => (
              <tr key={g.id} className="group-row">
                <td className="left" colSpan={1 + perRow.length}><span className="badge blue">Группа</span> {g.name} · {g.n} иссл.</td>
                {results.map((f) => {
                  const v = aggregate(g.members.map((m) => m.res.values[f.sym] ?? Number.NaN), f.agg);
                  const pre = { mean: "ср.", sum: "Σ", min: "мин", max: "макс", none: "" }[f.agg];
                  return <td key={f.id} className="res mono">{Number.isFinite(v) ? `${pre} ${fmt(show(v, f.dim, unitOf(f)), 5)}` : "—"}</td>;
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={1 + perRow.length + results.length} className="muted">Нет исследований — добавьте «+ Своя строка» и введите значения.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Ячейка параметра: значение, его происхождение, выбор прямой. */
function ParamCell(props: { tpl: CalcTemplate; p: TplParam; row: Row; pv: ParamValue | undefined; unit: string; setOwn(rowId: string, sym: string, si: number | null): void }) {
  const { tpl, p, row, pv, unit } = props;
  const project = useApp((s) => s.project);
  const [open, setOpen] = useState(false);
  const si = pv?.si ?? Number.NaN;
  const cls = pv?.origin === "linked" ? "violet" : pv?.origin === "missing" ? "missing" : pv?.origin === "default" ? "dim" : "";
  const src = p.source;
  const lines = src.kind === "line" && row.study ? candidateLines(project, row.study, src) : [];
  return (
    <td title={pv?.note ?? ""}>
      <div className="row gap nowrap">
        <NumInput label={`${p.sym} ${row.name}`} className={cls} value={show(si, p.dim, unit)} onChange={(x) => props.setOwn(row.id, p.sym, back(x, p.dim, unit))} />
        {pv?.origin === "own" && src.kind !== "manual" && row.study && (
          <button type="button" className="icon-btn" aria-label={`Вернуть связь ${p.sym}`} title="Вернуть значение из исследования" onClick={() => props.setOwn(row.id, p.sym, null)}>↺</button>
        )}
        {pv?.origin === "own" && (src.kind === "manual" || !row.study) && (
          <button type="button" className="icon-btn" aria-label={`Сбросить ${p.sym}`} title="Вернуть значение по умолчанию" onClick={() => props.setOwn(row.id, p.sym, null)}>↺</button>
        )}
        {src.kind === "line" && row.study && (
          <div className="picker">
            <button type="button" className="icon-btn violet" aria-label={`Выбрать прямую для ${p.sym} ${row.name}`} title="Выбрать прямую" onClick={() => setOpen(!open)}>⟋</button>
            {open && (
              <div className="menu picker-menu" role="menu">
                {lines.length === 0 && <div className="muted small pad">Нет подходящих прямых на графиках этого исследования.</div>}
                {lines.map((o) => (
                  <button
                    key={o.line.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      patchValues(tpl.id, (v) => ({ ...v, lines: { ...v.lines, [row.id]: { ...(v.lines[row.id] ?? {}), [p.sym]: o.line.id } } }));
                      props.setOwn(row.id, p.sym, null);
                      setOpen(false);
                    }}
                  >
                    <span>{o.chart.name} · {o.line.name}</span>
                    <span className="mono">{fmt(lineValue(o.line, o.chart, src), 5)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </td>
  );
}
