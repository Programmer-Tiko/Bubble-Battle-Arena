/** Selectable cosmetic identities. Use null when no appearance is selected. */
export const APPEARANCE_IDS = ["basketball-star"] as const;
export type AppearanceId = typeof APPEARANCE_IDS[number];

/** Keep this allowlist at the server boundary; never trust an arbitrary texture key. */
export function isCharacterAppearance(value: unknown): value is AppearanceId {
  return typeof value === "string" && APPEARANCE_IDS.some(id => id === value);
}
