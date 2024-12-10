import typescript from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "**/dist",
      "**/node_modules",
      "**/.yarn",
      "**/target",
      "**/.nx",
      "**/.anchor",
      "**/artifacts",
      "**/generated",
      "**/.docusaurus",
      "**/.next",
    ],
  },
  {
    files: ["**/*.ts", "**/*.js"],
    plugins: {
      "@typescript-eslint": typescript,
    },
    languageOptions: {
      parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      ...typescript.configs["recommended"].rules,

      "no-console": [
        "error",
        {
          allow: ["warn", "error", "info", "debug"],
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-exports": "error",
    },
  },
];
