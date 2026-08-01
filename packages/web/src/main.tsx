import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import i18n from "./i18n";
import App from "./App";
import { initializeTheme } from "./services/theme";
import "./styles/globals.css";

initializeTheme();

createRoot(document.getElementById("root")!).render(
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
  </StrictMode>
);
