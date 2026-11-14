/**
 * Диалоги таблицы и исследования.
 *
 * Схема:
 *   NewColumnDialog   — ƒx-столбец: имя, смысл, единицы, формула; проверка формулы на текущих данных
 *   ColumnPropsDialog — свойства столбца: имя, смысл, единицы, роль (время/давление/расход), формула, удаление
 *   StudyDialog       — исследование: имя, КВД/КСД, tp, дебит до остановки, роли столбцов, удаление
 */
import { useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Modal, NumInput, UnitSelect } from "./common";
import type { Column, Quantity, Study, TestType } from "../core/types";
import { computeSheet } from "../core/sheet";
import { dimensionOfQuantity, fromSI, toSI, UNITS } from "../core/units";
import { colLetter } from "../core/formula";

const QUANTITIES: [Quantity, string][] = [
  ["time", "Время / функция времени"],
  ["datetime", "Дата и время"],
  ["pressure", "Давление"],
  ["rate", "Расход"],
  ["temperature", "Температура"],
  ["dimensionless", "Безразмерная"],
  ["other", "Другое"],
];

const FUNCS: [string, string][] = [
  ["SQRT(x)", "корень"],
  ["LN(x)", "натуральный логарифм"],
  ["LOG10(x)", "десятичный логарифм"],
  ["EXP(x)", "экспонента"],
  ["POW(x; n)", "степень, также x^n"],
  ["ABS(x)", "модуль"],
  ["MIN, MAX, SUM, AVERAGE", "по диапазону A1:A10"],
  ["DIFF(x)", "разность с предыдущей строкой"],
  ["FIRST(x), LAST(x)", "значение в первой/последней строке"],
  ["IF(усл; a; b)", "условие"],
  ["ROW()", "номер строки"],
  ["PI()", "число π"],
];

/**
 * Проверить формулу столбца на данных исследования.
 * @param study исследование
 * @param formula формула
 * @returns число посчитанных значений и первая ошибка
 */
function checkFormula(study: Study, formula: string): { ok: number; err: string | null } {
  if (!formula.trim().startsWith("=")) return { ok: 0, err: "Формула должна начинаться со знака «=»" };
  const tmp: Column = { id: "__tmp", name: "__tmp", quantity: "other", unit: "-", cells: [], formula };
  const s = computeSheet({ ...study, columns: [...study.columns, tmp] });
  const ci = study.columns.length;
  let ok = 0;
  let err: string | null = null;
  for (let r = 0; r < s.rowCount; r++) {
    const e = s.errorAt(ci, r);
    if (e) {
      if (!err && e !== "#Н/Д") err = `Строка ${r + 1}: ${e}`;
    } else ok++;
  }
  return { ok, err };
}

export function NewColumnDialog() {
  const st = useApp.getState();
  const studyId = useApp((s) => s.activeStudyId) ?? "";
  const study = useApp((s) => s.project.studies.find((x) => x.id === studyId));
  const [name, setName] = useState("√t");
  const [quantity, setQuantity] = useState<Quantity>("other");
  const [unit, setUnit] = useState("-");
  const [formula, setFormula] = useState("= SQRT([Время])");
  const ta = useRef<HTMLTextAreaElement>(null);
  const check = useMemo(() => (study ? checkFormula(study, formula) : { ok: 0, err: null }), [study, formula]);
  if (!study) return null;
  const insert = (s: string): void => {
    const el = ta.current;
    const pos = el?.selectionStart ?? formula.length;
    setFormula(formula.slice(0, pos) + s + formula.slice(el?.selectionEnd ?? pos));
    el?.focus();
  };
  return (
    <Modal
      title="Новый столбец с формулой (ƒx)"
      sub={study.name}
      width={720}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button
            type="button"
            className="btn violet"
            disabled={!formula.trim().startsWith("=")}
            onClick={() => {
              st.addColumn(study.id, { name: name.trim() || "ƒx", quantity, unit, formula: formula.trim() });
              st.setDialog(null);
            }}
          >
            Добавить столбец
          </button>
        </>
      }
    >
      <div className="col gap">
        <div className="three-col">
          <label className="lbl">Название<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="lbl">
            Физический смысл
            <select className="input" value={quantity} onChange={(e) => { const q = e.target.value as Quantity; setQuantity(q); setUnit(UNITS[dimensionOfQuantity(q)][0]?.key ?? "-"); }}>
              {QUANTITIES.map(([q, l]) => <option key={q} value={q}>{l}</option>)}
            </select>
          </label>
          <label className="lbl">Единицы<UnitSelect dim={dimensionOfQuantity(quantity)} value={unit} label={name} onChange={setUnit} /></label>
        </div>
        <label className="lbl">
          Формула — как в Excel: столбцы в квадратных скобках [Имя], ячейки A1, $A$1, диапазоны A1:A10, предыдущая строка [Имя]@-1
          <textarea ref={ta} className="formula-area" spellCheck={false} value={formula} onChange={(e) => setFormula(e.target.value)} />
        </label>
        <div className="row gap wrap small">
          <span className="muted">Вставить столбец:</span>
          {study.columns.map((c, i) => (
            <button key={c.id} type="button" className="chip-btn mono" title={`Столбец ${colLetter(i)}`} onClick={() => insert(`[${c.name}]`)}>[{c.name}]</button>
          ))}
        </div>
        <div className="two-col">
          <div>
            <span className="muted small">Функции (клик — вставить)</span>
            <ul className="func-list">
              {FUNCS.map(([f, d]) => (
                <li key={f}>
                  <button type="button" onClick={() => insert(f.split(",")[0]?.replace(/\(.*\)/, "(") ?? "")}>
                    <b className="mono">{f}</b> <span className="muted">{d}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="col gap">
            <span className="muted small">Проверка</span>
            {check.err ? <div className="banner warn small">{check.err}</div> : <div className="banner green small">Формула корректна. Рассчитано значений: {check.ok}.</div>}
            <div className="hint-box small">
              Формула применяется ко всем строкам, у которых ячейка пустая. Любую ячейку можно переопределить вручную — например, ввести 0 в первую строку.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function ColumnPropsDialog({ columnId }: { columnId: string }) {
  const st = useApp.getState();
  const studyId = useApp((s) => s.activeStudyId) ?? "";
  const study = useApp((s) => s.project.studies.find((x) => x.id === studyId));
  const col = study?.columns.find((c) => c.id === columnId);
  const [c, setC] = useState<Column | undefined>(col);
  const roleNow = (): string => (!study ? "" : study.roles.time === columnId ? "time" : study.roles.pressure === columnId ? "pressure" : study.roles.rate === columnId ? "rate" : "");
  const [role, setRole] = useState(roleNow());
  const check = useMemo(() => (study && c?.formula ? checkFormula(study, c.formula) : null), [study, c?.formula]);
  if (!study || !c) return null;
  const save = (): void => {
    st.updateColumn(study.id, c.id, { name: c.name, quantity: c.quantity, unit: c.unit, formula: c.formula?.trim() ? c.formula.trim() : undefined });
    const roles = { ...study.roles };
    (["time", "pressure", "rate"] as const).forEach((k) => {
      if (roles[k] === c.id) delete roles[k];
    });
    if (role === "time" || role === "pressure" || role === "rate") roles[role] = c.id;
    st.updateStudy(study.id, { roles });
    st.setDialog(null);
  };
  return (
    <Modal
      title="Свойства столбца"
      sub={`${study.name} · ${colLetter(study.columns.indexOf(col ?? c))}`}
      width={620}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button type="button" className="btn danger" onClick={() => { if (confirm(`Удалить столбец «${c.name}»?`)) { st.removeColumn(study.id, c.id); st.setDialog(null); } }}>Удалить столбец</button>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" onClick={save}>Сохранить</button>
        </>
      }
    >
      <div className="col gap">
        <div className="three-col">
          <label className="lbl">Название<input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
          <label className="lbl">
            Физический смысл
            <select className="input" value={c.quantity} onChange={(e) => { const q = e.target.value as Quantity; setC({ ...c, quantity: q, unit: UNITS[dimensionOfQuantity(q)][0]?.key ?? "-" }); }}>
              {QUANTITIES.map(([q, l]) => <option key={q} value={q}>{l}</option>)}
            </select>
          </label>
          <label className="lbl">Единицы<UnitSelect dim={dimensionOfQuantity(c.quantity)} value={c.unit} label={c.name} onChange={(unit) => setC({ ...c, unit })} /></label>
        </div>
        <label className="lbl">
          Роль в расчётах ГДИС
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">— нет —</option>
            <option value="time">Время (ось Δt)</option>
            <option value="pressure">Давление</option>
            <option value="rate">Дебит</option>
          </select>
        </label>
        <label className="lbl">
          Формула столбца (ƒx) — необязательно
          <input className="input mono" value={c.formula ?? ""} placeholder="= SQRT([Время])" onChange={(e) => setC({ ...c, formula: e.target.value })} />
        </label>
        {check && (check.err ? <div className="banner warn small">{check.err}</div> : <div className="banner green small">Формула корректна, значений: {check.ok}</div>)}
        <div className="hint-box small">Смена единиц не пересчитывает числа в ячейках — она говорит, в каких единицах они записаны.</div>
      </div>
    </Modal>
  );
}

export function StudyDialog({ studyId }: { studyId: string }) {
  const st = useApp.getState();
  const study = useApp((s) => s.project.studies.find((x) => x.id === studyId));
  const [s, setS] = useState<Study | undefined>(study);
  if (!study || !s) return null;
  const roleSel = (k: "time" | "pressure" | "rate", label: string) => (
    <label className="lbl">
      {label}
      <select className="input" value={s.roles[k] ?? ""} onChange={(e) => setS({ ...s, roles: { ...s.roles, [k]: e.target.value || undefined } })}>
        <option value="">— нет —</option>
        {s.columns.map((c, i) => <option key={c.id} value={c.id}>{colLetter(i)} — {c.name}</option>)}
      </select>
    </label>
  );
  return (
    <Modal
      title="Настройки исследования"
      sub={study.name}
      width={620}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          <button type="button" className="btn danger" onClick={() => { if (confirm(`Удалить исследование «${study.name}» вместе с его графиками?`)) { st.removeStudy(study.id); st.setDialog(null); } }}>Удалить исследование</button>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" onClick={() => { st.updateStudy(study.id, { name: s.name, testType: s.testType, tpSeconds: s.tpSeconds, rateBeforeM3s: s.rateBeforeM3s, roles: s.roles }); st.setDialog(null); }}>Сохранить</button>
        </>
      }
    >
      <div className="col gap">
        <div className="two-col">
          <label className="lbl">Название<input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
          <label className="lbl">
            Тип
            <select className="input" value={s.testType} onChange={(e) => setS({ ...s, testType: e.target.value as TestType })}>
              <option value="buildup">КВД (восстановление): Δp = p − p₀</option>
              <option value="drawdown">КСД / падение: Δp = p₀ − p</option>
            </select>
          </label>
          <label className="lbl">Время работы до остановки tp, ч<NumInput label="tp" value={s.tpSeconds / 3600} onChange={(v) => setS({ ...s, tpSeconds: v * 3600 })} /></label>
          <label className="lbl">Дебит до остановки, м³/сут<NumInput label="Дебит до остановки" value={fromSI(s.rateBeforeM3s, "rate", "m3/d")} onChange={(v) => setS({ ...s, rateBeforeM3s: toSI(v, "rate", "m3/d") })} /></label>
        </div>
        <b className="small">Столбцы для расчётов</b>
        <div className="three-col">
          {roleSel("time", "Время")}
          {roleSel("pressure", "Давление")}
          {roleSel("rate", "Дебит")}
        </div>
        <div className="hint-box small">Время отсчитывается от первой строки с временем и давлением. Столбец «Дата и время» тоже можно назначить временем.</div>
      </div>
    </Modal>
  );
}
