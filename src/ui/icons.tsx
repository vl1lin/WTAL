/**
 * Набор линейных SVG-иконок интерфейса.
 * Icon({name, size}) — иконка 24×24, цвет берётся из currentColor.
 */
const PATHS: Record<string, string> = {
  pencil: "M4 20h4L19 9l-4-4L4 16z",
  minimize: "M5 18h14",
  maximize: "M5 5h14v14H5z",
  restore: "M8 8h11v11H8zM5 16V5h11",
  close: "M6 6l12 12M18 6L6 18",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  axes: "M4 3v17h17M4 8h2M4 13h2M10 20v-2M15 20v-2",
  zoomin: "M3 3h10v10H3zM15.5 11.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8M18.5 18.5L21 21M13.5 15.5h4M15.5 13.5v4",
  zoomout: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13M15.5 15.5L21 21M7.5 10.5h6",
  reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5",
  savedef: "M6 3h12v18l-6-4.5L6 21zM9.5 9.5l2 2 3.5-4",
  hide: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5M4 20L20 4",
  pan: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  line2: "M5 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4M19 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4M6.5 17.5l11-11",
  trend: "M3 20L21 4M5 16.5v1M9 14.5v1M12 10.5v1M16 8.5v1M19 4.5v1",
  pickline: "M4 20L20 4M12 11l7 3-3 1-1 3z",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18M12 11v6M12 7.5v.5",
  editline: "M5 19L19 5M3 17h4v4H3zM17 3h4v4h-4zM14 17h6M17 14v6",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  rect: "M3.5 5h17v14h-17zM9 12h.01M14 10h.01",
  lasso: "M7 17c-4-2-4-8 2-10s12 0 11 5-8 5-11 4M7 17c0 2 1 3 3 4",
  click: "M7 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5M11 11l8 3.5-3.5 1.3-1.3 3.5z",
  clearsel: "M3.5 5h17v14h-17zM8 9l8 6M16 9l-8 6",
  loglog: "M4 3v17h17M6 17c3-1 4-5 6-7s4-2 7-2M8 7h1M8 11h1M14 17v1M18 17v1",
  semilog: "M4 3v17h17M6 8l13 9",
  history: "M4 3v17h17M6 8h4l1 6 3-3h2l3-5",
  rates: "M4 3v17h17M5 8h5v6h4V9h5",
  combo: "M4 3v17h17M4 11.5h17M6 8c2-3 4 1 6-1s4-2 7-1M6 17h4v-3h5v2h4",
  custom: "M4 3v17h17M7 15c2-6 6-8 12-8M13 13h5M15.5 10.5v5",
  columns: "M3 4h18v16H3zM9 4v16M15 4v16M3 9h18",
  sort: "M7 4v16M4 17l3 3 3-3M14 6h7M14 11h5M14 16h3",
  addcol: "M3 4h12v16H3zM9 4v16M19 9v6M16 12h6",
  fx: "M10 4c-2 0-3 1-3 3v13M4 10h6M14 10l6 8M20 10l-6 8",
  plotsel: "M4 3v17h17M7 15l4-4 3 3 5-6",
  upload: "M12 4v12M7 11l5 5 5-5M4 20h16",
  calc: "M5 3h14v18H5zM8 7h8M8 12h2M12 12h2M16 12h.01M8 16h2M12 16h2M16 16h.01",
  gear: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  home: "M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5",
  newstudy: "M4 3v17h17M7 15l4-4 3 3 5-6M17 3v6M14 6h6",
  logo: "M3 21V3M3 21h18M5 17c4 0 5-9 9-9s4 4 7 4",
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
