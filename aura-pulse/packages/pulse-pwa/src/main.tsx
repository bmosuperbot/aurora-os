import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/aura.css";
import { registerAuraCatalog } from "./a2ui/aura-catalog.js";
import { App } from "./App.js";

// Register Aura's custom A2UI component catalog (ActionButton, DecisionChips,
// ArtifactTextField, ContractMetaRow). Must run before any A2UIViewer mounts.
// @a2ui/react auto-injects its own styles via A2UIProvider on first render.
registerAuraCatalog();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
