import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/spectral/600.css";
import "@fontsource/spectral/700.css";
import "./styles/globals.css";
import "./tools";
import { App } from "./App";
import { storedCacheRestored } from "./cache";
import { startNativeShell } from "./lib/native";

// In the iPhone app: keep the app's background the page colour.
startNativeShell();

/** How long the first render waits for the stored cache; past it, the restore finishes behind the page. */
const RESTORE_WAIT_MS = 300;

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// The lists and chapters kept from the last launch go into the query cache first, so the first
// frame already has them (App.tsx started the restore when it was imported).
void Promise.race([storedCacheRestored(), new Promise<void>((resolve) => setTimeout(resolve, RESTORE_WAIT_MS))]).then(render);
