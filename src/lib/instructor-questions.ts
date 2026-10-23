import { z } from "zod";

export const instructorQuestionSchema = z.object({
  conversationId: z.uuid(),
  messageIndex: z.number().int().min(0).max(10000),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  question: z.string().trim().min(1).max(2000),
});

export type InstructorQuestion = {
  id: string;
  course_id: string | null;
  conversation_title: string;
  original_question: string;
  ai_answer: string;
  question: string;
  reply: string | null;
  created_at: string;
  replied_at: string | null;
};
