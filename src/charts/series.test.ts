/**
 * Тесты построения серий: пустой график должен объяснять причину.
 */
import { describe, expect, it } from "vitest";
import { buildChartData } from "./series";
import { defaultCalc, newChart } from "../core/factory";
import type { Project, Study } from "../core/types";

const study = (pressure: string[], rateT: string[], rate: string[]): Study => ({
  id: "s",
  name: "s",
  columns: [
    { id: "t", name: "t", quantity: "time", unit: "h", cells: ["0", "1", "2", "3", "4"] },
    { id: "p", name: "p", quantity: "pressure", unit: "atm", cells: pressure },
  ],
  roles: { time: "t", pressure: "p" },
  rateColumns: [
    { id: "qt", name: "qt", quantity: "time", unit: "h", cells: rateT },
    { id: "q", name: "q", quantity: "rate", unit: "m3/d", cells: rate },
  ],
  rateRoles: rateT.length ? { time: "qt", rate: "q" } : {},
  testType: "buildup",
  tpSeconds: 0,
  rateBeforeM3s: 0,
});
const project = (s: Study): Project => ({ version: 1, studies: [s], charts: [], groups: [], calc: defaultCalc() });

describe("пустой график объясняет причину", () => {
  it("КВД с падающим давлением — Δp ≤ 0", () => {
    const s = study(["150", "149", "148", "147", "146"], [], []);
    const d = buildChartData(newChart("loglog", s.id), project(s));
    expect(d.warning).toMatch(/Δp ≤ 0/);
  });
  it("выделены точки до начала периода", () => {
    const s = study(["150", "149", "148", "150", "152"], ["-10", "2"], ["20", "0"]);
    const d = buildChartData(newChart("semilog", s.id, { rows: [0, 1] }), project(s));
    expect(d.warning).toMatch(/до начала периода/);
  });
  it("нормальные данные — точки есть, предупреждения нет", () => {
    const s = study(["150", "151", "152", "153", "154"], [], []);
    const d = buildChartData(newChart("loglog", s.id), project(s));
    expect(d.warning).toBeUndefined();
    expect(d.series[0]?.points.length).toBe(4);
  });
});
