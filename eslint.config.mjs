import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The lesson text editor's own files: the only ones that may import Tiptap
// (see the rule below).
const RICH_TEXT_EDITOR_FILES = [
  "src/components/rich-text/RichTextEditor.tsx",
  "src/components/rich-text/editor-extensions.ts",
  "src/components/rich-text/indent-extension.ts",
  "src/components/rich-text/editor-schema.test.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Tiptap (about 100 KB) is authoring-only. Learner pages are client
    // components too (CoursePlayer, NarrativeStage), so one stray import
    // would ship it to every learner: everything else loads the editor
    // through LazyRichTextEditor's dynamic import (D36).
    files: ["src/**/*.{ts,tsx}"],
    ignores: RICH_TEXT_EDITOR_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tiptap/*"],
              message:
                "Tiptap is authoring-only — import it via LazyRichTextEditor.",
            },
            {
              group: [
                "**/rich-text/RichTextEditor",
                "**/rich-text/editor-extensions",
                "**/rich-text/indent-extension",
                "./RichTextEditor",
                "./editor-extensions",
                "./indent-extension",
              ],
              allowTypeImports: true,
              message:
                "This imports Tiptap — load the editor via LazyRichTextEditor.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Strapi CMS is a separate app with its own linting — not part of
    // the web app's lint scope.
    "cms/**",
  ]),
]);

export default eslintConfig;
