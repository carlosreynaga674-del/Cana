import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "@fontsource/permanent-marker/latin-400.css";
import "./styles.css";
import "./reference.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
