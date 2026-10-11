import "./style.css";

import { render } from "preact";

import { App } from "./App.js";
import { Icon } from "./Icon.js";
import { registerServiceWorker } from "./register-sw.js";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("Missing #app element");
}
render(
  <main>
    <header class="masthead">
      <Icon name="leaf" size={28} />
      <h1 class="wordmark">TCGrass</h1>
      <span class="masthead-note">field journal</span>
    </header>
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
