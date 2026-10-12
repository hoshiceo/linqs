import { z } from "zod";
import { subjects } from "./types";

export const chatSchema = z.object({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(3000),
  subject: z.enum(subjects).default("すべて"),
  mode: z.enum(["explain", "hint"]),
});

export const conversationIdSchema = z.uuid();
