/**
 * Расчёт площади поверхности трещин ГРП по инварианте (наклону на графике √t).
 * Повторяет методику из Excel пользователя, но все величины — в СИ.
 *
 * Схема:
 *   CalcState ──mixture()──► свойства смеси (B, μ, cₜ, ρ)
 *   + данные исследования (q, φ, m) ──fractureArea()──► A, Σx_f, x̄_f
 *
 * Формулы:
 *   B = Bн·(1−W) + Bв·W
 *   μ = μн·μв / (W·μн + (1−W)·μв)
 *   cₜ = cск + (1−W)·cн + W·cв
 *   k = K_рад / n
 *   A = 2·q·B / (√π·m) · √(μ / (cₜ·k·φ))
 *   Σx_f = A / (4·h·n),  x̄_f = Σx_f / n
 */
import type { CalcState } from "./types";

export interface Mixture {
  fvf: number;
  viscosity_Pa_s: number;
  compressibility_1_Pa: number;
  density_kg_m3: number;
}

/**
 * Свойства смеси нефть+вода.
 * @param s состояние калькулятора (СИ)
 * @returns объёмный коэффициент, вязкость (Па·с), сжимаемость (1/Па), плотность (кг/м³)
 */
export function mixture(s: CalcState): Mixture {
  const w = s.waterCut;
  const o = s.oil;
  const wa = s.water;
  const den = w * o.viscosity_Pa_s + (1 - w) * wa.viscosity_Pa_s;
  return {
    fvf: o.fvf * (1 - w) + wa.fvf * w,
    viscosity_Pa_s: den > 0 ? (o.viscosity_Pa_s * wa.viscosity_Pa_s) / den : Number.NaN,
    compressibility_1_Pa: s.rockCompressibility_1_Pa + (1 - w) * o.compressibility_1_Pa + w * wa.compressibility_1_Pa,
    density_kg_m3: o.density_kg_m3 * (1 - w) + wa.density_kg_m3 * w,
  };
}

export interface FractureResult {
  area_m2: number;
  sumHalfLength_m: number;
  meanLength_m: number;
}

/**
 * Площадь поверхности трещин и полудлины для одного исследования.
 * @param s состояние калькулятора (СИ)
 * @param rate_m3_s дебит, м³/с
 * @param porosity пористость, д.ед.
 * @param invariant_Pa_s05 инварианта m, Па/с^0.5
 * @returns A (м²), Σx_f (м), x̄_f (м); NaN при некорректных входных данных
 */
export function fractureArea(
  s: CalcState,
  rate_m3_s: number,
  porosity: number,
  invariant_Pa_s05: number,
): FractureResult {
  const mx = mixture(s);
  const k = s.kRad_m2 / s.fractures;
  const A =
    ((2 * rate_m3_s * mx.fvf) / (Math.sqrt(Math.PI) * invariant_Pa_s05)) *
    Math.sqrt(mx.viscosity_Pa_s / (mx.compressibility_1_Pa * k * porosity));
  const sum = A / (4 * s.h_m * s.fractures);
  return { area_m2: A, sumHalfLength_m: sum, meanLength_m: sum / s.fractures };
}
