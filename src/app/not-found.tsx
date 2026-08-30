import { AppErrorState } from "@/components/app-error-state";

export default function NotFound() {
  return (
    <AppErrorState
      eyebrow="404 · Page not found"
      title="요청한 화면을 찾지 못했어요"
      description="주소가 바뀌었거나 존재하지 않는 경로입니다. 종목 화면으로 돌아가 현재 데이터와 실행 계획을 다시 확인해 주세요."
      reference="입력한 주소를 다시 확인해 주세요."
    />
  );
}
