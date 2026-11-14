/**
 * Создание исследования из выделенного участка главной страницы.
 *
 * Схема:
 *   выделенные строки главной страницы ──studyFromSelection()──► новое исследование
 *   (давление — выделенные строки, дебиты — вся история) → store.addStudy(study, графики)
 *   Без выделения — подсказка и переход к загрузке данных в новое пустое исследование.
 */
import { useMemo, useState } from "react";
import { useApp } from "../store";
import { Modal } from "./common";
import type { ChartKind } from "../core/types";
import { studyFromSelection } from "../core/extract";
import { baseData, effectiveTestType, rateEvents } from "../core/welltest";
import { computeSheet } from "../core/sheet";
import { fmt } from "../core/regression";
import { fromSI } from "../core/units";

const KINDS: [ChartKind, string][] = [
  ["loglog", "Log-log (диагностический)"],
  ["flex", "√t — линейный поток"],
  ["combo", "Давление + дебит"],
  ["semilog", "Semilog"],
];

export function CreateStudyDialog() {
  const st = useApp.getState();
  const studies = useApp((s) => s.project.studies);
  const main = studies.find((s) => s.isMain);
  const rows = useApp((s) => (main ? s.selection[main.id] : undefined));
  const count = studies.filter((s) => !s.isMain).length;
  const [name, setName] = useState(`Исследование ${count + 1}`);
  const [kinds, setKinds] = useState<Record<string, boolean>>({ loglog: true, flex: true, combo: true, semilog: false });

  // Предварительный расчёт: какой период получится.
  const info = useMemo(() => {
    if (!main || !rows || rows.length < 2) return null;
    const s = studyFromSelection(main, rows, name);
    const b = baseData(s, computeSheet(s));
    if (b.rows.length === 0) return { s, text: "В выделенных строках нет времени и давления — проверьте столбцы главной страницы (⚙)." };
    const span = (b.hist_s[b.hist_s.length - 1] ?? 0) / 3600;
    let text = `Строк: ${b.rows.length}, длительность ${fmt(span, 4)} ч. `;
    if (b.rates && b.rates.length > 0) {
      const ev = rateEvents(s, b);
      const n = ev.length;
      const q = (i: number): string => fmt(fromSI(ev[i]?.q_m3_s ?? Number.NaN, "rate", "m3/d"), 4);
      text += `Тип: ${effectiveTestType(s, b) === "buildup" ? "КВД" : "КСД"}, Δt — от смены дебита ${n > 1 ? q(n - 2) : "0"} → ${q(n - 1)} м³/сут`;
      text += b.tStart_s > 0 ? ` (через ${fmt(b.tStart_s / 3600, 4)} ч после первой выделенной точки).` : ".";
    } else {
      text += "Таблица дебитов главной страницы пуста — Δt от первой выделенной точки, тип задайте в настройках исследования.";
    }
    return { s, text };
  }, [main, rows, name]);

  const create = (): void => {
    if (!info) return;
    st.addStudy({ ...info.s, name: name.trim() || info.s.name }, (Object.keys(kinds) as ChartKind[]).filter((k) => kinds[k]));
    st.setTablePart("p");
    st.setDialog(null);
  };

  return (
    <Modal
      title="Создать исследование"
      sub="из выделенного участка главной страницы"
      width={640}
      onClose={() => st.setDialog(null)}
      footer={
        <>
          {!info && (
            <button type="button" className="btn" onClick={() => st.setDialog({ kind: "import", part: "p" })}>
              Загрузить данные в новое исследование…
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={() => st.setDialog(null)}>Отмена</button>
          <button type="button" className="btn primary" disabled={!info || info.s.columns.length === 0} onClick={create}>
            Создать
          </button>
        </>
      }
    >
      {!info ? (
        <div className="col gap">
          <div className="banner warn">
            Выделите участок на главной странице — прямоугольником или лассо на графике давления либо строки в таблице, — затем нажмите
            «Создать исследование» в группе «Данные».
          </div>
          {main && (
            <button type="button" className="btn" onClick={() => { st.setActiveStudy(main.id); st.setDialog(null); }}>
              Перейти на главную страницу
            </button>
          )}
        </div>
      ) : (
        <div className="col gap">
          <label className="lbl">
            Название
            <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </label>
          <div className="banner blue small">{info.text}</div>
          <div className="row gap wrap small">
            <b>Создать графики:</b>
            {KINDS.map(([k, l]) => (
              <label key={k}>
                <input type="checkbox" checked={kinds[k] ?? false} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} /> {l}
              </label>
            ))}
          </div>
          <div className="hint-box small">
            В исследование копируются выделенные строки давления (формулы — значениями) и вся история дебитов: она нужна для суперпозиции.
            Главная страница не меняется.
          </div>
        </div>
      )}
    </Modal>
  );
}
