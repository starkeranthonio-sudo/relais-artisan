import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// Essai de couleurs : ?accent=jaune pour comparer avec l'orange.
const accent = new URLSearchParams(window.location.search).get("accent");
if (accent) document.documentElement.dataset.accent = accent;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
