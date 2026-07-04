/**
 * Naive per-instance throttle: serialize upstream CF calls with a minimum gap
 * so a burst of users can't push this instance past CF's ~5 req/s limit.
 * Not shared across serverless instances.
 */

const MIN_GAP_MS = 250;
let lastCallAt = 0;
let queue: Promise<void> = Promise.resolve();

export function throttleCf(): Promise<void> {
  queue = queue.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  return queue;
}
