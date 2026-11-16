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

describe("удаление графика построителя", () => {
  it("удаляет график и его столбцы, общие столбцы остаются", async () => {
    const { useApp } = await import("../store");
    const st = useApp.getState();
    const sid = st.addBuilderStudy("b");
    const col = (id: string) => ({ id, name: id, quantity: "other" as const, unit: "-", cells: ["1", "2"] });
    const a = newChart("columns", sid, { xColumn: "x", yColumns: [{ columnId: "ya", color: "#000", marker: "dot" }] });
    const b = newChart("columns", sid, { xColumn: "x", yColumns: [{ columnId: "yb", color: "#000", marker: "dot" }] });
    st.builderAddData(sid, [col("x"), col("ya")], a);
    st.builderAddData(sid, [col("yb")], b);
    useApp.getState().removeChart(a.id);
    const s = useApp.getState().project.studies.find((x) => x.id === sid);
    expect(s?.columns.map((c) => c.id)).toEqual(["x", "yb"]);
    expect(useApp.getState().project.charts.some((c) => c.id === a.id)).toBe(false);
  });
});
