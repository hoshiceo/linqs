export const subjects = ["すべて", "AI活用", "Excel VBA"] as const;
export type Subject = (typeof subjects)[number];
export const learningLevels = ["はじめて", "基礎を学習中", "実務に応用"] as const;
export type LearningLevel = (typeof learningLevels)[number];
export type AnswerMode = "explain" | "hint";
export type Message = { id: string; role: "user" | "assistant"; content: string; created_at: string };
export type Conversation = {
  id: string;
  title: string;
  subject: Subject;
  bookmarked: boolean;
  created_at: string;
  updated_at: string;
  messages: Message[];
  persisted?: boolean;
};
export type AppConfig = { mode: "demo" | "live" | "incomplete"; authReady: boolean };
