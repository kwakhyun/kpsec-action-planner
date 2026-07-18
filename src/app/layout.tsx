import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "카카오페이증권 데모 | 가이드형 매매 동반자",
  description:
    "Yahoo Finance 공개 데이터와 후회 예산을 바탕으로 일괄안과 분할안을 비교하는 해커톤 데모입니다. 실제 주문은 제공하지 않습니다.",
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
