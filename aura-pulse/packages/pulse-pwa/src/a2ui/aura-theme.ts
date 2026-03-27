// Aura theme for A2UI surfaces.
// Passed to <A2UIViewer theme={auraTheme}>.
//
// Theme interface from @a2ui/react:
//   components[ComponentName].all  → ClassMap (always applied)
//   components[ComponentName][variant] → ClassMap (variant-specific)

import { litTheme } from "@a2ui/react";
import type { Theme } from "@a2ui/react";

export const auraTheme: Theme = {
  ...litTheme,
  components: {
    ...litTheme.components,
    Button: { ...litTheme.components.Button, "aura-btn": true },
    Text: {
      ...litTheme.components.Text,
      all: { ...litTheme.components.Text.all, "aura-text": true },
    },
    Card: { ...litTheme.components.Card, "aura-card": true },
  },
};
