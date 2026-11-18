import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerSW } from "./lib/pwa";
import { installPressFeedback } from "./lib/haptics";
import { installSystemInsets } from "./lib/insets";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerSW();
installPressFeedback();
installSystemInsets();
