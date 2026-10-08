import { z } from "zod";
import { learningLevels, subjects } from "./types";

export const chatSchema = z.object({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(3000),
  subject: z.enum(subjects).default("すべて"),
  level: z.enum(learningLevels),
  mode: z.enum(["explain", "hint"]),
});

export const conversationPatchSchema = z.object({
  id: z.uuid(),
  bookmarked: z.boolean(),
});
