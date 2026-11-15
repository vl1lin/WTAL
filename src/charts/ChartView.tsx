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
import { useCursor } from "./cursor";

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
  | { kind: "body"; lineId: string; start: AxisPoint; p1: AxisPoint; p2: AxisPoint }
  | { kind: "cnode"; lineId: string; index: number; start: AxisPoint; orig: AxisPoint }
  | { kind: "cbody"; lineId: string; start: AxisPoint; pts: AxisPoint[] };

const THEMES = {
  dark: { bg: "#0B1016", grid: "#243041", minor: "#151D28", axis: "#64748B", text: "#CBD5E1", sel: "#FACC15" },
  light: { bg: "#FFFFFF", grid: "#E2E8F0", minor: "#F1F5F9", axis: "#64748B", text: "#334155", sel: "#CA8A04" },
};

/** Значение с единицей из подписи оси («Δt, ч» → «12 ч»). */
function withUnit(v: string, label: string): string {
  const i = label.indexOf(",");
  return i >= 0 ? `${v} ${label.slice(i + 1).trim()}` : v;
}

/**
 * Сглаженная кривая через узлы (центростремительный сплайн Катмулла–Рома).
 * @param pts узлы в пикселях
 * @param steps точек на участок между узлами
 * @returns точки кривой в пикселях (проходит через все узлы)
 */
export function catmullRom(pts: [number, number][], steps = 20): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [];
  const get = (i: number): [number, number] => pts[Math.max(0, Math.min(pts.length - 1, i))] ?? [0, 0];
  const tj = (ti: number, a: [number, number], b: [number, number]): number => ti + Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i === 0 ? ([2 * get(0)[0] - get(1)[0], 2 * get(0)[1] - get(1)[1]] as [number, number]) : get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = i + 2 >= pts.length ? ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] as [number, number]) : get(i + 2);
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => [
        ((tb - t) / (tb - ta)) * a[0] + ((t - ta) / (tb - ta)) * b[0],
        ((tb - t) / (tb - ta)) * a[1] + ((t - ta) / (tb - ta)) * b[1],
      ];
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  out.push(get(pts.length - 1));
  return out;
}

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
  const pendingCtrl = useRef(false);
  const pendingCurve = useRef<AxisPoint[]>([]);
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
      if (l.curve && l.curve.length > 1) {
        const px = catmullRom(l.curve.map((n) => [frame.px(n.x), frame.py(n.y)] as [number, number]));
        const segs: [number, number, number, number][] = [];
        for (let i = 1; i < px.length; i++) {
          const a = px[i - 1];
          const b = px[i];
          if (a && b) segs.push([a[0], a[1], b[0], b[1]]);
        }
        return segs;
      }
      if (!l.p1 || !l.p2) return [];
      if (l.infinite === false) {
        return [[frame.px(l.p1.x), frame.py(l.p1.y), frame.px(l.p2.x), frame.py(l.p2.y)]];
      }
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
      // Вид точек: размер маркера, непрозрачность, прореживание (выделенные точки рисуются всегда).
      const ps = chart.pointStyle ?? { size: 1, opacity: 1, thin: 1 };
      const k = ps.size;
      const thin = Math.max(1, Math.round(ps.thin));
      g.lineWidth = Math.max(0.6, 1.3 * Math.min(k, 1.4));
      pts.forEach((p, idx) => {
        if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy)) return;
        const isSel = selected.has(p.row) && s.studyId === chart.studyId;
        if (!isSel && idx % thin !== 0) return;
        g.globalAlpha = isSel ? 1 : ps.opacity;
        if (isSel) {
          g.strokeStyle = theme.sel;
          g.fillStyle = theme.sel;
        }
        switch (s.marker) {
          case "cross":
            g.beginPath();
            g.moveTo(p.sx - 3.2 * k, p.sy);
            g.lineTo(p.sx + 3.2 * k, p.sy);
            g.moveTo(p.sx, p.sy - 3.2 * k);
            g.lineTo(p.sx, p.sy + 3.2 * k);
            g.stroke();
            break;
          case "circle":
            g.beginPath();
            g.arc(p.sx, p.sy, 2.8 * k, 0, Math.PI * 2);
            g.stroke();
            break;
          case "dot":
          case "line":
            g.beginPath();
            g.arc(p.sx, p.sy, 2.2 * k, 0, Math.PI * 2);
            g.fill();
            break;
        }
        if (isSel) {
          g.globalAlpha = 0.45;
          g.beginPath();
          g.arc(p.sx, p.sy, 5.5 * Math.max(0.6, k), 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = s.color;
          g.fillStyle = s.color;
        }
      });
      g.globalAlpha = 1;
      g.lineWidth = 1.3;
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
      if (l.curve) {
        for (const n of l.curve) {
          g.fillStyle = isSel ? l.color : theme.bg;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(frame.px(n.x), frame.py(n.y), isSel ? 4.5 : 3.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        const last = l.curve[l.curve.length - 1];
        if (last) {
          g.font = "11px Inter, system-ui, sans-serif";
          g.textAlign = "left";
          g.textBaseline = "bottom";
          g.fillStyle = l.color;
          g.fillText(l.name, frame.px(last.x) + 8, frame.py(last.y) - 8);
        }
      } else if (l.p1 && l.p2 && !lineTrend(l, chart)) {
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
    const pc = pendingCurve.current;
    if (pc.length > 0) {
      const nodes = pc.map((n) => [frame.px(n.x), frame.py(n.y)] as [number, number]);
      if (h) nodes.push([h.sx, h.sy]);
      const poly = catmullRom(nodes);
      g.strokeStyle = "#F472B6";
      g.beginPath();
      poly.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#F472B6";
      for (const [x, y] of nodes.slice(0, pc.length)) {
        g.beginPath();
        g.arc(x, y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.setLineDash([5, 4]);
    }
    if (pending.current && h) {
      g.strokeStyle = "#34D399";
      g.beginPath();
      g.moveTo(frame.px(pending.current.x), frame.py(pending.current.y));
      g.lineTo(h.sx, h.sy);
      g.stroke();
    }
    g.setLineDash([]);

    if (data.warning) {
      // Подсказка переносится по словам в пределах области построения.
      g.fillStyle = theme.text;
      g.font = "13px Inter, system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const maxW = Math.max(120, frame.pw - 24);
      const lines: string[] = [];
      let cur = "";
      for (const w of data.warning.split(" ")) {
        const t = cur ? `${cur} ${w}` : w;
        if (g.measureText(t).width > maxW && cur) {
          lines.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) lines.push(cur);
      const lh = 18;
      const y0 = T + frame.ph / 2 - ((lines.length - 1) * lh) / 2;
      g.fillStyle = chart.theme === "dark" ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";
      const boxW = Math.min(frame.pw - 8, Math.max(...lines.map((l) => g.measureText(l).width)) + 24);
      g.fillRect(L + frame.pw / 2 - boxW / 2, y0 - lh, boxW, lines.length * lh + lh);
      g.fillStyle = theme.text;
      lines.forEach((l, k) => g.fillText(l, L + frame.pw / 2, y0 + k * lh));
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
  const hitCurveNode = (sx: number, sy: number): { line: LineDef; index: number } | null => {
    for (const l of chart.lines) {
      if (!l.curve) continue;
      const i = l.curve.findIndex((n) => Math.hypot(frame.px(n.x) - sx, frame.py(n.y) - sy) < 8);
      if (i >= 0) return { line: l, index: i };
    }
    return null;
  };

  /** Завершить построение кривой (нужно не меньше двух узлов). */
  const finishCurve = (): void => {
    const pts = pendingCurve.current;
    pendingCurve.current = [];
    if (pts.length >= 2) props.onAddLine({ id: uid(), name: `Кривая ${chart.lines.length + 1}`, color: "#F472B6", curve: pts });
    redraw();
  };

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
        // Отрезок между двумя точками; с Ctrl (на любом из кликов) — бесконечная прямая.
        if (!pending.current) {
          pending.current = a;
          pendingCtrl.current = e.ctrlKey || e.metaKey;
        } else {
          const p1 = pending.current;
          const infinite = pendingCtrl.current || e.ctrlKey || e.metaKey;
          pending.current = null;
          props.onAddLine({ id: uid(), name: `Прямая ${chart.lines.length + 1}`, color: "#34D399", p1, p2: a, infinite });
        }
        redraw();
        break;
      case "curve": {
        // Кривая через точки: клик — узел; двойной клик, Enter или ПКМ — завершить, Esc — отменить.
        const pts = pendingCurve.current;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(frame.px(last.x) - sx, frame.py(last.y) - sy) > 3) pts.push(a);
        redraw();
        break;
      }
      case "pickline":
      case "info": {
        const l = hitLine(sx, sy);
        props.onSelectLine(l?.id ?? null, tool === "info" && l !== null);
        break;
      }
      case "editline": {
        const cn = hitCurveNode(sx, sy);
        if (cn && cn.line.curve) {
          props.onSelectLine(cn.line.id, false);
          drag.current = { kind: "cnode", lineId: cn.line.id, index: cn.index, start: a, orig: cn.line.curve[cn.index] ?? a };
          break;
        }
        const n = hitNode(sx, sy);
        if (n && n.line.p1 && n.line.p2) {
          props.onSelectLine(n.line.id, false);
          const orig = n.which === 1 ? n.line.p1 : n.line.p2;
          const other = n.which === 1 ? n.line.p2 : n.line.p1;
          drag.current = { kind: "node", lineId: n.line.id, which: n.which, start: a, orig, other };
          break;
        }
        const l = hitLine(sx, sy);
        if (l && l.curve) {
          props.onSelectLine(l.id, false);
          drag.current = { kind: "cbody", lineId: l.id, start: a, pts: l.curve };
        } else if (l && l.p1 && l.p2 && !lineTrend(l, chart)) {
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
    if (frame.inside(sx, sy)) {
      const a = frame.toAxisPoint(sx, sy);
      useCursor.getState().set({
        chartName: chart.name,
        x: withUnit(fmtTick(fromAxis(a.x, chart.xLog)), data.xLabel),
        y: withUnit(fmtTick(fromAxis(a.y, chart.yLog)), data.yLabel),
        xLabel: data.xLabel.split(",")[0]?.trim() || "x",
        yLabel: data.yLabel.split(",")[0]?.trim() || "y",
      });
    } else useCursor.getState().set(null);
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
        let np: AxisPoint;
        if (e.altKey) {
          // Alt — конец скользит вдоль прямой: длина меняется, наклон — нет.
          const ox = frame.px(d.other.x);
          const oy = frame.py(d.other.y);
          const vx = frame.px(d.orig.x) - ox;
          const vy = frame.py(d.orig.y) - oy;
          const len = Math.hypot(vx, vy) || 1;
          const t = Math.max(4, ((sx - ox) * vx + (sy - oy) * vy) / len);
          np = frame.toAxisPoint(ox + (vx / len) * t, oy + (vy / len) * t);
        } else {
          const [dx, dy] = constrain(a.x - d.start.x, a.y - d.start.y, e);
          np = { x: d.orig.x + dx, y: d.orig.y + dy };
        }
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
      case "cnode": {
        const [dx, dy] = constrain(a.x - d.start.x, a.y - d.start.y, e);
        const line = chart.lines.find((l) => l.id === d.lineId);
        if (!line?.curve) break;
        const curve = line.curve.map((n, i) => (i === d.index ? { x: d.orig.x + dx, y: d.orig.y + dy } : n));
        props.onUpdateLine(d.lineId, { curve });
        break;
      }
      case "cbody": {
        const [dx, dy] = constrain(a.x - d.start.x, a.y - d.start.y, e);
        props.onUpdateLine(d.lineId, { curve: d.pts.map((n) => ({ x: n.x + dx, y: n.y + dy })) });
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

  // Кривая: Enter — завершить, Esc — отменить. Прямая: Esc — отменить первую точку.
  const finishRef = useRef(finishCurve);
  finishRef.current = finishCurve;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && (pendingCurve.current.length > 0 || pending.current)) {
        pendingCurve.current = [];
        pending.current = null;
        redraw();
      } else if (e.key === "Enter" && pendingCurve.current.length > 0) finishRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redraw]);
  useEffect(() => {
    if (tool !== "curve") pendingCurve.current = [];
    if (tool !== "line2") pending.current = null;
  }, [tool]);

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
          useCursor.getState().set(null);
          redraw();
        }}
        onDoubleClick={() => {
          if (tool === "curve") finishCurve();
          else if (tool === "zoom" || tool === "pan") props.onView(chart.defaultView ?? autoView(data.series, chart.xLog, chart.yLog));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          pending.current = null;
          if (pendingCurve.current.length > 0) {
            finishCurve();
            return;
          }
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
