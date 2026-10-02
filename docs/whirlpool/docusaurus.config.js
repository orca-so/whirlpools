import { themes } from "prism-react-renderer";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

export default {
  title: "Whirlpools",
  tagline: "Open source concentrated liquidity AMM contract on Solana",
  favicon: "https://orca.so/favicon.ico",

  url: "https://orca-so.github.io",
  baseUrl: "/whirlpools/",

  organizationName: "orca-so",
  projectName: "whirlpools",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  staticDirectories: ["static", "../ts/dist", "../legacy/dist", "../rust/dist"],

  presets: [
    [
      "@docusaurus/preset-classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: false,
          editUrl:
            "https://github.com/orca-so/whirlpools/tree/main/docs/whirlpool",
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        theme: {
          customCss: "./static/index.css",
        },
      },
    ],
  ],

  stylesheets: [
    {
      href: "https://cdn.jsdelivr.net/npm/katex@0.13.24/dist/katex.min.css",
      type: "text/css",
      integrity:
        "sha384-odtC+0UGzzFL/6PNoE8rX/SPcQDXBJ+uRepguP4QkPCm2LBxH3FA3y+fKSiJ+AmM",
      crossorigin: "anonymous",
    },
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
