"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, which is what makes the app installable.
 *
 * Deliberately silent: a browser with service workers disabled, or a page
 * served over plain HTTP in development, should degrade to an ordinary web app
 * rather than show an error nobody can act on.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    // Registration competes with hydration for the main thread, so it waits
    // until the page has settled.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.warn("[pwa] service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}

/**
 * Tells the worker to drop every cache.
 *
 * Called on sign-out. The caches hold no user data by policy, but clearing them
 * makes that true by construction rather than by review.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  registration?.active?.postMessage({ type: "CLEAR_CACHES" });
}
