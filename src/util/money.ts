import type { Money } from "../domain/types.js";

/**
 * Parse a decimal amount string (as open-banking APIs return, e.g. "-1234.56")
 * into integer minor units (öre/cents). String-based to avoid float rounding
 * errors like 12.34 * 100 === 1233.9999999999998.
 *
 * Assumes 2 fractional digits, which holds for SEK/EUR/USD and every currency
 * we target. Revisit if a 0- or 3-decimal currency ever shows up.
 */
export function toMinorUnits(amount: string): number {
  const trimmed = amount.trim();
  const negative = trimmed.startsWith("-");
  const digits = trimmed.replace(/[^0-9.]/g, "");
  const [whole = "0", frac = ""] = digits.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const minor = parseInt(whole || "0", 10) * 100 + parseInt(fracPadded, 10);
  return negative ? -minor : minor;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  EUR: "€",
  USD: "$",
};

/**
 * Format minor units for display, Swedish-style: space thousands separator,
 * comma decimal, symbol/code suffix. e.g. formatMinor(-123456, "SEK") -> "-1 234,56 kr".
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${negative ? "-" : ""}${grouped},${frac} ${symbol}`;
}

export function formatMoney(money: Money): string {
  return formatMinor(money.amountMinor, money.currency);
}
