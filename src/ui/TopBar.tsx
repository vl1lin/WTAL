/**
 * Верхняя панель: вид (таблица+графики / только графики / калькулятор), проект (демо, файл),
 * загрузка данных и вкладки исследований (как вкладки анализов в Saphir).
 */
import { useEffect, useRef, useState } from "react";
import { useApp, type ViewMode } from "../store";
import { Icon } from "./icons";
import { exportProjectFile, importProjectFile } from "../persist";
import { emptyProject } from "../core/factory";

function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const st = useApp.getState();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const item = (label: string, act: () => void) => (
    <button type="button" role="menuitem" onClick={() => { act(); setOpen(false); }}>
      <span>{label}</span>
    </button>
  );
  return (
    <div ref={ref} className="picker">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Проект ▾
      </button>
      {open && (
        <div className="menu picker-menu right" role="menu">
          {item("Сохранить в файл…", () => exportProjectFile(useApp.getState().project))}
          {item("Открыть файл проекта…", () => fileRef.current?.click())}
          {item("Добавить демо-исследования", () => st.loadDemo())}
          <hr />
          {item("Новый пустой проект", () => {
            if (confirm("Очистить текущий проект? Несохранённые в файл данные будут потеряны.")) st.replaceProject(emptyProject());
          })}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          f.text()
            .then((t) => st.replaceProject(importProjectFile(t)))
            .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function TopBar() {
  const view = useApp((s) => s.view);
  const studies = useApp((s) => s.project.studies);
  const active = useApp((s) => s.activeStudyId);
  const st = useApp.getState();
  const views: [ViewMode, string][] = [
    ["split", "Таблица + графики"],
    ["charts", "Только графики"],
    ["calc", "Калькулятор"],
    ["builder", "Построитель графиков"],
  ];
  const builder = view === "builder";
  // В построителе — только его наборы графиков, в остальных видах — главная страница и исследования.
  const tabs = studies.filter((s) => Boolean(s.isBuilder) === builder);
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="logo"><Icon name="logo" size={22} /></span>
          WTAL <span className="muted small">анализ ГДИС</span>
        </div>
        <div role="group" aria-label="Вид" className="seg">
          {views.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? "on" : ""} onClick={() => st.setView(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="grow" />
        <ProjectMenu />
        {builder ? (
          <button type="button" className="btn primary" disabled={!active || !tabs.some((s) => s.id === active)} onClick={() => st.setDialog({ kind: "builderImport" })}>
            <Icon name="upload" size={16} /> Загрузить график
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => st.setDialog({ kind: "import", part: useApp.getState().tablePart })}>
            <Icon name="upload" size={16} /> Загрузить данные
          </button>
        )}
      </div>
      <div role="tablist" aria-label={builder ? "Наборы графиков" : "Исследования"} className="study-tabs">
        {tabs.map((s) => {
          const on = s.id === active && view !== "calc";
          if (s.isMain)
            return (
              <div key={s.id} className={`study-tab main-tab${on ? " on" : ""}`}>
                <button type="button" role="tab" aria-selected={on} onClick={() => { st.setActiveStudy(s.id); if (view !== "split") st.setView("split"); }}>
                  <Icon name="home" size={14} />
                  Главная страница
                </button>
                <button type="button" className="tab-gear" aria-label="Настройки главной страницы" title="Столбцы и режим времени дебитов" onClick={() => st.setDialog({ kind: "study", studyId: s.id })}>
                  <Icon name="gear" size={13} />
                </button>
              </div>
            );
          if (s.isBuilder)
            return (
              <div key={s.id} className={`study-tab builder-tab${on ? " on" : ""}`}>
                <button type="button" role="tab" aria-selected={on} onClick={() => st.setActiveStudy(s.id)}>
                  <Icon name="columns" size={14} />
                  {s.name}
                </button>
                <button
                  type="button"
                  className="tab-gear"
                  aria-label={`Переименовать ${s.name}`}
                  title="Переименовать"
                  onClick={() => {
                    const n = prompt("Название набора графиков", s.name);
                    if (n?.trim()) st.updateStudy(s.id, { name: n.trim() });
                  }}
                >
                  <Icon name="gear" size={13} />
                </button>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Удалить ${s.name}`}
                  title="Удалить набор графиков"
                  onClick={() => {
                    if (confirm(`Удалить «${s.name}» вместе с графиками и данными?`)) st.removeStudy(s.id);
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            );
          return (
            <div key={s.id} className={`study-tab${on ? " on" : ""}`}>
              <button type="button" role="tab" aria-selected={on} onClick={() => { st.setActiveStudy(s.id); if (view === "calc") st.setView("split"); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={s.testType === "buildup" ? "#16A34A" : "#DC2626"} strokeWidth="2" aria-hidden="true">
                  <path d="M3 20c5-1 8-6 9-10s5-6 9-6" />
                </svg>
                {s.name}
              </button>
              <button type="button" className="tab-gear" aria-label={`Настройки ${s.name}`} title="Настройки исследования" onClick={() => st.setDialog({ kind: "study", studyId: s.id })}>
                <Icon name="gear" size={13} />
              </button>
              <button
                type="button"
                className="tab-close"
                aria-label={`Удалить ${s.name}`}
                title="Удалить исследование"
                onClick={() => {
                  if (confirm(`Удалить исследование «${s.name}» вместе с его графиками и прямыми?`)) st.removeStudy(s.id);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
        {builder ? (
          <button
            type="button"
            className="tab-add"
            title="Новый набор графиков"
            onClick={() => {
              const n = useApp.getState().project.studies.filter((s) => s.isBuilder).length;
              st.addBuilderStudy(`Построитель ${n + 1}`);
            }}
          >
            + Новый набор
          </button>
        ) : (
          <button type="button" className="tab-add" title="Создать исследование из выделенного на главной странице" onClick={() => st.setDialog({ kind: "createStudy" })}>
            + Новое
          </button>
        )}
      </div>
    </header>
  );
}
