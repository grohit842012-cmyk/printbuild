import type { Variation, RoomType } from "./design-types";

export type Currency = "INR" | "USD";

const NON_LIVABLE: RoomType[] = ["stairs", "lift", "parking", "utility"];

export interface DesignEstimates {
  builtUpAreaSqft: number;
  livableAreaSqft: number;
  parkingAreaSqft: number;
  cost: { inr: number; usd: number };
  printDays: number;
  printHours: number;
  bedrooms: number;
  bathrooms: number;
  hasLift: boolean;
}

/**
 * Quick-and-honest estimates. Rates are configurable defaults — actual numbers
 * depend on materials, finishes, and local labour.
 *  - INR ≈ ₹2,000 / sqft (mid-range residential, 2026)
 *  - USD ≈ $180 / sqft
 * 3D-print time assumes ~120 sqft / printer-day on a residential gantry.
 */
export function computeEstimates(variation: Variation): DesignEstimates {
  let built = 0;
  let livable = 0;
  let parking = 0;
  let bedrooms = 0;
  let bathrooms = 0;
  let hasLift = false;

  for (const plate of variation.plates) {
    for (const r of plate.rooms) {
      const a = r.w * r.h;
      built += a;
      if (NON_LIVABLE.includes(r.type)) {
        if (r.type === "parking") parking += a;
      } else {
        livable += a;
      }
      if (r.type === "bedroom" || r.type === "master_bedroom") bedrooms += 1;
      if (r.type === "bath") bathrooms += 1;
      if (r.type === "lift") hasLift = true;
    }
  }
  // External parking strip (if any)
  if (variation.parking) parking += variation.parking.w * variation.parking.h;

  const inrPerSqft = 2000;
  const usdPerSqft = 180;
  const cost = {
    inr: Math.round(built * inrPerSqft),
    usd: Math.round(built * usdPerSqft),
  };

  const printSqftPerDay = 120;
  const printDays = Math.max(1, Math.ceil(built / printSqftPerDay));
  const printHours = Math.round(built / 5); // ≈ 5 sqft/hr including curing

  return {
    builtUpAreaSqft: Math.round(built),
    livableAreaSqft: Math.round(livable),
    parkingAreaSqft: Math.round(parking),
    cost,
    printDays,
    printHours,
    bedrooms,
    bathrooms,
    hasLift,
  };
}

export function formatCurrency(amount: number, currency: Currency): string {
  if (currency === "INR") {
    // Indian numbering system grouping
    return "₹" + new Intl.NumberFormat("en-IN").format(amount);
  }
  return "$" + new Intl.NumberFormat("en-US").format(amount);
}
