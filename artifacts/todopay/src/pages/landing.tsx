import { useLocation } from "wouter";
import logo from "@/assets/logo.svg";
import {
  ShieldCheck, Landmark, TrendingUp, Users, ArrowRight,
  Building2, UserCircle2, CheckCircle, Layers, Lock,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function nav(path: string) {
  return `${BASE}${path}`;
}

const FEATURES = [
  {
    icon: <Landmark className="h-6 w-6" />,
    title: "가상계좌 즉시 발급",
    desc: "회원 등록과 동시에 전용 가상계좌가 발급됩니다. 은행별 계좌를 통해 안전하고 빠른 결제를 지원합니다.",
  },
  {
    icon: <TrendingUp className="h-6 w-6" />,
    title: "자동 수수료 배분",
    desc: "구매 확인 즉시 매장 잔액 적립 및 대리점 → 총판 → 본사 계층별 수수료가 자동으로 배분됩니다.",
  },
  {
    icon: <Layers className="h-6 w-6" />,
    title: "5단계 계층 관리",
    desc: "최고관리자 · 본사 · 총판 · 대리점 · 매장의 5단계 계층 구조로 대규모 가맹점도 체계적으로 관리합니다.",
  },
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    title: "출금 승인 워크플로우",
    desc: "출금 신청 후 익일 오전 10시 이후 담당 관리자 승인 처리로 이중 검증을 통한 자금 안전성을 보장합니다.",
  },
  {
    icon: <Users className="h-6 w-6" />,
    title: "회원 셀프 등록",
    desc: "매장 코드 하나로 회원이 직접 가입 및 가상계좌를 발급받을 수 있어 운영 부담을 최소화합니다.",
  },
  {
    icon: <Lock className="h-6 w-6" />,
    title: "OTP 보안 설정",
    desc: "입금·출금 별도 OTP 인증 설정으로 거래 보안을 강화합니다. 매장별 맞춤 보안 정책을 적용하세요.",
  },
];

const FLOW = [
  { step: "01", label: "회원 가입", desc: "매장 코드로 가입 후 가상계좌 발급" },
  { step: "02", label: "구매 입금", desc: "발급된 가상계좌로 구매금액 이체" },
  { step: "03", label: "구매 확인", desc: "매장 관리자가 입금 확인 후 승인" },
  { step: "04", label: "잔액 적립", desc: "수수료 차감 후 매장 잔액 자동 적립" },
  { step: "05", label: "출금 신청", desc: "매장이 적립 잔액 출금 신청" },
  { step: "06", label: "승인 지급", desc: "익일 10시 이후 관리자 승인 완료" },
];

export default function Landing() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0f1e]/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <img src={logo} alt="TodoPay" className="h-8 w-auto brightness-0 invert" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocation(nav("/member/login"))}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors"
            >
              회원 포털
            </button>
            <button
              onClick={() => setLocation(nav("/login"))}
              className="text-xs bg-[#3b82f6] hover:bg-[#2563eb] text-white px-3 py-1.5 rounded-md transition-colors font-medium"
            >
              관리자 로그인
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* 배경 그라디언트 */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a3a] via-[#0a0f1e] to-[#0a0f1e] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#3b82f6]/5 blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-5 pt-24 pb-20 text-center">
          <span className="inline-flex items-center gap-1.5 text-xs text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/20 rounded-full px-3 py-1 mb-6">
            <CheckCircle className="h-3 w-3" />
            가상계좌 기반 구매처리 플랫폼
          </span>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
            소상공인을 위한<br />
            <span className="text-[#3b82f6]">안전한 거래</span>
          </h1>

          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-4 leading-relaxed">
            가상계좌 발급부터 구매 확인, 수수료 자동 배분, 출금 관리까지.<br className="hidden md:block" />
            TodoPay 하나로 소상공인의 모든 거래를 안전하게 처리하세요.
          </p>

          <p className="text-slate-500 text-sm mb-12">
            대리점 · 총판 · 본사 계층 관리 지원 · 실시간 잔액 적립 · OTP 보안 인증
          </p>

          {/* CTA 카드 2개 */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-xl mx-auto">
            {/* 회원용 */}
            <button
              onClick={() => setLocation(nav("/member/login"))}
              className="group flex-1 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 p-6 text-left transition-all hover:border-white/20 hover:scale-[1.02]"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#3b82f6]/15 flex items-center justify-center">
                  <UserCircle2 className="h-5 w-5 text-[#3b82f6]" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-[#3b82f6] group-hover:translate-x-1 transition-all" />
              </div>
              <p className="font-bold text-base mb-1">회원 포털</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                가상계좌 조회 · 구매 신청 · 거래 내역 확인
              </p>
            </button>

            {/* 관리자용 */}
            <button
              onClick={() => setLocation(nav("/login"))}
              className="group flex-1 rounded-2xl border border-[#3b82f6]/30 bg-[#3b82f6]/8 hover:bg-[#3b82f6]/15 p-6 text-left transition-all hover:border-[#3b82f6]/50 hover:scale-[1.02]"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#3b82f6]/20 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-[#3b82f6]" />
                </div>
                <ArrowRight className="h-4 w-4 text-[#3b82f6]/50 group-hover:text-[#3b82f6] group-hover:translate-x-1 transition-all" />
              </div>
              <p className="font-bold text-base mb-1">관리자 포털</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                매장 · 회원 · 거래 · 수수료 · 출금 관리
              </p>
            </button>
          </div>
        </div>
      </section>

      {/* ── 거래 흐름 ── */}
      <section className="border-y border-white/5 bg-white/[0.02] py-16">
        <div className="max-w-6xl mx-auto px-5">
          <h2 className="text-center text-xs text-slate-500 uppercase tracking-widest mb-10">거래 처리 흐름</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {FLOW.map((f, i) => (
              <div key={f.step} className="relative text-center">
                {i < FLOW.length - 1 && (
                  <div className="hidden lg:block absolute top-5 left-[calc(50%+28px)] right-0 h-px bg-gradient-to-r from-[#3b82f6]/30 to-transparent" />
                )}
                <div className="w-10 h-10 rounded-full bg-[#3b82f6]/15 border border-[#3b82f6]/25 flex items-center justify-center mx-auto mb-3">
                  <span className="text-[10px] font-bold text-[#3b82f6]">{f.step}</span>
                </div>
                <p className="text-sm font-semibold mb-1">{f.label}</p>
                <p className="text-[11px] text-slate-500 leading-snug">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 주요 기능 ── */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">TodoPay가 선택받는 이유</h2>
          <p className="text-slate-400 text-sm">복잡한 가맹점 운영을 단순하고 투명하게</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] p-6 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-[#3b82f6]/12 flex items-center justify-center mb-4 text-[#3b82f6]">
                {f.icon}
              </div>
              <p className="font-semibold mb-2">{f.title}</p>
              <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 수치 ── */}
      <section className="border-y border-white/5 bg-white/[0.02] py-14">
        <div className="max-w-4xl mx-auto px-5 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { num: "5단계", label: "계층 관리 구조" },
            { num: "즉시", label: "가상계좌 발급" },
            { num: "익일 10시", label: "출금 처리 기준" },
            { num: "자동", label: "계층별 수수료 배분" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl md:text-3xl font-bold text-[#3b82f6] mb-1">{s.num}</p>
              <p className="text-xs text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 포털 분기 CTA ── */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0d1a3a] to-[#0a0f1e] p-10 md:p-14 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">지금 바로 시작하세요</h2>
          <p className="text-slate-400 text-sm mb-10 max-w-lg mx-auto">
            회원이라면 가상계좌로 간편하게 구매를 진행하고,<br />
            관리자라면 대시보드에서 전체 현황을 한눈에 파악하세요.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-sm mx-auto">
            <button
              onClick={() => setLocation(nav("/member/login"))}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/8 hover:bg-white/15 px-5 py-3.5 font-semibold text-sm transition-all hover:scale-[1.02]"
            >
              <UserCircle2 className="h-4 w-4" />
              회원 포털 입장
            </button>
            <button
              onClick={() => setLocation(nav("/login"))}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] px-5 py-3.5 font-semibold text-sm transition-all hover:scale-[1.02]"
            >
              <Building2 className="h-4 w-4" />
              관리자 로그인
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={logo} alt="TodoPay" className="h-6 w-auto brightness-0 invert opacity-50" />
          <p className="text-xs text-slate-600">© 2025 TodoPay. 소상공인을 위한 안전한 거래 플랫폼.</p>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <button onClick={() => setLocation(nav("/member/login"))} className="hover:text-slate-400 transition-colors">회원 포털</button>
            <button onClick={() => setLocation(nav("/login"))} className="hover:text-slate-400 transition-colors">관리자</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
