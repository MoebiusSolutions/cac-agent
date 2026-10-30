import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "CAC SSL Relay",
    identifier: "com.moesol.cac.sslrelay",
    version: "0.2.0",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts", external: ["koffi"] },
    views: {
      mainview: { entrypoint: "src/mainview/index.ts" },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
      "node_modules/koffi": "node_modules/koffi",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
