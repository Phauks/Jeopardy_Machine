// Test-only document format proving the migration machinery end to end with committed
// fixtures (see 1.0-to-1.1.ts for why it exists and why it is never in the real registry).
import { z } from "zod";
import { documentSchema } from "../../envelope/document.ts";
import { createDocumentRegistry } from "../../envelope/migration.ts";
import type { DocumentFormatDefinition } from "../../envelope/migration.ts";
import { exampleRenameMigration } from "./1.0-to-1.1.ts";

export const exampleBodySchema = z.strictObject({
  greeting: z.string(),
  excited: z.boolean().default(false),
});

export const exampleSchema = documentSchema("example", exampleBodySchema);
export const exampleSchemaVersion = "1.1.0";

export const exampleFormatDefinition: DocumentFormatDefinition = {
  format: "example",
  currentVersion: exampleSchemaVersion,
  schema: exampleSchema,
  migrations: [exampleRenameMigration],
};

export const exampleRegistry = createDocumentRegistry([exampleFormatDefinition]);
