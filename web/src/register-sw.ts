interface ServiceWorkerHost {
  serviceWorker?: { register(url: string, options: { scope: string }): Promise<unknown> };
}

/**
 * Registers the app-shell service worker (AC-013.1). Installing doesn't depend on it, so a
 * failure is reported and the app carries on.
 */
export async function registerServiceWorker(
  host: ServiceWorkerHost,
  log: Pick<Console, "warn">,
): Promise<void> {
  if (host.serviceWorker === undefined) {
    return;
  }
  try {
    await host.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    // Name only: messages can carry URLs.
    log.warn("Service worker registration failed", error instanceof Error ? error.name : "unknown");
  }
}
