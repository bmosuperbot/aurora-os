import globals from "globals";
import pluginJs from "@eslint/js";
import reactHooksPlugin from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { files: ["src/**/*.{ts,tsx}"] },
  { languageOptions: { globals: { ...globals.browser } } },
  pluginJs.configs.recommended,
  {
    plugins: { "react-hooks": reactHooksPlugin },
    rules: reactHooksPlugin.configs.recommended.rules
  }
];
