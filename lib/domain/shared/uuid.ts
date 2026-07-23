export const looseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLooseUuid(value: string | null | undefined) {
  return Boolean(value && looseUuidPattern.test(value));
}
