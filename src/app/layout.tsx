import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linqs | AI・VBAの学習パートナー",
  description: "職業訓練校のAI活用・Excel VBA学習を支える質問チャット。基礎から実務まで、ヒントと段階的な解説でサポートします。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
