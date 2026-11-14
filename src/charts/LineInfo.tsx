/**
 * Панель «Информация о прямой»: уравнение, наклон, угол, R², тип аппроксимации, передача наклона
 * в калькулятор как инварианты.
 *
 * Схема: store.selectedLine → график → buildChartData → lineStats() → отображение;
 *        изменения типа тренда → makeTrend() → store.updateLine().
 */
import { useMemo } from "react";
import { useApp } from "../store";
import { buildChartData } from "./series";
import { lineStats, makeTrend } from "./trend";
import { fmt, FIT_LABELS } from "../core/regression";
import type { FitType } from "../core/types";
import { toSI } from "../core/units";
import { representativeRate } from "../core/welltest";
import { Icon } from "../ui/icons";

export function LineInfo() {
  const sel = useApp((s) => s.selectedLine);
  const show = useApp((s) => s.showLineInfo);
  const project = useApp((s) => s.project);
  const selection = useApp((s) => (sel ? s.selection[project.charts.find((c) => c.id === sel.chartId)?.studyId ?? ""] : undefined));
  const st = useApp.getState();
  const chart = project.charts.find((c) => c.id === sel?.chartId);
  const line = chart?.lines.find((l) => l.id === sel?.lineId);
  const data = useMemo(() => (chart ? buildChartData(chart, project) : null), [chart, project]);
  if (!show || !chart || !line || !data) return null;
  const stats = lineStats(line, chart, data, new Set(selection ?? []));
  const study = project.studies.find((s) => s.id === chart.studyId);
  const sqrtChart = (chart.kind === "flex" && chart.timeFn === "sqrt") || (chart.kind === "columns");
  const canSendInvariant = sqrtChart && !chart.xLog && !chart.yLog && stats.slope !== null && !chart.normalizeByRate;

  const refit = (fit: FitType, degree: number, fixed?: number): void => {
    if (!line.trend) return;
    const r = makeTrend(chart, data, line.trend.seriesKey, line.trend.rows, fit, degree, fixed);
    if (typeof r === "string") alert(r);
    else st.updateLine(chart.id, line.id, r);
  };

  return (
    <aside className="line-info" aria-label="Информация о прямой">
      <div className="row gap">
        <input type="color" value={line.color} aria-label="Цвет прямой" onChange={(e) => st.updateLine(chart.id, line.id, { color: e.target.value })} />
        <input className="input grow" value={line.name} aria-label="Название прямой" onChange={(e) => st.updateLine(chart.id, line.id, { name: e.target.value })} />
        <button type="button" className="win-btn dark" aria-label="Закрыть панель" onClick={() => st.selectLine(sel, false)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="muted small">{chart.name}</div>
      <dl className="stats">
        <dt>Тип</dt>
        <dd>{line.trend ? `Тренд: ${FIT_LABELS[line.trend.fit]}` : "Прямая по двум точкам"}</dd>
        <dt>Уравнение</dt>
        <dd className="mono">{stats.equation}</dd>
        {stats.slope !== null && (
          <>
            <dt>Наклон{chart.xLog || chart.yLog ? " в осях" : ""}</dt>
            <dd className="mono">{fmt(stats.slope, 5)}{chart.xLog && chart.yLog ? " (показатель степени)" : ""}</dd>
          </>
        )}
        {stats.angleDeg !== null && (
          <>
            <dt>Угол на экране</dt>
            <dd className="mono">{fmt(stats.angleDeg, 3)}°</dd>
          </>
        )}
        <dt>Достоверность R²</dt>
        <dd className="mono">
          {stats.r2 === null ? "— (выделите точки)" : stats.r2 < 0 ? "< 0 — прямая не описывает выделенные точки" : fmt(stats.r2, 5)}
        </dd>
        {stats.points > 0 && (
          <>
            <dt>Точек</dt>
            <dd>{stats.points}</dd>
          </>
        )}
      </dl>
      {line.trend && (
        <div className="col gap">
          <label className="lbl">
            Тип аппроксимации
            <select className="input" value={line.trend.fit} onChange={(e) => refit(e.target.value as FitType, line.trend?.degree ?? 2)}>
              {(Object.keys(FIT_LABELS) as FitType[]).map((f) => (
                <option key={f} value={f}>{FIT_LABELS[f]}</option>
              ))}
            </select>
          </label>
          {line.trend.fit === "poly" && (
            <label className="lbl">
              Степень полинома
              <input className="input" type="number" min={1} max={6} value={line.trend.degree} onChange={(e) => refit("poly", Number(e.target.value))} />
            </label>
          )}
          {(line.trend.fit === "axis" || line.trend.fit === "linear" || line.trend.fit === "power") && (
            <label className="row gap small">
              <input
                type="checkbox"
                checked={line.trend.fixedSlope !== undefined}
                onChange={(e) => refit(line.trend?.fit ?? "axis", line.trend?.degree ?? 2, e.target.checked ? Number((stats.slope ?? 0.5).toFixed(3)) : undefined)}
              />
              Фиксировать наклон
              {line.trend.fixedSlope !== undefined && (
                <input
                  className="input narrow"
                  defaultValue={String(line.trend.fixedSlope).replace(".", ",")}
                  aria-label="Фиксированный наклон"
                  onBlur={(e) => refit(line.trend?.fit ?? "axis", line.trend?.degree ?? 2, Number(e.target.value.replace(",", ".")))}
                />
              )}
            </label>
          )}
        </div>
      )}
      <div className="hint-box small">
        <b>Изменить прямую</b> (инструмент «Изменить»): тянуть за узел — конец, за линию — целиком.
        <br />
        <kbd>Ctrl</kbd> — только по горизонтали, <kbd>Shift</kbd> — только по вертикали.
      </div>
      {canSendInvariant && study && (
        <button
          type="button"
          className="btn violet"
          onClick={() => {
            const calc = useApp.getState().project.calc;
            const prev = calc.perStudy[study.id] ?? { rate_m3_s: representativeRate(study), porosity: 0.13, invariant_Pa_s05: 0 };
            st.updateCalc({
              perStudy: { ...calc.perStudy, [study.id]: { ...prev, invariant_Pa_s05: toSI(Math.abs(stats.slope ?? 0), "invariant", "atm/h05") } },
            });
            alert(`Инварианта m = ${fmt(Math.abs(stats.slope ?? 0), 5)} атм/ч^0.5 передана в калькулятор для ${study.name}`);
          }}
        >
          → В калькулятор как инварианта ({study.name})
        </button>
      )}
      <button type="button" className="btn danger" onClick={() => st.removeLine(chart.id, line.id)}>
        Удалить прямую
      </button>
    </aside>
  );
}
