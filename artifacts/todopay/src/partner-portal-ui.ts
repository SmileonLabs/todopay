export function formatMoney(value: number | null | undefined) {
  if (value == null) return "미설정";
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

export function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    draft: "초안",
    integration_pending: "연동 설정 필요",
    test_ready: "테스트 가능",
    live: "운영 가능",
    suspended: "정지",
    terminated: "종료",
    pending: "확인 대기",
    active: "활성",
  };
  return labels[stage] ?? stage;
}

export function statusVariant(
  stage: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (stage === "live" || stage === "active") return "default";
  if (stage === "suspended" || stage === "terminated") return "destructive";
  if (["draft", "integration_pending", "pending"].includes(stage))
    return "secondary";
  return "outline";
}

export function isoLabel(value?: string) {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}
export const API_BASE_URL = "https://api.todopay.io/api/external/v1";
