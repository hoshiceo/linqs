// Course textbook assignments are validated on the server. Both courses use the shared class account.
export const courses = [
  {
    id: "website-production",
    name: "Webサイト制作実践科",
    textbookFilenames: ["GIMP.pdf", "PHP.pdf", "Web応用.pdf", "Webdesighn.docx", "web基礎.pdf"],
    suggestions: [
      { title: "HTMLとCSSの役割の違いは？", prompt: "Webサイト制作で、HTMLとCSSの役割の違いを具体例で教えてください。" },
      { title: "スマートフォンでも見やすくするには？", prompt: "Webサイトをスマートフォンでも見やすくするレスポンシブデザインの基本を教えてください。" },
      { title: "CSSが反映されないときは？", prompt: "WebページにCSSが反映されません。どこから確認すればよいですか？" },
    ],
  },
  {
    id: "pc-ai-skills",
    name: "パソコン・AIスキルアップ科",
    textbookFilenames: ["AI.pdf", "Word&Excel.pdf", "Excel＿VBA.pdf", "表計算応用.pdf", "表計算活用.pdf", "PowerPoint.pdf", "ワープロ活用.pdf", "Excel応用別冊.pdf", "ワープロ応用.pdf"],
    suggestions: [
      { title: "ExcelのIF関数を使うには？", prompt: "ExcelのIF関数の使い方を、仕事で使う架空の表の例で教えてください。" },
      { title: "業務メールの下書きをAIで作るには？", prompt: "AIで業務メールの下書きを作るプロンプトの書き方を教えてください。" },
      { title: "VBAで繰り返し作業を自動化するには？", prompt: "Excel VBAで繰り返し作業を自動化する基本を、短いコードの例で教えてください。" },
    ],
  },
] as const;

export type CourseId = (typeof courses)[number]["id"];

export const courseIds = ["website-production", "pc-ai-skills"] as const satisfies readonly CourseId[];
export const getCourse = (id: string | null | undefined) => courses.find(course => course.id === id);
