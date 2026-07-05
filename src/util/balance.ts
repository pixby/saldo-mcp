/**
 * Map raw balance-type codes to friendly labels for presentation. Providers use
 * ISO 20022 codes (CLBD, ITAV, …) or camelCase variants; we don't want those
 * surfaced to users or assistants. Unknown codes pass through unchanged.
 */
const LABELS: Record<string, string> = {
  // ISO 20022 codes (Enable Banking)
  CLBD: "Booked",
  CLAV: "Available",
  ITBD: "Booked (interim)",
  ITAV: "Available",
  OPBD: "Opening booked",
  OPAV: "Opening available",
  FWAV: "Forward available",
  PRCD: "Previously closed booked",
  INFO: "Informational",
  XPCD: "Expected",
  // camelCase variants (some backends)
  closingBooked: "Booked",
  closingAvailable: "Available",
  interimBooked: "Booked (interim)",
  interimAvailable: "Available",
  openingBooked: "Opening booked",
  forwardAvailable: "Forward available",
  expected: "Expected",
};

export function balanceTypeLabel(type: string): string {
  return LABELS[type] ?? type;
}
