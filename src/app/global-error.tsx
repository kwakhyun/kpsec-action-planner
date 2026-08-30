"use client";

import { useEffect } from "react";

import {
  AppErrorState,
  appErrorStateStyles,
} from "@/components/app-error-state";

export default function GlobalError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    console.error("[global-error] application rendering failed", error);
  }, [error]);

  return (
    <html lang="ko">
      <body className={appErrorStateStyles.rootBody}>
        <AppErrorState
          eyebrow="Service recovery"
          title="서비스 화면을 복구하고 있어요"
          description="현재 요청은 처리되지 않았고 실제 주문도 전송되지 않았습니다. 다시 시도해도 해결되지 않으면 잠시 후 접속해 주세요."
          reference={error.digest ? `오류 참조 코드 ${error.digest}` : "Action Planner 안전 복구 화면"}
          retry={retry}
        />
      </body>
    </html>
  );
}
