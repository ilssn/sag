const updateBaseUrl = process.env.SAG_UPDATE_BASE_URL?.replace(/\/+$/, "");
const shouldNotarize = process.env.SAG_NOTARIZE === "true";

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: process.env.SAG_DESKTOP_APP_ID || "ai.zleap.sag",
  productName: "SAG",
  copyright: "Copyright © Zleap AI",
  asar: true,
  compression: "normal",
  directories: {
    output: "release",
    buildResources: "assets"
  },
  files: [
    "dist/**/*",
    "assets/splash.html",
    "assets/icon-master.png",
    "package.json"
  ],
  extraResources: [
    {
      from: "build/resources/web",
      to: "web"
    },
    {
      from: "build/resources/backend",
      to: "backend"
    },
    {
      from: "build/resources/runtime-manifest.json",
      to: "runtime-manifest.json"
    }
  ],
  mac: {
    icon: "assets/icon.icns",
    category: "public.app-category.productivity",
    target: [
      {
        target: "dmg",
        arch: ["arm64"]
      },
      {
        target: "zip",
        arch: ["arm64"]
      }
    ],
    artifactName: "SAG-${version}-mac-${arch}.${ext}",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: shouldNotarize
  },
  dmg: {
    sign: false
  },
  win: {
    icon: "assets/icon.ico",
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      }
    ],
    artifactName: "SAG-Setup-${version}-win-${arch}.${ext}"
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "SAG",
    differentialPackage: true,
    deleteAppDataOnUninstall: false
  },
  ...(updateBaseUrl
    ? {
        publish: {
          provider: "generic",
          url: updateBaseUrl
        }
      }
    : {})
};
