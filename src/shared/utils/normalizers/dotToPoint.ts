export function parseBRL(value: any): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;
  return parseFloat(String(value).replace(/\./g, "").replace(",", ".")) || 0;
}