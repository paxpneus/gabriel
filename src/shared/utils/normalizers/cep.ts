export function sanitizeCep(value: string | null): string {
  if (!value) return "";
  return value.replace(/\D/g, '').padStart(8, '0').slice(0, 8);
}