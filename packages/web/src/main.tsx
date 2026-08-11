import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import i18n from "./i18n";
import App from "./App";
import { initializeTheme } from "./services/theme";
import "./styles/globals.css";

initializeTheme();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element was not found");

createRoot(rootElement).render(
  <StrictMode>
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--bg-base)] text-sm text-[var(--text-secondary)]">
          {i18n.t("loading")}
        </div>
      }
    >
      <App />
    </Suspense>
  </StrictMode>,
);
