// The public API of @jeopardy/protocol in one readable file (M1 owner resolution R1: an
// EXPLICIT named-export barrel - never `export *` - so what we promise consumers is exactly
// this list and nothing leaks by accident). This is the repo's one sanctioned barrel,
// exposed as the package root "." export; the M0 subpath exports (envelope/ext/limits)
// remain for the wire-only consumers that predate it.
//
// Deliberately NOT exported: settings/docs-table.ts and migrations/fixture-gate.ts (test and
// generator support), migrations/example/* (the synthetic machinery-proof format).

// ids
export { generateId, idSchema } from "./ids.ts";
export type { Id } from "./ids.ts";

// ext bag + operational limits
export { extensionBagSchema, extensionKeyPattern } from "./ext.ts";
export type { ExtensionBag } from "./ext.ts";
export { limits } from "./limits.ts";
export type { Limits } from "./limits.ts";

// wire envelope (WebSocket)
export { envelopeSchema, parseEnvelope, protocolVersion } from "./envelope/wire.ts";
export type { Envelope, EnvelopeParseResult } from "./envelope/wire.ts";

// document envelope + migration machinery
export { documentMetaSchema, documentSchema, semverSchema } from "./envelope/document.ts";
export type { DocumentMeta, Semver } from "./envelope/document.ts";
export { createDocumentRegistry, parseDocument } from "./envelope/migration.ts";
export type {
  DocumentFormatDefinition,
  DocumentParseResult,
  DocumentRegistry,
  Migration,
} from "./envelope/migration.ts";

// content layer
export { mediaAssetSchema, mediaRefSchema, mediaStorageSchema } from "./content/media-ref.ts";
export type { MediaAsset, MediaRef } from "./content/media-ref.ts";
export { contentItemSchema, contentItemTypeSchema, tagSchema } from "./content/content-item.ts";
export type { ContentItem, ContentItemType, Tag } from "./content/content-item.ts";
export {
  contentPackBodySchema,
  contentPackSchema,
  contentPackSchemaVersion,
} from "./content/content-pack.ts";
export type { ContentPack, ContentPackBody } from "./content/content-pack.ts";

// settings registry + derivations + presets
export { defineSetting, defineSettingsGroup } from "./settings/definition.ts";
export type {
  GroupRefinement,
  GroupValue,
  SettingDefinition,
  SettingsGroup,
  SettingsMap,
} from "./settings/definition.ts";
export { settingsGroups } from "./settings/registry.ts";
export {
  defaultSettings,
  resolveSettings,
  settingsOverridesSchema,
  settingsSchema,
} from "./settings/derive.ts";
export type { Settings, SettingsOverrides } from "./settings/derive.ts";
export { describeSettingsRegistry } from "./settings/describe.ts";
export type { GroupDescription, SettingDescription } from "./settings/describe.ts";
export { resolvePreset, settingsPresetIdSchema, settingsPresets } from "./settings/presets.ts";
export type { SettingsPresetId } from "./settings/presets.ts";

// rule-set document
export {
  resolveRuleSet,
  ruleSetBodySchema,
  ruleSetSchema,
  ruleSetSchemaVersion,
} from "./settings/rule-set.ts";
export type { RuleSet, RuleSetBody } from "./settings/rule-set.ts";

// theme document
export { fontFaceSchema, fontSlotsSchema } from "./theme/fonts.ts";
export type { FontFace, FontSlots } from "./theme/fonts.ts";
export { colorSchema, fillSchema, themeTokensSchema } from "./theme/tokens.ts";
export type { Color, Fill, ThemeTokens } from "./theme/tokens.ts";
export { themeBackgroundSchema } from "./theme/background.ts";
export type { ThemeBackground } from "./theme/background.ts";
export {
  themeBodySchema,
  themePresetIdSchema,
  themeSchema,
  themeSchemaVersion,
} from "./theme/theme.ts";
export type { Theme, ThemeBody, ThemePresetId } from "./theme/theme.ts";

// jeopardy mode layer
export { cellSchema } from "./modes/jeopardy/cells.ts";
export type { Cell } from "./modes/jeopardy/cells.ts";
export { categorySchema, roundSchema } from "./modes/jeopardy/board.ts";
export type { Category, Round } from "./modes/jeopardy/board.ts";
export {
  presetRowValues,
  valueSchemePresetIdSchema,
  valueSchemeSchema,
} from "./modes/jeopardy/value-schemes.ts";
export type { ValueScheme, ValueSchemePresetId } from "./modes/jeopardy/value-schemes.ts";
export {
  gameContentSchema,
  gameDefinitionBodySchema,
  gameDefinitionSchema,
  gameDefinitionSchemaVersion,
  gameRulesSchema,
  gameThemeSchema,
  resolveGameRules,
} from "./modes/jeopardy/game-definition.ts";
export type { GameDefinition, GameDefinitionBody } from "./modes/jeopardy/game-definition.ts";

// the assembled registry - the one entry point for opening any portable document
export { documentRegistry, parsePortableDocument } from "./migrations/registry.ts";
export type { PortableDocument, PortableDocumentParseResult } from "./migrations/registry.ts";
