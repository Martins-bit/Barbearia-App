export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[()\s-]/g, '');
}
