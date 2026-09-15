export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordValue = Record<string, unknown>;
export function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected protocol object');
  return value as RecordValue;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected protocol string');
  return value;
}
export interface Activity {
  at: string; role: string; session: string | null; turn: string | null;
  kind: string; data: unknown; late: boolean;
}
export type Sink = (event: Activity) => void;
export interface RpcPort {
  call(method: string, params?: unknown): Promise<unknown>;
  onEvent(listener: (method: string, params: unknown) => void): () => void;
  close(): void;
}
export const PINNED_CODEX = '0.154.0';
export const ASTRA = 'gpt-6-astra';
