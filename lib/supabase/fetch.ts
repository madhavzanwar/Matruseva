/** fetch with a hard timeout so an unreachable Supabase can't hang a request until the OS TCP timeout. */
export function fetchWithTimeout(ms = 10_000): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}
