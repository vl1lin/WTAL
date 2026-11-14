/**
 * Сохранение проекта.
 *
 * Схема:
 *   saveProjectDebounced(p) ──► localStorage["wtal.project"]   (автосохранение)
 *   loadProject()           ◄── localStorage                   (при запуске)
 *   exportProjectFile(p)    ──► файл .wtal.json                 (кнопка «Сохранить в файл»)
 *   importProjectFile(text) ──► Project (проверка схемы zod)
 */
import { z } from "zod";
import type { Project } from "./core/types";
import { defaultCalc, emptyProject } from "./core/factory";

const KEY = "wtal.project";

const viewSchema = z.object({ xmin: z.number(), xmax: z.number(), ymin: z.number(), ymax: z.number() });
const axisPoint = z.object({ x: z.number(), y: z.number() });
const fluid = z.object({
  fvf: z.number(),
  viscosity_Pa_s: z.number(),
  compressibility_1_Pa: z.number(),
  density_kg_m3: z.number(),
});

const columnSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.enum(["time", "datetime", "pressure", "rate", "temperature", "dimensionless", "other"]),
  unit: z.string(),
  cells: z.array(z.string()),
  formula: z.string().optional(),
});

const projectSchema = z.object({
  version: z.literal(1),
  studies: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      columns: z.array(columnSchema),
      roles: z.object({ time: z.string().optional(), pressure: z.string().optional(), rate: z.string().optional() }),
      rateColumns: z.array(columnSchema).default([]),
      rateRoles: z.object({ time: z.string().optional(), rate: z.string().optional() }).default({}),
      testType: z.enum(["buildup", "drawdown"]),
      tpSeconds: z.number(),
      rateBeforeM3s: z.number(),
    }),
  ),
  charts: z.array(
    z.object({
      id: z.string(),
      studyId: z.string(),
      name: z.string(),
      kind: z.enum(["loglog", "semilog", "history", "rates", "combo", "flex", "columns"]),
      xLog: z.boolean(),
      yLog: z.boolean(),
      theme: z.enum(["dark", "light"]),
      showGrid: z.boolean(),
      timeFn: z.enum(["dt", "log", "sqrt", "qrt", "invsqrt"]),
      superposition: z.enum(["none", "buildup", "multirate", "agarwal"]),
      yFn: z.enum(["p", "dp"]),
      normalizeByRate: z.boolean(),
      derivL: z.number(),
      xColumn: z.string().optional(),
      yColumns: z
        .array(z.object({ columnId: z.string(), color: z.string(), marker: z.enum(["cross", "circle", "dot", "line", "step"]) }))
        .optional(),
      rows: z.array(z.number()).optional(),
      overlayStudyIds: z.array(z.string()).optional(),
      view: viewSchema.optional(),
      defaultView: viewSchema.optional(),
      view2: viewSchema.optional(),
      lines: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
          p1: axisPoint.optional(),
          p2: axisPoint.optional(),
          trend: z
            .object({
              fit: z.enum(["axis", "linear", "power", "log", "exp", "poly"]),
              degree: z.number(),
              fixedSlope: z.number().optional(),
              seriesKey: z.string(),
              rows: z.array(z.number()),
              coeffs: z.array(z.number()),
              r2: z.number(),
            })
            .optional(),
        }),
      ),
      visible: z.boolean(),
      minimized: z.boolean(),
      maximized: z.boolean(),
      rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    }),
  ),
  groups: z.array(z.object({ id: z.string(), name: z.string(), studyIds: z.array(z.string()) })),
  calc: z.object({
    h_m: z.number(),
    fractures: z.number(),
    waterCut: z.number(),
    kRad_m2: z.number(),
    oil: fluid,
    water: fluid,
    rockCompressibility_1_Pa: z.number(),
    perStudy: z.record(
      z.string(),
      z.object({ rate_m3_s: z.number(), porosity: z.number(), invariant_Pa_s05: z.number() }),
    ),
    units: z.record(z.string(), z.string()),
    mode: z.enum(["all", "selected", "groups"]),
    selected: z.array(z.string()),
  }),
});

/**
 * Проверить и привести данные к Project.
 * @param data разобранный JSON
 * @returns проект
 * @throws Error с описанием, если структура не подходит
 */
export function validateProject(data: unknown): Project {
  const r = projectSchema.safeParse(data);
  if (!r.success) throw new Error(`Файл проекта повреждён: ${r.error.issues[0]?.message ?? "неизвестная ошибка"}`);
  return r.data as Project;
}

/**
 * Загрузить проект из localStorage.
 * @returns сохранённый проект или пустой
 */
export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProject();
    const p = validateProject(JSON.parse(raw));
    return { ...p, calc: { ...defaultCalc(), ...p.calc } };
  } catch {
    return emptyProject();
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Сохранить проект в localStorage с задержкой 600 мс (не на каждое нажатие клавиши).
 * @param p проект
 */
export function saveProjectDebounced(p: Project): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      // Переполнение хранилища — проект остаётся в памяти, можно сохранить в файл.
    }
  }, 600);
}

/**
 * Скачать проект файлом.
 * @param p проект
 */
export function exportProjectFile(p: Project): void {
  const blob = new Blob([JSON.stringify(p)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `проект-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.wtal.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Прочитать проект из текста файла.
 * @param text содержимое файла
 * @returns проект
 */
export function importProjectFile(text: string): Project {
  const p = validateProject(JSON.parse(text));
  return { ...p, calc: { ...defaultCalc(), ...p.calc } };
}
