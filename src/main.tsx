import "@fontsource/source-serif-4/cyrillic-400.css";
import "@fontsource/source-serif-4/cyrillic-700.css";
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-700.css";
import "katex/dist/katex.min.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/workspace.css";
import "./styles/home.css";
import "./styles/print.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
