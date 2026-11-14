/**
 * Canvas-график с инструментами.
 *
 * Схема:
 *   ChartView(props)
 *   ├─ draw()          — фон, сетка, деления, серии, выделение, прямые, временные фигуры (рамка, лассо)
 *   ├─ pointer-события — в зависимости от инструмента (tool):
 *   │    pan / колесо        → сдвиг и масштаб (onView)
 *   │    zoom                → рамка приближения (onView)
 *   │    rect / lasso / click→ выделение строк (onSelectRows)
 *   │    line2               → прямая по 2 кликам (onAddLine)
 *   │    pickline / info     → выбор прямой (onSelectLine)
 *   │    editline            → перетаскивание узла или прямой; Ctrl — только по горизонтали, Shift — по вертикали
 *   └─ ПКМ              → onContextMenu
 *
 * Координаты прямых хранятся в координатах осей, поэтому прямая на лог-осях остаётся прямой.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AxisPoint, ChartDef, LineDef, View } from "../core/types";
import type { Tool } from "../store";
import type { ChartData, Series } from "./series";
import { autoView, clipLine, distToSegment, Frame, fromAxis, lastFrames, MARGIN, pointInPolygon, ticks, toAxis, fmtTick } from "./geometry";
import { evalTrend, type TrendFit } from "../core/regression";
import { uid } from "../core/factory";

export interface ChartViewProps {
  chart: ChartDef;
  data: ChartData;
  selected: Set<number>;
  tool: Tool;
  multi: boolean;
  selectedLineId: string | null;
  onView(view: View): void;
  onSelectRows(rows: number[], additive: boolean): void;
  onAddLine(line: LineDef): void;
  onUpdateLine(id: string, patch: Partial<LineDef>): void;
  onSelectLine(id: string | null, info: boolean): void;
  onContextMenu(clientX: number, clientY: number): void;
  onActivate(): void;
  /** Вертикальные пунктирные линии (значения X в данных) — моменты смены режима. */
  vLines?: number[];
  /** Не подписывать ось X (верхний график в паре с общей осью времени). */
  compactX?: boolean;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "rect"; sx: number; sy: number; ex: number; ey: number; zoom: boolean }
  | { kind: "lasso"; pts: number[] }
  | { kind: "node"; lineId: string; which: 1 | 2; start: AxisPoint; orig: AxisPoint; other: AxisPoint }
  | { kind: "body"; lineId: string; start: AxisPoint; p1: AxisPoint; p2: AxisPoint };

const THEMES = {
  dark: { bg: "#0B1016", grid: "#243041", minor: "#151D28", axis: "#64748B", text: "#CBD5E1", sel: "#FACC15" },
  light: { bg: "#FFFFFF", grid: "#E2E8F0", minor: "#F1F5F9", axis: "#64748B", text: "#334155", sel: "#CA8A04" },
};

/** Тренд из описания прямой (для отрисовки и проверки попадания). */
export function lineTrend(l: LineDef, chart: ChartDef): TrendFit | null {
  if (!l.trend || l.trend.fit === "axis") return null;
  return { fit: l.trend.fit, coeffs: l.trend.coeffs, r2: l.trend.r2, xLog: chart.xLog, yLog: chart.yLog };
}

/**
 * Полилиния кривой тренда в координатах осей.
 * @param t тренд
 * @param chart график (лог-оси)
 * @param view видимая область
 * @returns точки в координатах осей
 */
function trendPolyline(t: TrendFit, chart: ChartDef, view: View): AxisPoint[] {
  const out: AxisPoint[] = [];
  const n = 200;
  for (let i = 0; i <= n; i++) {
    const X = view.xmin + ((view.xmax - view.xmin) * i) / n;
    const y = evalTrend(t, fromAxis(X, chart.xLog));
    const Y = toAxis(y, chart.yLog);
    out.push({ x: X, y: Number.isFinite(Y) ? Y : Number.NaN });
  }
  return out;
}

export function ChartView(props: ChartViewProps) {
  const { chart, data, selected, tool, multi, selectedLineId } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 300, h: 200 });
  const drag = useRef<Drag | null>(null);
  const pending = useRef<AxisPoint | null>(null);
  const hover = useRef<{ sx: number; sy: number } | null>(null);
  const [, force] = useState(0);
  const redraw = useCallback(() => force((k) => k + 1), []);

  const view = useMemo<View>(
    () => chart.view ?? chart.defaultView ?? autoView(data.series, chart.xLog, chart.yLog),
    [chart.view, chart.defaultView, data.series, chart.xLog, chart.yLog],
  );
  const frame = useMemo(() => new Frame(size.w, size.h, view), [size, view]);
  const theme = THEMES[chart.theme];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(50, Math.floor(r.width)), h: Math.max(50, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Экранные точки серий (для выделения и попадания).
  const screen = useMemo(() => {
    return data.series.map((s) =>
      s.points.map((p) => ({ sx: frame.px(toAxis(p.x, chart.xLog)), sy: frame.py(toAxis(p.y, chart.yLog)), row: p.row })),
    );
  }, [data.series, frame, chart.xLog, chart.yLog]);

  /** Отрезки прямой в пикселях (для отрисовки и попадания). */
  const lineSegments = useCallback(
    (l: LineDef): [number, number, number, number][] => {
      const t = lineTrend(l, chart);
      if (t) {
        const pts = trendPolyline(t, chart, view);
        const segs: [number, number, number, number][] = [];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          if (!a || !b || !Number.isFinite(a.y) || !Number.isFinite(b.y)) continue;
          segs.push([frame.px(a.x), frame.py(a.y), frame.px(b.x), frame.py(b.y)]);
        }
        return segs;
      }
      if (!l.p1 || !l.p2) return [];
      const c = clipLine(l.p1, l.p2, view);
      if (!c) return [];
      return [[frame.px(c[0].x), frame.py(c[0].y), frame.px(c[1].x), frame.py(c[1].y)]];
    },
    [chart, view, frame],
  );

  // ---------- отрисовка ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    lastFrames.set(chart.id, frame);
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, size.w, size.h);
    g.font = "11px Inter, system-ui, sans-serif";

    const xt = ticks(view.xmin, view.xmax, chart.xLog, frame.pw);
    const yt = ticks(view.ymin, view.ymax, chart.yLog, frame.ph);
    const L = MARGIN.l;
    const T = MARGIN.t;
    const R = L + frame.pw;
    const B = T + frame.ph;
    if (chart.showGrid) {
      for (const t of xt) {
        g.strokeStyle = t.major ? theme.grid : theme.minor;
        g.beginPath();
        g.moveTo(Math.round(frame.px(t.v)) + 0.5, T);
        g.lineTo(Math.round(frame.px(t.v)) + 0.5, B);
        g.stroke();
      }
      for (const t of yt) {
        g.strokeStyle = t.major ? theme.grid : theme.minor;
        g.beginPath();
        g.moveTo(L, Math.round(frame.py(t.v)) + 0.5);
        g.lineTo(R, Math.round(frame.py(t.v)) + 0.5);
        g.stroke();
      }
    }
    g.fillStyle = theme.text;
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const t of xt) if (t.label) g.fillText(t.label, frame.px(t.v), B + 5);
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const t of yt) if (t.label) g.fillText(t.label, L - 6, frame.py(t.v));
    g.strokeStyle = theme.axis;
    g.strokeRect(L + 0.5, T + 0.5, frame.pw, frame.ph);
    g.font = "12px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    if (!props.compactX) g.fillText(data.xLabel, L + frame.pw / 2, size.h - 4);
    g.save();
    g.translate(13, T + frame.ph / 2);
    g.rotate(-Math.PI / 2);
    g.textBaseline = "middle";
    g.fillText(data.yLabel, 0, 0);
    g.restore();

    g.save();
    g.beginPath();
    g.rect(L, T, frame.pw, frame.ph);
    g.clip();

    // серии
    data.series.forEach((s: Series, si) => {
      const pts = screen[si] ?? [];
      g.strokeStyle = s.color;
      g.fillStyle = s.color;
      g.lineWidth = 1.3;
      if (s.marker === "line") {
        g.beginPath();
        pts.forEach((p, i) => (i === 0 ? g.moveTo(p.sx, p.sy) : g.lineTo(p.sx, p.sy)));
        g.stroke();
      }
      if (s.marker === "step") {
        // Ступенька: режим держится до начала следующего.
        g.lineWidth = 2;
        g.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) g.moveTo(p.sx, p.sy);
          else {
            const prev = pts[i - 1];
            if (prev) g.lineTo(p.sx, prev.sy);
            g.lineTo(p.sx, p.sy);
          }
        });
        g.stroke();
        g.lineWidth = 1.3;
        return;
      }
      for (const p of pts) {
        if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy)) continue;
        const isSel = selected.has(p.row) && s.studyId === chart.studyId;
        if (isSel) {
          g.strokeStyle = theme.sel;
          g.fillStyle = theme.sel;
        }
        switch (s.marker) {
          case "cross":
            g.beginPath();
            g.moveTo(p.sx - 3.2, p.sy);
            g.lineTo(p.sx + 3.2, p.sy);
            g.moveTo(p.sx, p.sy - 3.2);
            g.lineTo(p.sx, p.sy + 3.2);
            g.stroke();
            break;
          case "circle":
            g.beginPath();
            g.arc(p.sx, p.sy, 2.8, 0, Math.PI * 2);
            g.stroke();
            break;
          case "dot":
          case "line":
            g.beginPath();
            g.arc(p.sx, p.sy, 2.2, 0, Math.PI * 2);
            g.fill();
            break;
        }
        if (isSel) {
          g.globalAlpha = 0.45;
          g.beginPath();
          g.arc(p.sx, p.sy, 5.5, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
          g.strokeStyle = s.color;
          g.fillStyle = s.color;
        }
      }
    });

    // моменты смены режима
    if (props.vLines && props.vLines.length > 0) {
      g.strokeStyle = chart.theme === "dark" ? "rgba(250,204,21,0.75)" : "rgba(202,138,4,0.8)";
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      for (const x of props.vLines) {
        const sx = Math.round(frame.px(toAxis(x, chart.xLog))) + 0.5;
        if (!Number.isFinite(sx)) continue;
        g.moveTo(sx, T);
        g.lineTo(sx, B);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // прямые
    for (const l of chart.lines) {
      const isSel = l.id === selectedLineId;
      g.strokeStyle = l.color;
      g.lineWidth = isSel ? 2.6 : 1.7;
      g.beginPath();
      for (const [ax, ay, bx, by] of lineSegments(l)) {
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
      }
      g.stroke();
      if (l.p1 && l.p2 && !lineTrend(l, chart)) {
        const nodes = [l.p1, l.p2];
        for (const n of nodes) {
          const sx = frame.px(n.x);
          const sy = frame.py(n.y);
          g.fillStyle = theme.bg;
          g.lineWidth = 2;
          g.fillRect(sx - 4.5, sy - 4.5, 9, 9);
          g.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
        }
        const lx = frame.px(l.p2.x) + 8;
        const ly = frame.py(l.p2.y) - 8;
        g.font = "11px Inter, system-ui, sans-serif";
        g.textAlign = "left";
        g.textBaseline = "bottom";
        g.fillStyle = l.color;
        g.fillText(l.name, lx, ly);
      }
    }
    g.restore();

    // временные фигуры
    const d = drag.current;
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    if (d?.kind === "rect") {
      g.strokeStyle = d.zoom ? "#60A5FA" : "#A78BFA";
      g.fillStyle = d.zoom ? "rgba(96,165,250,0.12)" : "rgba(167,139,250,0.12)";
      const x = Math.min(d.sx, d.ex);
      const y = Math.min(d.sy, d.ey);
      g.fillRect(x, y, Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy));
      g.strokeRect(x, y, Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy));
    }
    if (d?.kind === "lasso" && d.pts.length > 2) {
      g.strokeStyle = "#A78BFA";
      g.fillStyle = "rgba(167,139,250,0.12)";
      g.beginPath();
      for (let i = 0; i < d.pts.length; i += 2) {
        const x = d.pts[i] ?? 0;
        const y = d.pts[i + 1] ?? 0;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
    const h = hover.current;
    if (pending.current && h) {
      g.strokeStyle = "#34D399";
      g.beginPath();
      g.moveTo(frame.px(pending.current.x), frame.py(pending.current.y));
      g.lineTo(h.sx, h.sy);
      g.stroke();
    }
    g.setLineDash([]);

    // координаты курсора
    if (h && frame.inside(h.sx, h.sy)) {
      const a = frame.toAxisPoint(h.sx, h.sy);
      const txt = `x = ${fmtTick(fromAxis(a.x, chart.xLog))}   y = ${fmtTick(fromAxis(a.y, chart.yLog))}`;
      g.font = "11px JetBrains Mono, ui-monospace, monospace";
      const w = g.measureText(txt).width + 12;
      g.fillStyle = chart.theme === "dark" ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";
      g.fillRect(R - w - 4, T + 4, w, 18);
      g.fillStyle = theme.text;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(txt, R - w + 2, T + 13);
    }
    if (data.warning) {
      g.fillStyle = theme.text;
      g.font = "13px Inter, system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText(data.warning, L + frame.pw / 2, T + frame.ph / 2);
    }
  });

  // ---------- события ----------
  const local = (e: { clientX: number; clientY: number }): { sx: number; sy: number } => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { sx: e.clientX - (r?.left ?? 0), sy: e.clientY - (r?.top ?? 0) };
  };

  /** Ближайшая прямая к точке (в пикселях), не дальше 7 px. */
  const hitLine = (sx: number, sy: number): LineDef | null => {
    let best: LineDef | null = null;
    let bd = 7;
    for (const l of chart.lines) {
      for (const [ax, ay, bx, by] of lineSegments(l)) {
        const d = distToSegment(sx, sy, ax, ay, bx, by);
        if (d < bd) {
          bd = d;
          best = l;
        }
      }
    }
    return best;
  };

  /** Узел прямой под курсором. */
  const hitNode = (sx: number, sy: number): { line: LineDef; which: 1 | 2 } | null => {
    for (const l of chart.lines) {
      if (!l.p1 || !l.p2 || lineTrend(l, chart)) continue;
      if (Math.hypot(frame.px(l.p1.x) - sx, frame.py(l.p1.y) - sy) < 8) return { line: l, which: 1 };
      if (Math.hypot(frame.px(l.p2.x) - sx, frame.py(l.p2.y) - sy) < 8) return { line: l, which: 2 };
    }
    return null;
  };

  /** Строки точек основного исследования, удовлетворяющих условию. */
  const rowsWhere = (f: (sx: number, sy: number) => boolean): number[] => {
    const out: number[] = [];
    data.series.forEach((s, si) => {
      if (s.studyId !== chart.studyId) return;
      for (const p of screen[si] ?? []) if (f(p.sx, p.sy)) out.push(p.row);
    });
    return out;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    props.onActivate();
    if (e.button === 2) return;
    const { sx, sy } = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || tool === "pan") {
      drag.current = { kind: "pan", sx, sy, view };
      return;
    }
    const a = frame.toAxisPoint(sx, sy);
    switch (tool) {
      case "zoom":
      case "rect":
        drag.current = { kind: "rect", sx, sy, ex: sx, ey: sy, zoom: tool === "zoom" };
        break;
      case "lasso":
        drag.current = { kind: "lasso", pts: [sx, sy] };
        break;
      case "click": {
        let best: { row: number; d: number } | null = null;
        data.series.forEach((s, si) => {
          if (s.studyId !== chart.studyId) return;
          for (const p of screen[si] ?? []) {
            const d = Math.hypot(p.sx - sx, p.sy - sy);
            if (d < 8 && (!best || d < best.d)) best = { row: p.row, d };
          }
        });
        const additive = multi || e.shiftKey;
        const b = best as { row: number; d: number } | null;
        if (b) {
          if (additive && selected.has(b.row)) {
            props.onSelectRows([...selected].filter((r) => r !== b.row), false);
          } else props.onSelectRows([b.row], additive);
        } else if (!additive) props.onSelectRows([], false);
        break;
      }
      case "line2":
        if (!pending.current) pending.current = a;
        else {
          const p1 = pending.current;
          pending.current = null;
          props.onAddLine({ id: uid(), name: `Прямая ${chart.lines.length + 1}`, color: "#34D399", p1, p2: a });
        }
        redraw();
        break;
      case "pickline":
      case "info": {
        const l = hitLine(sx, sy);
        props.onSelectLine(l?.id ?? null, tool === "info" && l !== null);
        break;
      }
      case "editline": {
        const n = hitNode(sx, sy);
        if (n && n.line.p1 && n.line.p2) {
          props.onSelectLine(n.line.id, false);
          const orig = n.which === 1 ? n.line.p1 : n.line.p2;
          const other = n.which === 1 ? n.line.p2 : n.line.p1;
          drag.current = { kind: "node", lineId: n.line.id, which: n.which, start: a, orig, other };
          break;
        }
        const l = hitLine(sx, sy);
        if (l && l.p1 && l.p2 && !lineTrend(l, chart)) {
          props.onSelectLine(l.id, false);
          drag.current = { kind: "body", lineId: l.id, start: a, p1: l.p1, p2: l.p2 };
        } else props.onSelectLine(l?.id ?? null, false);
        break;
      }
      default:
        break;
    }
  };

  /** Ограничение перемещения: Ctrl — только X, Shift — только Y. */
  const constrain = (dx: number, dy: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): [number, number] => {
    if (e.ctrlKey || e.metaKey) return [dx, 0];
    if (e.shiftKey) return [0, dy];
    return [dx, dy];
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const { sx, sy } = local(e);
    hover.current = { sx, sy };
    const d = drag.current;
    if (!d) {
      redraw();
      return;
    }
    const a = frame.toAxisPoint(sx, sy);
    switch (d.kind) {
      case "pan": {
        const kx = (d.view.xmax - d.view.xmin) / frame.pw;
        const ky = (d.view.ymax - d.view.ymin) / frame.ph;
        const dx = (sx - d.sx) * kx;
        const dy = (sy - d.sy) * ky;
        props.onView({ xmin: d.view.xmin - dx, xmax: d.view.xmax - dx, ymin: d.view.ymin + dy, ymax: d.view.ymax + dy });
        break;
      }
      case "rect":
        d.ex = sx;
        d.ey = sy;
        redraw();
        break;
      case "lasso":
        d.pts.push(sx, sy);
        redraw();
        break;
      case "node": {
        const [dx, dy] = constrain(a.x - d.start.x, a.y - d.start.y, e);
        const np = { x: d.orig.x + dx, y: d.orig.y + dy };
        props.onUpdateLine(d.lineId, d.which === 1 ? { p1: np, p2: d.other, trend: undefined } : { p1: d.other, p2: np, trend: undefined });
        break;
      }
      case "body": {
        const [dx, dy] = constrain(a.x - d.start.x, a.y - d.start.y, e);
        props.onUpdateLine(d.lineId, {
          p1: { x: d.p1.x + dx, y: d.p1.y + dy },
          p2: { x: d.p2.x + dx, y: d.p2.y + dy },
          trend: undefined,
        });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const additive = multi || e.shiftKey;
    if (d.kind === "rect") {
      const x0 = Math.min(d.sx, d.ex);
      const x1 = Math.max(d.sx, d.ex);
      const y0 = Math.min(d.sy, d.ey);
      const y1 = Math.max(d.sy, d.ey);
      if (d.zoom) {
        if (x1 - x0 > 6 && y1 - y0 > 6) {
          const a = frame.toAxisPoint(x0, y1);
          const b = frame.toAxisPoint(x1, y0);
          props.onView({ xmin: a.x, xmax: b.x, ymin: a.y, ymax: b.y });
        }
      } else if (x1 - x0 < 3 && y1 - y0 < 3) {
        if (!additive) props.onSelectRows([], false);
      } else {
        props.onSelectRows(rowsWhere((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1), additive);
      }
    }
    if (d.kind === "lasso" && d.pts.length > 6) {
      props.onSelectRows(rowsWhere((x, y) => pointInPolygon(x, y, d.pts)), additive);
    }
    redraw();
  };

  // Колесо: масштаб вокруг курсора (обработчик не пассивный, чтобы не прокручивать страницу).
  const viewRef = useRef(view);
  viewRef.current = view;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const onViewRef = useRef(props.onView);
  onViewRef.current = props.onView;
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const fr = frameRef.current;
      const v = viewRef.current;
      const a = fr.toAxisPoint(e.clientX - r.left, e.clientY - r.top);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      onViewRef.current({
        xmin: a.x - (a.x - v.xmin) * k,
        xmax: a.x + (v.xmax - a.x) * k,
        ymin: a.y - (a.y - v.ymin) * k,
        ymax: a.y + (v.ymax - a.y) * k,
      });
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  const cursor =
    tool === "pan" ? "grab" : tool === "editline" ? "move" : tool === "pickline" || tool === "info" ? "pointer" : "crosshair";

  return (
    <div ref={wrapRef} className="chart-canvas-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, cursor, display: "block", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hover.current = null;
          redraw();
        }}
        onDoubleClick={() => {
          if (tool === "zoom" || tool === "pan") props.onView(chart.defaultView ?? autoView(data.series, chart.xLog, chart.yLog));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          pending.current = null;
          props.onContextMenu(e.clientX, e.clientY);
        }}
      />
      <div className="chart-legend">
        {data.series.map((s) => (
          <span key={s.key}>
            <i style={{ color: s.color }}>{s.marker === "cross" ? "+" : s.marker === "circle" ? "○" : s.marker === "step" ? "—" : "●"}</i> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
