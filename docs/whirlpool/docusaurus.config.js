import { themes } from "prism-react-renderer";

export default {
  title: "Whirlpools",
  tagline: "Open source concentrated liquidity AMM contract on Solana",
  favicon: "https://orca.so/favicon.ico",

  url: "https://orca-so.github.io/",
  baseUrl: "/whirlpools",

  organizationName: "orca-so",
  projectName: "whirlpools",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    format: "md",
  },

  staticDirectories: ["static", "../ts/dist", "../legacy/dist", "../rust/dist"],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/orca-so/whirlpools/tree/main/docs/whirlpool",
        },
        theme: {
          customCss: "./static/index.css",
        },
      },
    ],
  ],

  themeConfig: {
    image: "img/docusaurus-social-card.jpg",
    navbar: {
      title: "Whirlpools",
      logo: {
        alt: "Orca Logo",
        src: "https://orca.so/android-chrome-192x192.png",
      },
      items: [
        { to: "/", label: "Docs", position: "left" },
        {
          href: "/orca_whirlpools/",
          label: "Rust SDK Reference",
          position: "left",
          target: "_blank",
        },
        {
          href: "/ts/",
          label: "TS SDK Reference",
          position: "left",
          target: "_blank",
        },
        {
          href: "/legacy/",
          label: "Legacy SDK Reference",
          position: "left",
          target: "_blank",
        },
        {
          href: "https://github.com/orca-so/whirlpools",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
    },
  },
};
