/**
 * Reject if `promise` hasn't settled within `ms`.
 *
 * BullMQ's add() waits for a Redis connection rather than failing fast, so
 * request-path enqueues are bounded with this to keep HTTP responses
 * (webhook acks, guest status polls) from hanging when Redis is down.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
