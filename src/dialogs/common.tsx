/**
 * Общие элементы диалогов: модальное окно, числовое поле (десятичная запятая), выбор единиц.
 */
import { useEffect, useState } from "react";
import { UNITS, type Dimension, fromSI, toSI } from "../core/units";
import { parseUserNumber } from "../core/formula";
import { fmt } from "../core/regression";

export function Modal(props: { title: string; sub?: string; onClose(): void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label={props.title} style={{ width: props.width ?? 720 }}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          {props.sub && <span className="muted small">{props.sub}</span>}
          <span className="grow" />
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/**
 * Числовое поле: принимает запятую, сообщает число при потере фокуса/Enter.
 * @param value текущее значение (NaN — пусто)
 * @param onChange новое значение
 */
export function NumInput(props: { value: number; onChange(v: number): void; label: string; className?: string; digits?: number }) {
  const show = (v: number): string => (Number.isFinite(v) ? fmt(v, props.digits ?? 6) : "");
  const [text, setText] = useState(show(props.value));
  useEffect(() => setText(show(props.value)), [props.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => {
    const n = parseUserNumber(text.replace(/[eE]/, "e"));
    if (n !== null && n !== props.value) props.onChange(n);
    else if (n === null) setText(show(props.value));
  };
  return (
    <input
      className={`input mono num ${props.className ?? ""}`}
      aria-label={props.label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

export function UnitSelect(props: { dim: Dimension; value: string; onChange(k: string): void; label: string; small?: boolean }) {
  const list = UNITS[props.dim];
  if (list.length <= 1) return <span className="unit-fixed">{list[0]?.label ?? ""}</span>;
  return (
    <select className={`input unit${props.small ? " small" : ""}`} aria-label={`Единицы: ${props.label}`} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {list.map((u) => (
        <option key={u.key} value={u.key}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Поле величины в СИ с выбором единиц отображения: при смене единиц значение пересчитывается.
 * @param valueSI значение в СИ
 * @param unit ключ единицы отображения
 */
export function QtyInput(props: { label: string; dim: Dimension; valueSI: number; unit: string; onValue(si: number): void; onUnit(u: string): void; digits?: number }) {
  const shown = fromSI(props.valueSI, props.dim, props.unit);
  return (
    <div className="qty">
      <NumInput label={props.label} value={shown} digits={props.digits} onChange={(v) => props.onValue(toSI(v, props.dim, props.unit))} />
      <UnitSelect dim={props.dim} value={props.unit} label={props.label} onChange={props.onUnit} />
    </div>
  );
}
