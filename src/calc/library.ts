/**
 * Библиотека шаблонов в браузере и обмен файлами .json.
 *
 * Схема:
 *   loadLibrary() / saveToLibrary(tpl) / removeFromLibrary(id) — localStorage "wtal.calcTemplates"
 *   exportTemplate(tpl)  → скачивание <имя>.wtal-calc.json
 *   importTemplateFile(file) → CalcTemplate (проверка zod, новые id)
 */
import { z } from "zod";
import { templateSchema } from "../persist";
import { uid } from "../core/factory";
import type { CalcTemplate } from "../core/types";

const KEY = "wtal.calcTemplates";

/** Шаблоны из библиотеки браузера (повреждённые записи пропускаются). */
export function loadLibrary(): CalcTemplate[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x) => {
      const r = templateSchema.safeParse(x);
      return r.success ? [r.data as CalcTemplate] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Записать библиотеку целиком.
 * @param list шаблоны
 */
function writeLibrary(list: CalcTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* хранилище недоступно — шаблон останется только в проекте */
  }
}

/**
 * Сохранить (или обновить по id) шаблон в библиотеке.
 * @param tpl шаблон
 */
export function saveToLibrary(tpl: CalcTemplate): void {
  const list = loadLibrary().filter((t) => t.id !== tpl.id);
  writeLibrary([...list, tpl]);
}

/**
 * Удалить шаблон из библиотеки.
 * @param id id шаблона
 */
export function removeFromLibrary(id: string): void {
  writeLibrary(loadLibrary().filter((t) => t.id !== id));
}

/**
 * Скачать шаблон файлом .json.
 * @param tpl шаблон
 */
export function exportTemplate(tpl: CalcTemplate): void {
  const blob = new Blob([JSON.stringify({ wtalCalcTemplate: 1, template: tpl }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${tpl.name.replace(/[\\/:*?"<>|]+/g, "_")}.wtal-calc.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Прочитать шаблон из файла. Получает новые id, чтобы не пересечься с уже загруженными.
 * @param text содержимое файла
 * @returns шаблон
 * @throws Error с понятным текстом, если файл не шаблон
 */
export function parseTemplateFile(text: string): CalcTemplate {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Файл не является JSON");
  }
  const wrapped = z.object({ template: z.unknown() }).safeParse(data);
  const r = templateSchema.safeParse(wrapped.success ? wrapped.data.template : data);
  if (!r.success) throw new Error("В файле нет шаблона расчёта WTAL");
  const t = r.data as CalcTemplate;
  return {
    ...t,
    id: uid(),
    params: t.params.map((p) => ({ ...p, id: uid() })),
    formulas: t.formulas.map((f) => ({ ...f, id: uid() })),
  };
}
