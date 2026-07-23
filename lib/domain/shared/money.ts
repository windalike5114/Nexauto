import { z } from "zod";

export const CurrencyCodeSchema = z.literal("nzd");
export const MinorUnitAmountSchema = z.number().int().nonnegative();

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type MinorUnitAmount = z.infer<typeof MinorUnitAmountSchema>;

export function toMinorUnits(value: number) {
  return Math.round(value * 100);
}

export function fromMinorUnits(value: number) {
  return value / 100;
}
