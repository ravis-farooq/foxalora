/** Dependency-injection tokens for shared infrastructure. */
export const DB = Symbol('DB');
export const VALKEY = Symbol('VALKEY');

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
