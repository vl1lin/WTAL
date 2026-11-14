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
  ];
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
        <button type="button" className="btn primary" onClick={() => st.setDialog({ kind: "import", part: useApp.getState().tablePart })}>
          <Icon name="upload" size={16} /> Загрузить данные
        </button>
      </div>
      <div role="tablist" aria-label="Исследования" className="study-tabs">
        {studies.map((s) => {
          const on = s.id === active && view !== "calc";
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
            </div>
          );
        })}
        <button type="button" className="tab-add" onClick={() => st.setDialog({ kind: "import" })}>
          + Новое
        </button>
      </div>
    </header>
  );
}
