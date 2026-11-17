import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.szucsy92.repopush",
  appName: "RepoPush",
  webDir: "dist",
  server: { androidScheme: "https" },
};

export default config;
