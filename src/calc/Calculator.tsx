/**
 * Калькулятор: площадь поверхности трещин ГРП и полудлины по инварианте.
 *
 * Схема:
 *   CalcState (СИ, store.project.calc)
 *   ├─ параметры пласта и флюидов — поля QtyInput с выбором единиц (пересчёт при смене единиц)
 *   ├─ таблица исследований: q, φ, m (m можно взять из прямой на графике исследования)
 *   ├─ режим: все / выбранные / по группам (группа — среднее по исследованиям группы)
 *   └─ fractureArea() → A, Σx_f, x̄_f в выбранных единицах; копирование результатов
 */
import { useState } from "react";
import { useApp } from "../store";
import { QtyInput, UnitSelect, NumInput } from "../dialogs/common";
import { fractureArea, mixture } from "../core/fracture";
import type { CalcState, FluidProps, Study } from "../core/types";
import { fromSI, toSI, type Dimension } from "../core/units";
import { fmt } from "../core/regression";
import { lineStats } from "../charts/trend";
import { buildChartData } from "../charts/series";

const DEFAULT_UNITS: Record<string, string> = {
  h: "m",
  k: "mD",
  wc: "frac",
  fvf: "m3/m3",
  mu: "cP",
  ct: "1/atm",
  rho: "kg/m3",
  q: "m3/d",
  phi: "frac",
  m: "atm/h05",
  A: "m2",
  L: "m",
};

export function Calculator() {
  const calc = useApp((s) => s.project.calc);
  const studies = useApp((s) => s.project.studies);
  const groups = useApp((s) => s.project.groups);
  const st = useApp.getState();
  const u = (k: string): string => calc.units[k] ?? DEFAULT_UNITS[k] ?? "-";
  const setU = (k: string) => (v: string): void => st.updateCalc({ units: { ...calc.units, [k]: v } });
  const set = (p: Partial<CalcState>): void => st.updateCalc(p);
  const mx = mixture(calc);

  const perStudy = (s: Study) => calc.perStudy[s.id] ?? { rate_m3_s: s.rateBeforeM3s, porosity: 0.13, invariant_Pa_s05: Number.NaN };
  const setPer = (s: Study, patch: Partial<CalcState["perStudy"][string]>): void =>
    set({ perStudy: { ...calc.perStudy, [s.id]: { ...perStudy(s), ...patch } } });

  const isSel = (id: string): boolean => calc.selected.includes(id);
  const included = calc.mode === "selected" ? studies.filter((s) => isSel(s.id)) : studies;
  const result = (s: Study) => {
    const p = perStudy(s);
    return fractureArea(calc, p.rate_m3_s, p.porosity, p.invariant_Pa_s05);
  };

  const fluidRow = (label: string, key: "fvf" | "mu" | "ct" | "rho", dim: Dimension, field: keyof FluidProps, mixVal: number, rock?: boolean) => (
    <tr>
      <th scope="row">{label}</th>
      <td><UnitSelect dim={dim} value={u(key)} label={label} onChange={setU(key)} small /></td>
      <td><NumInput label={`${label} — нефть`} value={fromSI(calc.oil[field], dim, u(key))} onChange={(v) => set({ oil: { ...calc.oil, [field]: toSI(v, dim, u(key)) } })} /></td>
      <td><NumInput label={`${label} — вода`} value={fromSI(calc.water[field], dim, u(key))} onChange={(v) => set({ water: { ...calc.water, [field]: toSI(v, dim, u(key)) } })} /></td>
      <td>
        {rock ? (
          <NumInput label="Сжимаемость скелета" value={fromSI(calc.rockCompressibility_1_Pa, dim, u(key))} onChange={(v) => set({ rockCompressibility_1_Pa: toSI(v, dim, u(key)) })} />
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="mix mono">{fmt(fromSI(mixVal, dim, u(key)), 5)}</td>
    </tr>
  );

  const rows: { key: string; label: string; badge?: string; A: number; S: number; M: number; study?: Study }[] = [];
  if (calc.mode === "groups") {
    for (const g of groups) {
      const rs = g.studyIds.map((id) => studies.find((s) => s.id === id)).filter((s): s is Study => Boolean(s)).map(result);
      if (rs.length === 0) continue;
      const avg = (f: (r: (typeof rs)[number]) => number): number => rs.reduce((a, r) => a + f(r), 0) / rs.length;
      rows.push({ key: g.id, label: `${g.name} (среднее по ${rs.length})`, badge: "group", A: avg((r) => r.area_m2), S: avg((r) => r.sumHalfLength_m), M: avg((r) => r.meanLength_m) });
    }
  }

  const copy = (): void => {
    const head = ["Исследование", `A, ${u("A")}`, `Σx_f, ${u("L")}`, `x̄_f, ${u("L")}`].join("\t");
    const lines = included.map((s) => {
      const r = result(s);
      return [s.name, fromSI(r.area_m2, "area", u("A")), fromSI(r.sumHalfLength_m, "length", u("L")), fromSI(r.meanLength_m, "length", u("L"))]
        .map((v) => (typeof v === "number" ? String(v).replace(".", ",") : v))
        .join("\t");
    });
    void navigator.clipboard?.writeText([head, ...lines].join("\n"));
  };

  return (
    <div className="calc">
      <aside className="calc-tasks">
        <h2>Задачи</h2>
        <button type="button" className="task on">
          <b>Площадь трещин ГРП и полудлины</b>
          <span>по инварианте — наклону на графике √t</span>
        </button>
        <button type="button" className="task" disabled title="Добавим по мере появления методик">
          <b>+ Добавить задачу</b>
          <span>шаблон расчёта (позже)</span>
        </button>
        <div className="hint-box small">
          <b>Формулы</b>
          <div className="mono">
            B = Bн(1−W) + Bв·W
            <br />μ = μн·μв / (W·μн + (1−W)·μв)
            <br />cₜ = cск + (1−W)cн + W·cв
            <br />k = K_рад / n
            <br />A = 2qB / (√π·m) · √(μ / (cₜ·k·φ))
            <br />Σx_f = A / (4·h·n)
            <br />x̄_f = Σx_f / n
          </div>
          <p className="muted">Расчёт в СИ; при смене единиц значения пересчитываются автоматически.</p>
        </div>
      </aside>
      <section className="calc-main">
        <div className="row gap">
          <div className="grow">
            <h2>Расчёт площади поверхности трещин ГРП</h2>
            <p className="muted small">Инварианта m — наклон прямой Δp от √Δt (атм/ч^0.5). Её можно передать из панели прямой или выбрать здесь.</p>
          </div>
          <div role="group" aria-label="Рассчитать для" className="seg">
            {(["all", "selected", "groups"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={calc.mode === m} className={calc.mode === m ? "on" : ""} onClick={() => set({ mode: m })}>
                {m === "all" ? "Все исследования" : m === "selected" ? "Выбранные" : "По группам"}
              </button>
            ))}
          </div>
        </div>
        <div className="calc-params">
          <div className="col gap">
            <b>Пласт и скважина</b>
            <div className="two-col">
              <label className="lbl">Эфф. толщина h<QtyInput label="Эффективная толщина" dim="length" valueSI={calc.h_m} unit={u("h")} onUnit={setU("h")} onValue={(h_m) => set({ h_m })} /></label>
              <label className="lbl">Число трещин n<div className="qty"><NumInput label="Число трещин" value={calc.fractures} onChange={(v) => set({ fractures: Math.max(1, Math.round(v)) })} /><span className="unit-fixed">шт</span></div></label>
              <label className="lbl">Обводнённость W<QtyInput label="Обводнённость" dim="fraction" valueSI={calc.waterCut} unit={u("wc")} onUnit={setU("wc")} onValue={(waterCut) => set({ waterCut })} /></label>
              <label className="lbl">K_рад<QtyInput label="Проницаемость K_рад" dim="permeability" valueSI={calc.kRad_m2} unit={u("k")} onUnit={setU("k")} onValue={(kRad_m2) => set({ kRad_m2 })} /></label>
            </div>
          </div>
          <div className="col gap">
            <b>Флюиды и порода</b>
            <table className="fluids">
              <thead>
                <tr>
                  <th>Параметр</th>
                  <th>Ед.</th>
                  <th>нефть</th>
                  <th>вода</th>
                  <th>скелет</th>
                  <th>смесь</th>
                </tr>
              </thead>
              <tbody>
                {fluidRow("Объёмный коэф.", "fvf", "fvf", "fvf", mx.fvf)}
                {fluidRow("Вязкость", "mu", "viscosity", "viscosity_Pa_s", mx.viscosity_Pa_s)}
                {fluidRow("Сжимаемость", "ct", "compressibility", "compressibility_1_Pa", mx.compressibility_1_Pa, true)}
                {fluidRow("Плотность", "rho", "density", "density_kg_m3", mx.density_kg_m3)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row gap">
          <b className="grow">Исследования</b>
          {calc.mode === "groups" && <GroupEditor />}
          <button type="button" className="btn small" onClick={copy}>Копировать результаты</button>
        </div>
        <div className="calc-table-wrap">
          <table className="calc-table">
            <thead>
              <tr>
                <th className="left">Исследование</th>
                <th><div className="th-u">Дебит q<UnitSelect dim="rate" value={u("q")} label="Дебит" onChange={setU("q")} small /></div></th>
                <th><div className="th-u">Пористость φ<UnitSelect dim="fraction" value={u("phi")} label="Пористость" onChange={setU("phi")} small /></div></th>
                <th className="violet"><div className="th-u">Инварианта m<UnitSelect dim="invariant" value={u("m")} label="Инварианта" onChange={setU("m")} small /></div></th>
                <th className="res"><div className="th-u">Площадь A<UnitSelect dim="area" value={u("A")} label="Площадь" onChange={setU("A")} small /></div></th>
                <th className="res"><div className="th-u">Σ полудлин<UnitSelect dim="length" value={u("L")} label="Длина" onChange={setU("L")} small /></div></th>
                <th className="res"><div className="th-u">Средняя длина<span className="unit-fixed">{u("L") === "ft" ? "фут" : u("L") === "km" ? "км" : "м"}</span></div></th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => {
                const p = perStudy(s);
                const r = result(s);
                const off = calc.mode === "selected" && !isSel(s.id);
                const grp = groups.find((g) => g.studyIds.includes(s.id));
                return (
                  <tr key={s.id} className={off ? "off" : ""}>
                    <td className="left">
                      <label className="row gap">
                        <input
                          type="checkbox"
                          checked={calc.mode !== "selected" || isSel(s.id)}
                          disabled={calc.mode !== "selected"}
                          aria-label={`Включить ${s.name}`}
                          onChange={(e) => set({ selected: e.target.checked ? [...calc.selected, s.id] : calc.selected.filter((x) => x !== s.id) })}
                        />
                        <b>{s.name}</b>
                        {grp && <span className="badge blue">{grp.name}</span>}
                      </label>
                    </td>
                    <td><NumInput label={`Дебит ${s.name}`} value={fromSI(p.rate_m3_s, "rate", u("q"))} onChange={(v) => setPer(s, { rate_m3_s: toSI(v, "rate", u("q")) })} /></td>
                    <td><NumInput label={`Пористость ${s.name}`} value={fromSI(p.porosity, "fraction", u("phi"))} onChange={(v) => setPer(s, { porosity: toSI(v, "fraction", u("phi")) })} /></td>
                    <td>
                      <div className="row gap">
                        <NumInput label={`Инварианта ${s.name}`} className="violet" value={fromSI(p.invariant_Pa_s05, "invariant", u("m"))} onChange={(v) => setPer(s, { invariant_Pa_s05: toSI(v, "invariant", u("m")) })} />
                        <LinePicker study={s} onPick={(m) => setPer(s, { invariant_Pa_s05: m })} />
                      </div>
                    </td>
                    <td className="res mono">{off ? "" : fmt(fromSI(r.area_m2, "area", u("A")), 6)}</td>
                    <td className="res mono">{off ? "" : fmt(fromSI(r.sumHalfLength_m, "length", u("L")), 5)}</td>
                    <td className="res mono">{off ? "" : fmt(fromSI(r.meanLength_m, "length", u("L")), 5)}</td>
                  </tr>
                );
              })}
              {rows.map((r) => (
                <tr key={r.key} className="group-row">
                  <td className="left" colSpan={4}><span className="badge blue">Группа</span> {r.label}</td>
                  <td className="res mono">{fmt(fromSI(r.A, "area", u("A")), 6)}</td>
                  <td className="res mono">{fmt(fromSI(r.S, "length", u("L")), 5)}</td>
                  <td className="res mono">{fmt(fromSI(r.M, "length", u("L")), 5)}</td>
                </tr>
              ))}
              {studies.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">Загрузите исследования, чтобы рассчитать трещины.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Выбор инварианты из прямых на графиках исследования (наклон в атм/ч^0.5 на графике Δp от √Δt). */
function LinePicker({ study, onPick }: { study: Study; onPick(m_Pa_s05: number): void }) {
  const project = useApp((s) => s.project);
  const [open, setOpen] = useState(false);
  const options = project.charts
    .filter((c) => c.studyId === study.id && c.kind === "flex" && c.timeFn === "sqrt" && !c.xLog && !c.yLog && !c.normalizeByRate)
    .flatMap((c) => {
      const data = buildChartData(c, project);
      return c.lines
        .map((l) => ({ chart: c, line: l, slope: lineStats(l, c, data, new Set()).slope }))
        .filter((o): o is typeof o & { slope: number } => o.slope !== null);
    });
  return (
    <div className="picker">
      <button type="button" className="icon-btn violet" aria-label={`Взять наклон из прямой для ${study.name}`} title="Взять наклон из прямой на графике √t" onClick={() => setOpen(!open)}>
        ⟋
      </button>
      {open && (
        <div className="menu picker-menu" role="menu">
          {options.length === 0 && <div className="muted small pad">Нет прямых на графиках √t этого исследования (без нормировки, линейные оси).</div>}
          {options.map((o) => (
            <button
              key={o.line.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(toSI(Math.abs(o.slope), "invariant", "atm/h05"));
                setOpen(false);
              }}
            >
              <span>{o.chart.name} · {o.line.name}</span>
              <span className="mono">{fmt(Math.abs(o.slope), 5)} атм/ч^0.5</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Группы исследований: создание из выбранных и удаление. */
function GroupEditor() {
  const project = useApp((s) => s.project);
  const st = useApp.getState();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Группа 1");
  const [ids, setIds] = useState<string[]>([]);
  return (
    <div className="picker">
      <button type="button" className="btn small" onClick={() => setOpen(!open)}>Группы ({project.groups.length}) ▾</button>
      {open && (
        <div className="menu picker-menu right" role="dialog" aria-label="Группы">
          {project.groups.map((g) => (
            <div key={g.id} className="row gap small pad">
              <b>{g.name}</b>
              <span className="muted grow">{g.studyIds.map((id) => project.studies.find((s) => s.id === id)?.name).filter(Boolean).join(", ")}</span>
              <button type="button" className="icon-btn" aria-label={`Удалить группу ${g.name}`} onClick={() => st.removeGroup(g.id)}>✕</button>
            </div>
          ))}
          <hr />
          <div className="col gap pad">
            <input className="input" value={name} aria-label="Название группы" onChange={(e) => setName(e.target.value)} />
            {project.studies.map((s) => (
              <label key={s.id} className="row gap small">
                <input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => setIds(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} />
                {s.name}
              </label>
            ))}
            <button
              type="button"
              className="btn primary small"
              disabled={ids.length === 0}
              onClick={() => {
                st.addGroup(name.trim() || "Группа", ids);
                setIds([]);
                setName(`Группа ${project.groups.length + 2}`);
              }}
            >
              Объединить в группу
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
