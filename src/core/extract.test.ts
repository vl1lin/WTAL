/**
 * Тесты создания исследования из участка главной страницы.
 */
import { describe, expect, it } from "vitest";
import { demoHistory, studyFromSelection } from "./extract";
import { autoRoles, newMain } from "./factory";
import { baseData, deltaP, effectiveTestType, representativeRate } from "./welltest";
import { computeSheet } from "./sheet";

describe("исследование из выделенного участка", () => {
  const h = demoHistory();
  const main = autoRoles({ ...newMain().study, columns: h.pressure, rateColumns: h.rates });
  const b = baseData(main, computeSheet(main));
  const rows = (h0: number, h1: number): number[] =>
    b.rows.filter((_, i) => (b.hist_s[i] ?? 0) >= h0 * 3600 && (b.hist_s[i] ?? 0) < h1 * 3600);

  it("остановка 200–260 ч → КВД, Δt от момента остановки, Δp > 0", () => {
    const s = studyFromSelection(main, rows(200, 260), "КВД");
    const sb = baseData(s, computeSheet(s));
    expect(s.testType).toBe("buildup");
    expect(effectiveTestType(s, sb)).toBe("buildup");
    expect(sb.tStart_s).toBe(0);
    expect(deltaP(s, sb).slice(1).every((v) => v > 0)).toBe(true);
    expect(s.columns.map((c) => c.cells.length)).toEqual([rows(200, 260).length, rows(200, 260).length]);
  });
  it("пуск 260–420 ч → КСД", () => {
    const s = studyFromSelection(main, rows(260, 420), "КСД");
    expect(s.testType).toBe("drawdown");
  });
  it("дебит для калькулятора — по периоду: КВД — до остановки, КСД — после пуска", () => {
    const toM3d = (q: number): number => Math.round(q * 86_400);
    expect(toM3d(representativeRate(studyFromSelection(main, rows(200, 260), "a")))).toBe(60);
    expect(toM3d(representativeRate(studyFromSelection(main, rows(260, 420), "b")))).toBe(40);
    expect(toM3d(representativeRate(studyFromSelection(main, rows(420, 470), "c")))).toBe(40);
  });
  it("главная страница не меняется", () => {
    const before = JSON.stringify(main);
    studyFromSelection(main, rows(200, 260), "x");
    expect(JSON.stringify(main)).toBe(before);
  });
});
