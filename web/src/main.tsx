import "./style.css";

import { render } from "preact";

import { App } from "./App.js";

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
