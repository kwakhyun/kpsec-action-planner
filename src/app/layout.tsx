import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-kr";
import "./globals.css";
import "./trading-shell.css";
import "./guided-planning-flow.css";
import "./plan-results.css";
import "./light-theme.css";
import "./planner-refinements.css";
import "./production-ui.css";

export const metadata: Metadata = {
  title: "Action Planner | 매매 실행 의사결정 동반자",
  description:
    "공개 시장 데이터와 내가 정한 조건을 바탕으로 일괄안과 분할안을 비교하는 매매 실행 의사결정 데모입니다. 실제 주문은 제공하지 않습니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
