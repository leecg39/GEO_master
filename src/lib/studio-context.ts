import { z } from "zod";
import { knowledgeSchema, writingProfileSchema } from "./library";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = { id: id.nullable(), projectId: id, createdAt: z.string(), updatedAt: z.string() };
/** Legacy content accepts arbitrary JSON; recognize only the complete generated snapshot shape. */
export const generationContextSchema = z.object({
  projectId: id,
  writingProfile: z.object({ ...reference, data: writingProfileSchema }).passthrough().nullable(),
  knowledgeDocuments: z.array(z.object({ ...reference, data: knowledgeSchema }).passthrough()),
  facts: z.array(z.object({ ...reference, attribute: z.string(), value: z.string(), verified: z.boolean() }).passthrough()),
  opportunity: z.object({ id: id.nullable(), question: z.string(), kind: z.enum(["competitor_gap", "citation_gap", "unmeasured"]), baselineRunId: id.nullable() }).passthrough().nullable(),
}).passthrough();
