/**
 * Тесты расчётного ядра: формулы, таблица, производная Бурде, тренды, калькулятор ГРП.
 */
import { describe, expect, it } from "vitest";
import { colIndex, colLetter, parse, shiftFormula } from "./formula";
import { computeSheet, parseDateTime, parsePasted } from "./sheet";
import { bourdetDerivative, superposedTime } from "./welltest";
import { fitTrend } from "./regression";
import { fractureArea } from "./fracture";
import type { CalcState, Column, Study } from "./types";

const col = (id: string, name: string, cells: string[], formula?: string): Column => ({
  id,
  name,
  quantity: "other",
  unit: "-",
  cells,
  formula,
});
const study = (columns: Column[]): Study => ({
  id: "s",
  name: "s",
  columns,
  roles: {},
  testType: "buildup",
  tpSeconds: 0,
  rateBeforeM3s: 0,
});

describe("формулы", () => {
  it("буквы столбцов", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(27)).toBe("AB");
    expect(colIndex("AB")).toBe(27);
  });
  it("разбор и сдвиг ссылок", () => {
    expect(() => parse("=SQRT([Время])+B2*$C$1")).not.toThrow();
    expect(shiftFormula("=(B3-B2)/$D$1", 1, 0)).toBe("=(B4-B3)/$D$1");
    expect(shiftFormula("=A1+[Δp]@-1", 2, 1)).toBe("=B3+[Δp]@-1");
  });
  it("вычисление ячеек, ƒx-столбца и цикла", () => {
    const s = computeSheet(
      study([
        col("a", "Время", ["1", "4", "9"]),
        col("b", "√t", ["", "", ""], "=SQRT([Время])"),
        col("c", "F", ["0", "=(A2-A1)/2", "=(A3-A2)/2"]),
        col("d", "Сумма", ["=SUM(A1:A3)", "=D2", "=IF(A3>5;1;0)"]),
      ]),
    );
    expect(Array.from(s.numeric("b"))).toEqual([1, 2, 3]);
    expect(Array.from(s.numeric("c"))).toEqual([0, 1.5, 2.5]);
    expect(s.value(3, 0)).toBe(14);
    expect(s.display(3, 1)).toBe("#ЦИКЛ");
    expect(s.value(3, 2)).toBe(1);
  });
  it("DIFF и десятичная запятая", () => {
    const s = computeSheet(study([col("a", "P", ["1,5", "2,5", "4"]), col("b", "d", ["", "", ""], "=DIFF([P])")]));
    expect(s.display(1, 0)).toBe("#Н/Д");
    expect(s.value(1, 2)).toBe(1.5);
  });
});

describe("загрузка данных", () => {
  it("даты", () => {
    expect(parseDateTime("12.03.2026 08:30")).toBe(Date.UTC(2026, 2, 12, 8, 30) / 1000);
    expect(parseDateTime("2026-03-12 08:30:15")).toBe(Date.UTC(2026, 2, 12, 8, 30) / 1000 + 15);
  });
  it("разбор вставки с табуляцией и заголовком", () => {
    const r = parsePasted("t\tp\n0\t100,5\n1\t101\n", "auto", true, 0);
    expect(r.headers).toEqual(["t", "p"]);
    expect(r.rows).toEqual([["0", "100,5"], ["1", "101"]]);
  });
});

describe("ГДИС", () => {
  it("производная Бурде для Δp = a·ln t равна a", () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.log(0.1 * 1.2 ** i));
    const y = x.map((v) => 3 * v + 1);
    const d = bourdetDerivative(x, y, 0.1);
    for (const v of d.slice(2, -2)) expect(v).toBeCloseTo(3, 9);
  });
  it("суперпозиция Агарвала", () => {
    const te = superposedTime("dt", "agarwal", 3600, 3600, []);
    expect(te).toBeCloseTo(0.5, 12);
  });
  it("тренд в лог-осях даёт показатель степени", () => {
    const pts = [1, 2, 4, 8, 16].map((x) => ({ x, y: 5 * Math.sqrt(x) }));
    const t = fitTrend(pts, "axis", { xLog: true, yLog: true });
    expect(t?.coeffs[0]).toBeCloseTo(0.5, 12);
    expect(t?.r2).toBeCloseTo(1, 12);
  });
});

describe("калькулятор ГРП (сверка с Excel пользователя)", () => {
  const ATM = 101_325;
  const s: CalcState = {
    h_m: 19,
    fractures: 6,
    waterCut: 0.14,
    kRad_m2: 0.35 * 9.869233e-16,
    oil: { fvf: 1.135, viscosity_Pa_s: 1.44e-3, compressibility_1_Pa: 0.000133 / ATM, density_kg_m3: 870.5 },
    water: { fvf: 1, viscosity_Pa_s: 0.38e-3, compressibility_1_Pa: 0.000044 / ATM, density_kg_m3: 1008 },
    rockCompressibility_1_Pa: 0.000054 / ATM,
    perStudy: {},
    units: {},
    mode: "all",
    selected: [],
  };
  const inv = (atmPerSqrtH: number): number => (atmPerSqrtH * ATM) / 60;
  it.each([
    ["КСД_1", 55, 0.0555, 2_425_231],
    ["КСД_2", 22.45, 0.0863, 636_632.7],
    ["КВД_1", 21.97, 0.5981, 89_895.9],
    ["КВД_2", 22, 0.4762, 113_062],
  ])("%s", (_n, q, m, excelArea) => {
    const r = fractureArea(s, q / 86_400, 0.13, inv(m));
    // Excel использует 1 мД = 1e-15 м² и 2,78e-4 ч/с — расхождение < 0,1 %.
    expect(Math.abs(r.area_m2 / excelArea - 1)).toBeLessThan(1e-3);
  });
});
