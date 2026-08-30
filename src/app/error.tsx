"use client";

import { useEffect } from "react";

import { AppErrorState } from "@/components/app-error-state";

export default function ErrorPage({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    console.error("[app-error] route rendering failed", error);
  }, [error]);

  return (
    <AppErrorState
      eyebrow="Temporary issue"
      title="화면을 안전하게 불러오지 못했어요"
      description="입력한 내용은 자동으로 주문에 사용되지 않습니다. 다시 시도하거나 종목 화면으로 돌아가 계획을 새로 확인해 주세요."
      reference={error.digest ? `오류 참조 코드 ${error.digest}` : "오류가 반복되면 잠시 후 다시 접속해 주세요."}
      retry={retry}
    />
  );
}
