import "./style.css";

import { render } from "preact";

import { App } from "./App.js";
import { registerServiceWorker } from "./register-sw.js";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("Missing #app element");
}
render(
  <main>
    <h1>TCGrass</h1>
    <App />
  </main>,
  root,
);

// Production only: in development a cached shell would hide changes from the Vite dev server.
// After `load`, so caching the shell doesn't compete with the first API calls.
if (import.meta.env.PROD) {
  window.addEventListener(
    "load",
    () => {
      void registerServiceWorker(navigator, console);
    },
    { once: true },
  );
}
