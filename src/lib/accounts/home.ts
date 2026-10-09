import type { AccountRole } from "@/lib/account-policy";
import { getSemforgeSubscription } from "@/lib/semforge-subscription";
import { SEMFORGE_HUB_PATH } from "@/lib/semforge/navigation";
import { findAccount } from "./store";

/** GEO 쪽 SEMForge Pro 구독(결제) 화면 */
export const SUBSCRIPTION_PATH = "/subscription";

/**
 * 로그인 직후 기본 화면. 무료 회원과 운영 계정은 GEO 대시보드로 간다.
 * SEMForge Pro로 가입한 회원은 결제 전이면 구독 화면, 결제가 확인되면 SEMForge 워크스페이스로 간다.
 */
export function accountHomePath(user: string, role: AccountRole): string {
  if (role !== "customer" || findAccount(user)?.plan !== "semforge") return "/";
  return getSemforgeSubscription({ id: user, role }).active ? SEMFORGE_HUB_PATH : SUBSCRIPTION_PATH;
}
