import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/spectral/600.css";
import "@fontsource/spectral/700.css";
import "./styles/globals.css";
import "./tools";
import { App } from "./App";
import { startNativeShell } from "./lib/native";

// In the iPhone app: keep the app's background the page colour.
startNativeShell();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
