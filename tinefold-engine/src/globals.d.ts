/**
 * The engine is DOM-free on purpose (no "DOM" lib). Provider adapters need only
 * these globals, which exist in browsers and in Node >= 18.
 */
declare interface AbortSignal {
  readonly aborted: boolean;
}
declare interface Response {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
declare function fetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
): Promise<Response>;
declare function setTimeout(fn: () => void, ms?: number): unknown;
declare const crypto: { getRandomValues<T extends Uint8Array>(arr: T): T } | undefined;
