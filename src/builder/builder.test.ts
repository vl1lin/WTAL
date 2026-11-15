/**
 * Тесты построителя: столбцы таблицы графика.
 */
import { describe, expect, it } from "vitest";
import { chartColumnIds } from "./BuilderView";
import { newChart } from "../core/factory";

describe("chartColumnIds", () => {
  it("X серии перед её Y, без повторов", () => {
    const c = newChart("columns", "b", {
      xColumn: "x1",
      yColumns: [
        { columnId: "y1", color: "#000", marker: "dot" },
        { columnId: "y2", color: "#000", marker: "dot", xColumnId: "x1" },
        { columnId: "y3", color: "#000", marker: "dot", xColumnId: "x2" },
      ],
    });
    expect(chartColumnIds(c)).toEqual(["x1", "y1", "y2", "x2", "y3"]);
  });
});
