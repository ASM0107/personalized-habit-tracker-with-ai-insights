import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { AppContextProvider } from "./core/ui/AppContext.js";
import "./index.css";

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find root DOM element");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <AppContextProvider>
      <App />
    </AppContextProvider>
  </StrictMode>
);
