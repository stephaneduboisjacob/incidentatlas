import React from "react";
import { createRoot } from "react-dom/client";
import { IncidentAtlas } from "./ui.js";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IncidentAtlas />
  </React.StrictMode>,
);
