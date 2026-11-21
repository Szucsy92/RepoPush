import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerSW } from "./lib/pwa";
import { installPressFeedback } from "./lib/haptics";
import { installSystemInsets } from "./lib/insets";
import { installTheme } from "./lib/theme";
import "./styles.css";

installTheme(); // the saved colour theme is on before the first paint of the app
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerSW();
installPressFeedback();
installSystemInsets();
