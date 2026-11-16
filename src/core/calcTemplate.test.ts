/**
 * Тесты шаблонов расчётов: разбор формул, единицы параметров, совпадение с встроенным расчётом ГРП.
 */
import { describe, expect, it } from "vitest";
import { checkTemplate, evalTemplate, prepareFormula, aggregate } from "./calcTemplate";
import { formula, fractureTemplate, hornerTemplate, param } from "./templates";
import { fractureArea, mixture } from "./fracture";
import { defaultCalc } from "./factory";
import { toSI } from "./units";
import type { CalcTemplate } from "./types";

describe("prepareFormula", () => {
  it("обозначения → [sym], запятая → точка, функции и экспонента не трогаются", () => {
    const r = prepareFormula("= 1,151 * LG(k / φ) + 1e-5 * ct · 2", new Set(["k", "φ", "ct"]));
    expect(r.text).toBe(" 1.151 * LG([k] / [φ]) + 1e-5 * [ct] * 2");
    expect(r.unknown).toEqual([]);
  });
  it("неизвестное обозначение", () => {
    expect(prepareFormula("a + b", new Set(["a"])).unknown).toEqual(["b"]);
  });
});

describe("checkTemplate", () => {
  it("ссылка на формулу ниже — ошибка, дубль обозначения — ошибка", () => {
    const t: CalcTemplate = {
      id: "t",
      name: "t",
      description: "",
      params: [param("a", "a", "none", "-", true, 1), param("a", "a2", "none", "-", true, 1)],
      formulas: [formula("x", "x", "= y + a", "none", "-"), formula("y", "y", "= 2", "none", "-")],
    };
    const issues = checkTemplate(t).map((i) => i.text);
    expect(issues.some((s) => s.includes("дважды"))).toBe(true);
    expect(issues.some((s) => s.includes("ниже"))).toBe(true);
  });
  it("готовые шаблоны без ошибок", () => {
    expect(checkTemplate(fractureTemplate())).toEqual([]);
    expect(checkTemplate(hornerTemplate())).toEqual([]);
  });
});

describe("evalTemplate", () => {
  it("значение подставляется в единице параметра, результат переводится в СИ", () => {
    // p задан в атм, формула r = p * 2 даёт атм → в СИ Па.
    const t: CalcTemplate = {
      id: "t",
      name: "t",
      description: "",
      params: [param("p", "p", "pressure", "atm", true)],
      formulas: [formula("r", "r", "= p * 2", "pressure", "atm")],
    };
    const res = evalTemplate(t, { p: toSI(10, "pressure", "atm") });
    expect(res.values.r).toBeCloseTo(toSI(20, "pressure", "atm"), 6);
  });
  it("нет значения параметра — понятная ошибка", () => {
    const t = hornerTemplate();
    const res = evalTemplate(t, {});
    expect(res.errors.k).toContain("нет значения");
  });
  it("копия встроенного шаблона ГРП = встроенный расчёт", () => {
    const calc = defaultCalc();
    const mx = mixture(calc);
    const q = 22 / 86400;
    const phi = 0.13;
    const m = toSI(0.5, "invariant", "atm/h05");
    const ref = fractureArea(calc, q, phi, m);
    const t = fractureTemplate();
    const res = evalTemplate(t, { q, φ: phi, m, B: mx.fvf, μ: mx.viscosity_Pa_s, ct: mx.compressibility_1_Pa, K: calc.kRad_m2, n: calc.fractures, h: calc.h_m });
    expect(res.values.A).toBeCloseTo(ref.area_m2, 3);
    expect(res.values.xf).toBeCloseTo(ref.meanLength_m, 6);
  });
  it("итоги по группе", () => {
    expect(aggregate([1, 2, Number.NaN, 3], "mean")).toBe(2);
    expect(aggregate([1, 2, 3], "sum")).toBe(6);
  });
});

describe("lineValue", () => {
  it("наклон на semilog — на цикл, Y при X для лог. оси X", async () => {
    const { lineValue } = await import("../calc/tplInputs");
    const { newChart } = await import("./factory");
    const chart = { ...newChart("semilog", "s"), xLog: true, yLog: false };
    // Прямая в координатах осей: x = lg(Δt), y = p. Через (lg 1 = 0, 50) и (lg 100 = 2, 60) → 5 атм/цикл.
    const line = { id: "l", name: "l", color: "#000", p1: { x: 0, y: 50 }, p2: { x: 2, y: 60 } };
    expect(lineValue(line, chart, { kind: "line", axes: "semilog", what: "slope", at: 1, abs: true })).toBeCloseTo(5);
    expect(lineValue(line, chart, { kind: "line", axes: "semilog", what: "yAtX", at: 10, abs: false })).toBeCloseTo(55);
    expect(lineValue(line, chart, { kind: "line", axes: "semilog", what: "xAtY", at: 60, abs: false })).toBeCloseTo(100);
  });
});
