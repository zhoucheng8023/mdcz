import { z } from "zod";

export const publicationConflictChoiceSchema = z.enum(["keep_both", "keep_new", "keep_existing"]);
export type PublicationConflictChoice = z.infer<typeof publicationConflictChoiceSchema>;
export const publicationConflictResolutionSchema = z.object({
  id: z.string().min(1),
  choice: publicationConflictChoiceSchema,
});
export type PublicationConflictResolution = z.infer<typeof publicationConflictResolutionSchema>;
export interface PublicationConflictSnapshot {
  id: string;
  operationId: string;
  taskId: string;
  itemId: string;
  sourcePath: string | null;
  targetPath: string;
  sourceSize: number;
  targetSize: number;
  sourceModifiedAt: number | null;
  targetModifiedAt: number;
  keepBothPath: string;
}
