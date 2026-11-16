/**
 * Редактор шаблона расчёта.
 *
 * Схема:
 *   черновик (копия шаблона) ──правка──► «Сохранить» → проект + библиотека браузера
 *   ├─ 1. Исходные данные: обозначение, название, величина и единица в формуле, откуда брать, где задаётся, по умолчанию
 *   ├─ 2. Формулы: обозначение, название, формула, единица результата, результат/промежуточный, итог по группе
 *   └─ проверка справа: checkTemplate() + расчёт на выбранном исследовании (resolveInputs → evalTemplate)
 */
import { Fragment, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { UNITS, fromSI, toSI, unitLabel, type Dimension } from "../core/units";
import { checkTemplate, evalTemplate } from "../core/calcTemplate";
import { fmt } from "../core/regression";
import { parseUserNumber } from "../core/formula";
import { formula, param } from "../core/templates";
import { uid } from "../core/factory";
import type { CalcTemplate, ParamSource, TplFormula, TplParam } from "../core/types";
import { resolveInputs } from "./tplInputs";
import { exportTemplate, saveToLibrary } from "./library";

/** Величины, доступные в шаблоне, с подписями. */
const DIMS: [Dimension, string][] = [
  ["none", "без пересчёта"],
  ["pressure", "давление"],
  ["time", "время"],
  ["rate", "дебит"],
  ["length", "длина"],
  ["area", "площадь"],
  ["permeability", "проницаемость"],
  ["viscosity", "вязкость"],
  ["compressibility", "сжимаемость"],
  ["density", "плотность"],
  ["fvf", "объёмный коэф."],
  ["fraction", "доля"],
  ["invariant", "наклон от √t"],
  ["temperature", "температура"],
  ["count", "количество"],
];

const SOURCE_KINDS: [ParamSource["kind"], string][] = [
  ["manual", "Вручную"],
  ["line", "Прямая на графике"],
  ["table", "Таблица исследования"],
  ["study", "Свойство исследования"],
  ["template", "Результат шаблона"],
];

/**
 * Источник по умолчанию для выбранного вида.
 * @param kind вид источника
 * @param templates шаблоны проекта (для «результат шаблона»)
 */
function defaultSource(kind: ParamSource["kind"], templates: CalcTemplate[]): ParamSource {
  switch (kind) {
    case "line":
      return { kind, axes: "any", what: "slope", at: 1, abs: true };
    case "table":
      return { kind, what: "pFirst" };
    case "study":
      return { kind, what: "rate" };
    case "template": {
      const t = templates[0];
      return { kind, templateId: t?.id ?? "", sym: t?.formulas.find((f) => f.result)?.sym ?? "" };
    }
    default:
      return { kind: "manual" };
  }
}

/** Число в поле редактора: пустое поле — «нет значения» (NaN). */
function OptNum(props: { value: number; onChange(v: number): void; label: string; width?: number }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (Number.isFinite(props.value) ? fmt(props.value, 6) : "");
  const commit = (): void => {
    if (text === null) return;
    const n = text.trim() === "" ? Number.NaN : parseUserNumber(text.replace(/[eE]/, "e"));
    if (n !== null) props.onChange(n);
    setText(null);
  };
  return (
    <input
      className="input mono num small"
      style={{ width: props.width ?? 84 }}
      aria-label={props.label}
      value={shown}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** Выбор величины и единицы (для «без пересчёта» — подпись единицы текстом). */
function DimUnit(props: { item: TplParam | TplFormula; onChange(p: Partial<TplParam & TplFormula>): void }) {
  const { item } = props;
  return (
    <div className="row gap nowrap">
      <select
        className="input small"
        aria-label={`Величина ${item.sym}`}
        value={item.dim}
        onChange={(e) => {
          const dim = e.target.value as Dimension;
          props.onChange({ dim, unit: UNITS[dim][0]?.key ?? "-" });
        }}
      >
        {DIMS.map(([d, l]) => (
          <option key={d} value={d}>{l}</option>
        ))}
      </select>
      {item.dim === "none" ? (
        <input className="input small" style={{ width: 70 }} aria-label={`Подпись единицы ${item.sym}`} placeholder="ед." value={item.unitText ?? ""} onChange={(e) => props.onChange({ unitText: e.target.value })} />
      ) : (
        <select className="input small" aria-label={`Единица ${item.sym}`} value={item.unit} onChange={(e) => props.onChange({ unit: e.target.value })}>
          {UNITS[item.dim].map((u) => (
            <option key={u.key} value={u.key}>{u.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Настройка источника значения параметра. */
function SourceEditor(props: { p: TplParam; self: string; onChange(s: ParamSource): void }) {
  const stored = useApp((s) => s.project.calc.templates);
  const templates = stored ?? [];
  const others = templates.filter((t) => t.id !== props.self);
  const src = props.p.source;
  if (!props.p.perStudy) return <span className="muted small">общий — вводится над таблицей</span>;
  return (
    <div className="src-edit">
      <select className="input small" aria-label={`Источник ${props.p.sym}`} value={src.kind} onChange={(e) => props.onChange(defaultSource(e.target.value as ParamSource["kind"], others))}>
        {SOURCE_KINDS.filter(([k]) => k !== "template" || others.length > 0).map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      {src.kind === "line" && (
        <>
          <select className="input small" aria-label="Оси графика" value={src.axes} onChange={(e) => props.onChange({ ...src, axes: e.target.value as typeof src.axes })}>
            <option value="any">любой график</option>
            <option value="semilog">Semilog (lg X)</option>
            <option value="loglog">Log-log</option>
            <option value="linear">линейные оси (√t …)</option>
          </select>
          <select className="input small" aria-label="Величина прямой" value={src.what} onChange={(e) => props.onChange({ ...src, what: e.target.value as typeof src.what })}>
            <option value="slope">наклон</option>
            <option value="intercept">отрезок на оси Y</option>
            <option value="yAtX">Y при X =</option>
            <option value="xAtY">X при Y =</option>
          </select>
          {(src.what === "yAtX" || src.what === "xAtY") && <OptNum label="Значение" value={src.at} width={60} onChange={(at) => props.onChange({ ...src, at: Number.isFinite(at) ? at : 1 })} />}
          <label className="check-line small">
            <input type="checkbox" checked={src.abs} onChange={(e) => props.onChange({ ...src, abs: e.target.checked })} />|x|
          </label>
        </>
      )}
      {src.kind === "table" && (
        <select className="input small" aria-label="Что взять из таблицы" value={src.what} onChange={(e) => props.onChange({ ...src, what: e.target.value as typeof src.what })}>
          <option value="pFirst">давление в начале периода</option>
          <option value="pLast">давление в конце периода</option>
          <option value="pMin">минимальное давление</option>
          <option value="pMax">максимальное давление</option>
          <option value="dtLast">длительность периода Δt</option>
        </select>
      )}
      {src.kind === "study" && (
        <select className="input small" aria-label="Свойство исследования" value={src.what} onChange={(e) => props.onChange({ ...src, what: e.target.value as typeof src.what })}>
          <option value="rate">дебит (до остановки / режима)</option>
          <option value="tp">время работы tp</option>
        </select>
      )}
      {src.kind === "template" && (
        <>
          <select className="input small" aria-label="Шаблон" value={src.templateId} onChange={(e) => props.onChange({ ...src, templateId: e.target.value, sym: others.find((t) => t.id === e.target.value)?.formulas[0]?.sym ?? "" })}>
            {others.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select className="input small" aria-label="Результат" value={src.sym} onChange={(e) => props.onChange({ ...src, sym: e.target.value })}>
            {(others.find((t) => t.id === src.templateId)?.formulas ?? []).map((f) => (
              <option key={f.id} value={f.sym}>{f.sym} — {f.name}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

const show = (si: number, dim: Dimension, unit: string): number => (dim === "none" ? si : fromSI(si, dim, unit));
const back = (v: number, dim: Dimension, unit: string): number => (dim === "none" ? v : toSI(v, dim, unit));
const ulabel = (it: TplParam | TplFormula): string => (it.dim === "none" ? (it.unitText ?? "") : unitLabel(it.dim, it.unit));

export function TemplateEditor(props: { tpl: CalcTemplate; isNew: boolean; onDone(): void }) {
  const st = useApp.getState();
  const project = useApp((s) => s.project);
  const [draft, setDraft] = useState<CalcTemplate>(props.tpl);
  const [checkRow, setCheckRow] = useState<string>("");
  const exprRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusF, setFocusF] = useState<string | null>(null);
  const issues = useMemo(() => checkTemplate(draft), [draft]);
  const studies = project.studies.filter((s) => !s.isMain);

  const setP = (id: string, patch: Partial<TplParam>): void => setDraft((d) => ({ ...d, params: d.params.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setF = (id: string, patch: Partial<TplFormula>): void => setDraft((d) => ({ ...d, formulas: d.formulas.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const move = <T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] => {
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const out = [...list];
    const a = out[i];
    const b = out[j];
    if (!a || !b) return list;
    out[i] = b;
    out[j] = a;
    return out;
  };
  const freeSym = (base: string): string => {
    const used = new Set([...draft.params, ...draft.formulas].map((x) => x.sym));
    let k = 1;
    while (used.has(`${base}${k}`)) k++;
    return `${base}${k}`;
  };

  // Проверка на выбранном исследовании (или на значениях по умолчанию).
  const study = studies.find((s) => s.id === checkRow) ?? null;
  const tplForCheck = { ...draft, id: props.tpl.id };
  const inputs = resolveInputs(tplForCheck, checkRow || "__check__", study, project);
  const res = evalTemplate(draft, Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.si])));

  const insertSym = (sym: string): void => {
    if (!focusF) return;
    const el = exprRefs.current[focusF];
    const f = draft.formulas.find((x) => x.id === focusF);
    if (!el || !f) return;
    const a = el.selectionStart ?? f.expr.length;
    const b = el.selectionEnd ?? a;
    const expr = f.expr.slice(0, a) + sym + f.expr.slice(b);
    setF(f.id, { expr });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + sym.length, a + sym.length);
    });
  };

  const save = (): void => {
    const tpls = project.calc.templates ?? [];
    const exists = tpls.some((t) => t.id === draft.id);
    st.updateCalc({ templates: exists ? tpls.map((t) => (t.id === draft.id ? draft : t)) : [...tpls, draft], activeTask: draft.id });
    saveToLibrary(draft);
    props.onDone();
  };

  const available = (fid: string): string[] => {
    const i = draft.formulas.findIndex((f) => f.id === fid);
    return [...draft.params.map((p) => p.sym), ...draft.formulas.slice(0, Math.max(0, i)).map((f) => f.sym)];
  };

  return (
    <div className="tpl-editor">
      <section className="calc-main">
        <div className="row gap">
          <label className="lbl grow">
            Название шаблона
            <input className="input tpl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <button type="button" className="btn" onClick={() => exportTemplate(draft)} title="Скачать шаблон файлом — например, чтобы передать коллеге">Экспорт .json</button>
          {!props.isNew && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                if (!confirm(`Удалить шаблон «${props.tpl.name}» из проекта? В библиотеке браузера он останется.`)) return;
                const tpls = (project.calc.templates ?? []).filter((t) => t.id !== props.tpl.id);
                st.updateCalc({ templates: tpls, activeTask: "fracture" });
                props.onDone();
              }}
            >
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={props.onDone}>Отмена</button>
          <button type="button" className="btn primary" disabled={issues.length > 0 || !draft.name.trim()} title={issues.length ? "Исправьте ошибки шаблона" : ""} onClick={save}>Сохранить</button>
        </div>
        <input className="input" aria-label="Описание шаблона" placeholder="Описание: что считает, по какому графику, какие единицы" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />

        <div className="tpl-block">
          <div className="tpl-head">
            <h3>1. Исходные данные</h3>
            <span className="muted small">единица — в которой значение подставляется в формулу; в калькуляторе можно вводить в любых единицах</span>
            <span className="grow" />
            <button type="button" className="btn small" onClick={() => setDraft({ ...draft, params: [...draft.params, param(freeSym("x"), "Параметр", "none", "-", true)] })}>+ Параметр</button>
          </div>
          <table className="tpl-table">
            <thead>
              <tr>
                <th />
                <th>Обозн.</th>
                <th>Название</th>
                <th>Величина и единица в формуле</th>
                <th>Задаётся</th>
                <th>По умолч.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.params.map((p) => (
                <Fragment key={p.id}>
                <tr className={`main-line${issues.some((i) => i.id === p.id) ? " bad" : ""}`}>
                  <td className="mv">
                    <button type="button" className="icon-btn" aria-label={`Выше ${p.sym}`} onClick={() => setDraft({ ...draft, params: move(draft.params, p.id, -1) })}>↑</button>
                    <button type="button" className="icon-btn" aria-label={`Ниже ${p.sym}`} onClick={() => setDraft({ ...draft, params: move(draft.params, p.id, 1) })}>↓</button>
                  </td>
                  <td><input className="input small sym-in" aria-label="Обозначение параметра" value={p.sym} onChange={(e) => setP(p.id, { sym: e.target.value.trim() })} /></td>
                  <td className="name-td"><input className="input small" aria-label={`Название ${p.sym}`} value={p.name} onChange={(e) => setP(p.id, { name: e.target.value })} /></td>
                  <td>
                    <DimUnit
                      item={p}
                      onChange={(patch) => {
                        // Значение по умолчанию хранится в СИ — при смене величины теряет смысл.
                        const dimChanged = patch.dim !== undefined && patch.dim !== p.dim;
                        setP(p.id, { ...patch, ...(dimChanged ? { default: Number.NaN } : {}) });
                      }}
                    />
                  </td>
                  <td>
                    <select className="input small" aria-label={`Где задаётся ${p.sym}`} value={p.perStudy ? "row" : "common"} onChange={(e) => setP(p.id, { perStudy: e.target.value === "row", ...(e.target.value === "common" ? { source: { kind: "manual" } } : {}) })}>
                      <option value="row">у каждого исследования</option>
                      <option value="common">общий</option>
                    </select>
                  </td>
                  <td>
                    <div className="row gap nowrap">
                      <OptNum label={`По умолчанию ${p.sym}`} value={show(p.default, p.dim, p.unit)} onChange={(v) => setP(p.id, { default: Number.isFinite(v) ? back(v, p.dim, p.unit) : Number.NaN })} />
                      <span className="muted small">{ulabel(p)}</span>
                    </div>
                  </td>
                  <td><button type="button" className="icon-btn row-del" aria-label={`Удалить параметр ${p.sym}`} onClick={() => setDraft({ ...draft, params: draft.params.filter((x) => x.id !== p.id) })}>✕</button></td>
                </tr>
                {p.perStudy && <tr className="sub-line">
                  <td />
                  <td colSpan={6}>
                    <div className="row gap nowrap">
                      <span className="muted small">Откуда брать:</span>
                      <SourceEditor p={p} self={draft.id} onChange={(source) => setP(p.id, { source })} />
                    </div>
                  </td>
                </tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="tpl-block">
          <div className="tpl-head">
            <h3>2. Формулы</h3>
            <span className="muted small">считаются сверху вниз; можно ссылаться на параметры и на формулы выше</span>
            <span className="grow" />
            <button type="button" className="btn small" onClick={() => setDraft({ ...draft, formulas: [...draft.formulas, formula(freeSym("r"), "Результат", "= ", "none", "-")] })}>+ Формула</button>
          </div>
          <table className="tpl-table">
            <thead>
              <tr>
                <th />
                <th>Обозн.</th>
                <th>Название</th>
                <th>Единица результата</th>
                <th>В таблицу</th>
                <th>Итог по группе</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.formulas.map((f) => {
                const err = issues.find((i) => i.id === f.id)?.text ?? res.errors[f.sym];
                return (
                  <Fragment key={f.id}>
                  <tr className={`main-line${issues.some((i) => i.id === f.id) ? " bad" : ""}`}>
                    <td className="mv">
                      <button type="button" className="icon-btn" aria-label={`Выше ${f.sym}`} onClick={() => setDraft({ ...draft, formulas: move(draft.formulas, f.id, -1) })}>↑</button>
                      <button type="button" className="icon-btn" aria-label={`Ниже ${f.sym}`} onClick={() => setDraft({ ...draft, formulas: move(draft.formulas, f.id, 1) })}>↓</button>
                    </td>
                    <td><input className="input small sym-in res" aria-label="Обозначение формулы" value={f.sym} onChange={(e) => setF(f.id, { sym: e.target.value.trim() })} /></td>
                    <td className="name-td"><input className="input small" aria-label={`Название ${f.sym}`} value={f.name} onChange={(e) => setF(f.id, { name: e.target.value })} /></td>
                    <td><DimUnit item={f} onChange={(patch) => setF(f.id, patch)} /></td>
                    <td className="center"><input type="checkbox" aria-label={`Выводить ${f.sym} в таблицу`} checked={f.result} onChange={(e) => setF(f.id, { result: e.target.checked })} /></td>
                    <td>
                      <select className="input small" aria-label={`Итог по группе ${f.sym}`} value={f.agg} onChange={(e) => setF(f.id, { agg: e.target.value as TplFormula["agg"] })}>
                        <option value="mean">среднее</option>
                        <option value="sum">сумма</option>
                        <option value="min">минимум</option>
                        <option value="max">максимум</option>
                        <option value="none">нет</option>
                      </select>
                    </td>
                    <td><button type="button" className="icon-btn row-del" aria-label={`Удалить формулу ${f.sym}`} onClick={() => setDraft({ ...draft, formulas: draft.formulas.filter((x) => x.id !== f.id) })}>✕</button></td>
                  </tr>
                  <tr className="sub-line">
                    <td />
                    <td colSpan={6} className="expr-cell">
                      <input
                        ref={(el) => {
                          exprRefs.current[f.id] = el;
                        }}
                        className="input mono small expr"
                        aria-label={`Формула ${f.sym}`}
                        value={f.expr}
                        onFocus={() => setFocusF(f.id)}
                        onChange={(e) => setF(f.id, { expr: e.target.value })}
                      />
                      {focusF === f.id && (
                        <div className="sym-chips">
                          {available(f.id).map((s) => (
                            <button key={s} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insertSym(s)}>{s}</button>
                          ))}
                          {["SQRT(", "LN(", "LG(", "EXP(", "PI()", "^"].map((s) => (
                            <button key={s} type="button" className="chip fn" onMouseDown={(e) => e.preventDefault()} onClick={() => insertSym(s)}>{s}</button>
                          ))}
                        </div>
                      )}
                      {err && <div className="warn small">{err}</div>}
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="tpl-check" aria-label="Проверка шаблона">
        <h3>Проверка шаблона</h3>
        <label className="lbl">
          Посчитать на
          <select className="input" value={checkRow} onChange={(e) => setCheckRow(e.target.value)}>
            <option value="">значениях по умолчанию</option>
            {studies.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <table className="check-table">
          <tbody>
            {draft.params.map((p) => {
              const v = inputs[p.sym];
              return (
                <tr key={p.id} title={v?.note}>
                  <td className="sym">{p.sym}</td>
                  <td className={`mono num${v?.origin === "linked" ? " violet-t" : ""}`}>{v && Number.isFinite(v.si) ? `${fmt(show(v.si, p.dim, p.unit), 5)} ${ulabel(p)}` : "—"}</td>
                </tr>
              );
            })}
            <tr><td colSpan={2}><hr /></td></tr>
            {draft.formulas.map((f) => {
              const v = res.values[f.sym] ?? Number.NaN;
              return (
                <tr key={f.id} title={res.errors[f.sym] ?? ""}>
                  <td className="sym res-t">{f.sym}</td>
                  <td className="mono num"><b>{Number.isFinite(v) ? `${fmt(show(v, f.dim, f.unit), 5)} ${ulabel(f)}` : "—"}</b></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ul className="check-list-ul">
          {issues.length === 0 ? <li className="ok">✓ Обозначения и формулы в порядке</li> : issues.map((i) => <li key={i.id + i.text} className="bad">⚠ {i.text}</li>)}
          {Object.entries(res.errors)
            .filter(([sym]) => !issues.some((i) => i.text.startsWith(`${sym}:`)))
            .map(([sym, e]) => (
              <li key={sym} className="note">• {sym}: {e}</li>
            ))}
        </ul>
        <div className="hint-box small">
          <b>Формулы</b> — как в столбцах таблицы: <span className="mono">+ − * / ^</span>, <span className="mono">SQRT LN LG EXP ABS PI() MIN MAX</span>.
          Десятичная запятая или точка; аргументы функций — через «;». Значения подставляются в единицах параметров, результат — в единице формулы.
        </div>
      </aside>
    </div>
  );
}

/** Новый id для копии шаблона. */
export function copyTemplate(t: CalcTemplate, name: string): CalcTemplate {
  return { ...t, id: uid(), name, params: t.params.map((p) => ({ ...p, id: uid() })), formulas: t.formulas.map((f) => ({ ...f, id: uid() })) };
}
