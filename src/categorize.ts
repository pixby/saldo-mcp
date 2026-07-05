import type { Transaction } from "./domain/types.js";

/**
 * Rules-based transaction categorizer for Swedish/Nordic merchants. Matches
 * keywords in the counterparty + description. First match wins, so order from
 * specific to general. This replaces the old counterparty-only grouping; it's a
 * pure function so it's easy to test and extend (an ML/hosted categorizer could
 * slot in behind the same signature later).
 */
interface Rule {
  category: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { category: "Groceries", pattern: /\b(ica|coop|hemk[öo]p|willys|lidl|city\s*gross|tempo|mathem|netto|matdax|matp|axfood)\b/i },
  { category: "Dining", pattern: /\b(restaurang|pizzeria|pizza|sushi|mcdonald|burger\s*king|max\s*burg|caf[ée]|espresso\s*house|wayne|foodora|uber\s*eats|wolt|gateau|o'?learys)\b/i },
  { category: "Fuel", pattern: /\b(circle\s*k|okq8|preem|st1|ingo|shell|tanka|qstar)\b/i },
  { category: "Transport", pattern: /\b(sl\b|sj\b|v[äa]sttrafik|sk[åa]netrafik|ul\b|[öo]resundst[åa]g|uber|bolt|taxi|mtr|t[åa]g|parker)\b/i },
  { category: "Subscriptions", pattern: /\b(spotify|netflix|hbo|max\.com|disney|viaplay|apple\.com|itunes|icloud|google|youtube|storytel|audible|patreon|microsoft|adobe|dropbox|notion|openai|anthropic|claude)\b/i },
  { category: "Utilities", pattern: /\b(vattenfall|ellevio|e\.?on|fortum|telia|tele2|comviq|telenor|bredband|hallon|tre\b|g[öo]teborg\s*energi)\b/i },
  { category: "Shopping", pattern: /\b(h\s*&\s*m|\bhm\b|zara|clas\s*ohlson|elgiganten|ikea|amazon|zalando|[åa]hl[ée]ns|kicks|lindex|xxl|power|webhallen|dustin|cdon|nelly|boozt)\b/i },
  { category: "Health", pattern: /\b(apotek|v[åa]rdcentral|tandl[äa]kare|\bkry\b|gym|\bsats\b|nordic\s*wellness|friskis|fitness)\b/i },
  { category: "Entertainment", pattern: /\b(sf\s*bio|filmstaden|bio\b|steam|playstation|nintendo|xbox|ticketmaster)\b/i },
  { category: "Housing", pattern: /\b(hyra|bostad|\bhsb\b|riksbyggen|\bbrf\b|wallenstam|heimstaden)\b/i },
  { category: "Cash", pattern: /\b(uttag|\batm\b|bankomat|kontant|withdrawal)\b/i },
  { category: "Fees", pattern: /\b(avgift|\br[äa]nta\b|\bfee\b|notaravgift|[åa]rsavgift)\b/i },
  { category: "Transfers", pattern: /\b(swish|[öo]verf[öo]ring|transfer|klarna|paypal)\b/i },
];

/** Category name for a transaction. Outflows fall back to "Uncategorized";
 *  unmatched inflows are treated as "Income". */
export function categorize(tx: Pick<Transaction, "counterparty" | "description" | "amount">): string {
  const text = `${tx.counterparty ?? ""} ${tx.description ?? ""}`;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return tx.amount.amountMinor > 0 ? "Income" : "Uncategorized";
}
