/**
 * Координаты курсора над графиком — для строки состояния.
 * Отдельное маленькое хранилище, чтобы движение мыши не перерисовывало всё приложение.
 *
 * Схема: ChartView (pointermove) → setCursor() → useCursor → StatusCursor в строке состояния.
 */
import { create } from "zustand";

export interface CursorInfo {
  chartName: string;
  x: string;
  y: string;
  xLabel: string;
  yLabel: string;
}

export const useCursor = create<{ cursor: CursorInfo | null; set(c: CursorInfo | null): void }>((set) => ({
  cursor: null,
  set: (cursor) => set({ cursor }),
}));
