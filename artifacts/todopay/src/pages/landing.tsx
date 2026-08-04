import { useLocation } from "wouter";
import { BrandWordmark } from "@/components/brand-wordmark";
import {
  ShieldCheck, Landmark, TrendingUp, Users, ArrowRight,
  Building2, UserCircle2, CheckCircle, Layers, Lock,
  BadgeCheck, BarChart3, CreditCard, ArrowUpRight, Wallet,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
function nav(path: string) { return `${BASE}${path}`; }

/* ── 인라인 SVG 디자인 요소 ────────────────────────────────── */

/** 대시보드 UI 목업 */
function DashboardMockup() {
  return (
    <div className="relative w-full max-w-[520px] mx-auto select-none">
      {/* 글로우 */}
      <div className="absolute -inset-8 bg-[#3b82f6]/10 rounded-full blur-3xl" />

      {/* 메인 카드 */}
      <div className="relative rounded-2xl border border-white/10 bg-[#0d1628]/90 backdrop-blur overflow-hidden shadow-2xl shadow-black/40">
        {/* 상단 바 */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8 bg-white/[0.02]">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
          <span className="ml-3 text-[10px] text-slate-500 font-mono">todopay.admin / 대시보드</span>
        </div>

        {/* 통계 카드 4개 */}
        <div className="grid grid-cols-2 gap-2 p-4">
          {[
            { label: "오늘 구매확인", val: "₩ 4,280,000", color: "text-emerald-400", up: "+12%" },
            { label: "대기 출금", val: "₩ 1,150,000", color: "text-amber-400", up: "3건" },
            { label: "총 회원수", val: "1,247 명", color: "text-sky-400", up: "+8" },
            { label: "이번달 수수료", val: "₩ 892,300", color: "text-violet-400", up: "+3.2%" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
              <p className="text-[9px] text-slate-500 mb-1">{s.label}</p>
              <p className={`text-sm font-bold ${s.color}`}>{s.val}</p>
              <p className="text-[9px] text-slate-600 mt-0.5">{s.up}</p>
            </div>
          ))}
        </div>

        {/* 차트 영역 */}
        <div className="px-4 pb-2">
          <div className="rounded-xl bg-white/[0.03] border border-white/6 p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-slate-400 font-medium">주간 거래 현황</span>
              <span className="text-[9px] text-[#3b82f6]">7일</span>
            </div>
            {/* 바 차트 */}
            <div className="flex items-end gap-1.5 h-16">
              {[40, 65, 48, 80, 55, 90, 72].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: `${h}%`,
                      background: i === 5
                        ? "linear-gradient(to top, #3b82f6, #60a5fa)"
                        : "rgba(59,130,246,0.25)",
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1">
              {["월","화","수","목","금","토","일"].map(d => (
                <span key={d} className="flex-1 text-center text-[8px] text-slate-600">{d}</span>
              ))}
            </div>
          </div>
        </div>

        {/* 최근 거래 목록 */}
        <div className="px-4 pb-4">
          <p className="text-[9px] text-slate-500 mb-2 mt-1">최근 구매 확인</p>
          <div className="space-y-1.5">
            {[
              { name: "김*희", amt: "280,000", bank: "국민은행", status: "완료", color: "text-emerald-400" },
              { name: "이*준", amt: "150,000", bank: "신한은행", status: "대기", color: "text-amber-400" },
              { name: "박*연", amt: "420,000", bank: "카카오뱅크", status: "완료", color: "text-emerald-400" },
            ].map((t) => (
              <div key={t.name} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <div className="w-5 h-5 rounded-full bg-[#3b82f6]/20 flex items-center justify-center shrink-0">
                  <span className="text-[7px] text-[#3b82f6] font-bold">{t.name[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-white font-medium">{t.name} · {t.bank}</p>
                </div>
                <span className="text-[9px] font-mono text-slate-300">₩{t.amt}</span>
                <span className={`text-[8px] font-medium ${t.color}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 플로팅 카드 — 잔액 */}
      <div className="absolute -bottom-4 -left-6 rounded-xl border border-white/12 bg-[#1a2744]/95 backdrop-blur px-4 py-3 shadow-xl shadow-black/30">
        <div className="flex items-center gap-2 mb-1">
          <Wallet className="h-3 w-3 text-[#3b82f6]" />
          <span className="text-[9px] text-slate-400">매장 잔액</span>
        </div>
        <p className="text-base font-bold text-white">₩ 2,340,500</p>
        <p className="text-[8px] text-emerald-400 mt-0.5">↑ 오늘 +₩280,000 적립</p>
      </div>

      {/* 플로팅 카드 — 보안 */}
      <div className="absolute -top-3 -right-4 rounded-xl border border-emerald-500/20 bg-[#0d2018]/95 backdrop-blur px-3 py-2.5 shadow-xl shadow-black/30">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[9px] text-emerald-400 font-medium">보안 인증</span>
        </div>
        <p className="text-[8px] text-slate-500 mt-0.5">OTP 이중 검증 활성</p>
      </div>
    </div>
  );
}

/** 가상계좌 카드 목업 */
function VirtualAccountCard() {
  return (
    <div className="relative rounded-2xl border border-[#3b82f6]/25 overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0d1a3a 0%, #1a2d5a 50%, #0d1a3a 100%)" }}
    >
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-[#3b82f6]/10 blur-2xl" />
      <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-[#1d4ed8]/10 blur-2xl" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-6">
          <span className="text-[10px] text-[#3b82f6] font-medium tracking-widest uppercase">Virtual Account</span>
          <Landmark className="h-4 w-4 text-[#3b82f6]/60" />
        </div>
        <p className="text-xl font-bold font-mono tracking-wider text-white mb-1">3762 - 8821 - 4490</p>
        <p className="text-xs text-slate-400 mb-4">국민은행</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] text-slate-500">예금주</p>
            <p className="text-xs font-medium text-slate-200">홍*동 (구매자)</p>
          </div>
          <div className="flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 rounded-full px-2.5 py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] text-emerald-400 font-medium">활성</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 데이터 ──────────────────────────────────────────────── */
const FEATURES = [
  { icon: <Landmark className="h-5 w-5" />, title: "가상계좌 즉시 발급", desc: "회원 등록 즉시 전용 가상계좌가 자동 발급됩니다. 주요 시중은행 지원." },
  { icon: <TrendingUp className="h-5 w-5" />, title: "자동 수수료 배분", desc: "구매 확인 즉시 대리점 → 총판 → 본사 수수료가 자동 계산·배분됩니다." },
  { icon: <Layers className="h-5 w-5" />, title: "5단계 계층 관리", desc: "본사·총판·대리점·매장 계층으로 대규모 가맹점도 체계적으로 관리합니다." },
  { icon: <ShieldCheck className="h-5 w-5" />, title: "출금 승인 워크플로우", desc: "익일 10시 이후 이중 검증 출금 승인으로 자금 안전성을 철저히 보장합니다." },
  { icon: <Users className="h-5 w-5" />, title: "회원 셀프 등록", desc: "매장 코드 하나로 회원이 직접 가입, 가상계좌를 발급받아 운영 부담을 줄입니다." },
  { icon: <Lock className="h-5 w-5" />, title: "OTP 보안 인증", desc: "입금·출금 개별 OTP 설정으로 모든 거래에 이중 보안을 적용하세요." },
];

const FLOW = [
  { step: "01", label: "회원 가입", desc: "매장 코드로 가입 후\n가상계좌 즉시 발급", icon: <UserCircle2 className="h-5 w-5" /> },
  { step: "02", label: "구매 입금", desc: "발급된 가상계좌로\n구매금액 이체", icon: <CreditCard className="h-5 w-5" /> },
  { step: "03", label: "구매 확인", desc: "매장 관리자가\n입금 확인 후 승인", icon: <CheckCircle className="h-5 w-5" /> },
  { step: "04", label: "잔액 적립", desc: "수수료 차감 후\n매장 잔액 자동 적립", icon: <Wallet className="h-5 w-5" /> },
  { step: "05", label: "출금 신청", desc: "매장이 적립 잔액\n출금 신청", icon: <BarChart3 className="h-5 w-5" /> },
  { step: "06", label: "승인 지급", desc: "익일 10시 이후\n관리자 승인 완료", icon: <BadgeCheck className="h-5 w-5" /> },
];

const BANKS = ["국민은행", "신한은행", "우리은행", "하나은행", "기업은행", "농협은행", "카카오뱅크", "토스뱅크"];

/* ── 컴포넌트 ────────────────────────────────────────────── */
export default function Landing() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#060d1a] text-white overflow-x-hidden">

      {/* ══ 헤더 ══════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#060d1a]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="text-white">
            <BrandWordmark className="h-auto w-56" />
          </div>
          <nav className="flex items-center gap-2">
            <button
              onClick={() => setLocation(nav("/member/login"))}
              className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              회원 포털
            </button>
            <button
              onClick={() => setLocation(nav("/login"))}
              className="text-sm bg-[#3b82f6] hover:bg-[#2563eb] text-white px-4 py-2 rounded-lg transition-colors font-semibold shadow-lg shadow-[#3b82f6]/25"
            >
              관리자 로그인
            </button>
          </nav>
        </div>
      </header>

      {/* ══ 히어로 ════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        {/* 배경 노이즈 텍스처 효과 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-[#1d4ed8]/20 blur-[100px]" />
          <div className="absolute top-20 right-1/4 w-80 h-80 rounded-full bg-[#7c3aed]/10 blur-[100px]" />
          <div className="absolute bottom-0 left-1/2 w-96 h-64 rounded-full bg-[#0369a1]/15 blur-[80px]" />
          {/* 그리드 패턴 */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* 좌측 텍스트 */}
            <div>
              <div className="inline-flex items-center gap-2 text-xs text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/20 rounded-full px-4 py-1.5 mb-8">
                <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
                가상계좌 기반 구매처리 플랫폼
              </div>

              {/* 로고 대형 */}
              <div className="mb-6">
                <div className="mb-4 text-white">
                  <BrandWordmark className="h-auto w-64" />
                </div>
                <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                  소상공인을 위한<br />
                  <span className="bg-gradient-to-r from-[#3b82f6] to-[#60a5fa] bg-clip-text text-transparent">
                    안전한 거래
                  </span>
                </h1>
              </div>

              <p className="text-slate-300 text-lg leading-relaxed mb-8 max-w-lg">
                가상계좌 발급부터 구매 확인, 수수료 자동 배분, 출금 관리까지.
                TodoPay 하나로 소상공인의 모든 거래를 안전하게 처리하세요.
              </p>

              {/* 신뢰 지표 */}
              <div className="flex flex-wrap gap-3 mb-10">
                {[
                  { icon: <ShieldCheck className="h-3.5 w-3.5" />, text: "OTP 이중 보안" },
                  { icon: <BadgeCheck className="h-3.5 w-3.5" />, text: "자동 수수료 배분" },
                  { icon: <Lock className="h-3.5 w-3.5" />, text: "출금 이중 검증" },
                ].map((b) => (
                  <span key={b.text} className="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                    <span className="text-emerald-400">{b.icon}</span>
                    {b.text}
                  </span>
                ))}
              </div>

              {/* CTA 버튼 2개 */}
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => setLocation(nav("/member/login"))}
                  className="group flex items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/8 hover:bg-white/14 px-7 py-4 font-semibold transition-all hover:scale-[1.02] hover:border-white/25"
                >
                  <UserCircle2 className="h-5 w-5 text-slate-300" />
                  <span>회원 포털 입장</span>
                  <ArrowRight className="h-4 w-4 text-slate-500 group-hover:translate-x-0.5 transition-transform" />
                </button>
                <button
                  onClick={() => setLocation(nav("/login"))}
                  className="group flex items-center justify-center gap-2.5 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] px-7 py-4 font-semibold transition-all hover:scale-[1.02] shadow-xl shadow-[#3b82f6]/30"
                >
                  <Building2 className="h-5 w-5" />
                  <span>관리자 로그인</span>
                  <ArrowUpRight className="h-4 w-4 opacity-70 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </button>
              </div>
            </div>

            {/* 우측 — 대시보드 목업 */}
            <div className="hidden lg:block">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ══ 은행 파트너 배너 ════════════════════════════════ */}
      <div className="border-y border-white/5 bg-white/[0.015] py-5 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-4 md:gap-8 flex-wrap justify-center">
            <span className="text-[10px] text-slate-600 uppercase tracking-widest whitespace-nowrap">지원 은행</span>
            {BANKS.map((b) => (
              <span key={b} className="text-xs text-slate-500 font-medium px-3 py-1 rounded-full border border-white/6 bg-white/[0.02] whitespace-nowrap hover:text-slate-300 hover:border-white/12 transition-colors">
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 가상계좌 카드 + 특징 ═══════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-[11px] text-[#3b82f6] uppercase tracking-widest mb-4">가상계좌 발급</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
              회원 등록 즉시<br />전용 계좌가 생성됩니다
            </h2>
            <p className="text-slate-400 text-base leading-relaxed mb-8">
              복잡한 계좌 신청 없이 매장 코드 하나로 가입하면
              즉시 전용 가상계좌가 발급됩니다. 회원은 발급된 계좌로
              구매금액을 이체하고, 매장은 입금을 확인·승인합니다.
            </p>
            <ul className="space-y-3">
              {[
                "8개 주요 시중은행 가상계좌 지원",
                "계좌번호 자동 생성 및 즉시 발급",
                "계좌 폐기 및 재발급 관리 기능",
                "중복 계좌 자동 방지 처리",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3 text-sm text-slate-300">
                  <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="max-w-sm mx-auto lg:mx-0 lg:ml-auto w-full">
            <VirtualAccountCard />
            {/* 화살표 + 설명 */}
            <div className="mt-4 flex items-start gap-3 bg-white/[0.03] border border-white/8 rounded-xl p-4">
              <div className="w-8 h-8 rounded-full bg-[#3b82f6]/15 flex items-center justify-center shrink-0 mt-0.5">
                <TrendingUp className="h-4 w-4 text-[#3b82f6]" />
              </div>
              <div>
                <p className="text-sm font-semibold mb-0.5">구매 확인 즉시 잔액 적립</p>
                <p className="text-xs text-slate-500">관리자가 구매 확인 시 수수료를 제외한 순 금액이 매장 잔액에 자동 적립됩니다.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 거래 흐름 ══════════════════════════════════════ */}
      <section className="border-y border-white/5 bg-white/[0.02] py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[11px] text-[#3b82f6] uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-2xl md:text-3xl font-bold">6단계 거래 처리 흐름</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {FLOW.map((f, i) => (
              <div key={f.step} className="relative">
                {i < FLOW.length - 1 && (
                  <div className="hidden lg:block absolute top-[22px] left-[calc(50%+26px)] right-[-4px] h-px bg-gradient-to-r from-[#3b82f6]/40 to-[#3b82f6]/10" />
                )}
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] transition-colors p-4 text-center">
                  <div className="w-11 h-11 rounded-full bg-[#3b82f6]/12 border border-[#3b82f6]/20 flex items-center justify-center mx-auto mb-3 text-[#3b82f6]">
                    {f.icon}
                  </div>
                  <p className="text-[9px] text-[#3b82f6] font-bold mb-1">{f.step}</p>
                  <p className="text-sm font-bold mb-1.5">{f.label}</p>
                  <p className="text-[10px] text-slate-500 leading-snug whitespace-pre-line">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 주요 기능 ══════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <p className="text-[11px] text-[#3b82f6] uppercase tracking-widest mb-3">Features</p>
          <h2 className="text-2xl md:text-3xl font-bold mb-3">TodoPay가 선택받는 이유</h2>
          <p className="text-slate-400 text-sm">복잡한 가맹점 운영을 단순하고 투명하게</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-white/8 bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/14 p-6 transition-all"
              style={i === 0 ? { background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(255,255,255,0.025) 100%)", borderColor: "rgba(59,130,246,0.2)" } : {}}
            >
              <div className="w-12 h-12 rounded-2xl bg-[#3b82f6]/10 border border-[#3b82f6]/15 flex items-center justify-center mb-5 text-[#3b82f6] group-hover:bg-[#3b82f6]/18 transition-colors">
                {f.icon}
              </div>
              <p className="font-bold mb-2">{f.title}</p>
              <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ 수치 배너 ══════════════════════════════════════ */}
      <section className="border-y border-white/5 bg-gradient-to-r from-[#0d1a3a]/80 via-[#0a0f1e] to-[#0d1a3a]/80 py-16">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-10 text-center">
          {[
            { num: "5단계", sub: "계층 관리 구조", desc: "슈퍼관리자·본사·총판·대리점·매장" },
            { num: "8개+", sub: "지원 은행", desc: "국민·신한·우리·하나·카카오 등" },
            { num: "익일 10시", sub: "출금 처리 기준", desc: "KST 기준 익일 오전 승인" },
            { num: "100%", sub: "자동 수수료 배분", desc: "계층별 마진 실시간 정산" },
          ].map((s) => (
            <div key={s.sub}>
              <p className="text-3xl md:text-4xl font-bold text-[#3b82f6] mb-1">{s.num}</p>
              <p className="text-sm font-semibold text-white mb-1">{s.sub}</p>
              <p className="text-xs text-slate-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ 보안 섹션 ══════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="rounded-3xl border border-white/8 overflow-hidden"
          style={{ background: "linear-gradient(135deg, #0d1628 0%, #0a1520 50%, #0d1628 100%)" }}
        >
          <div className="grid md:grid-cols-2 gap-0">
            {/* 좌측 — 보안 시각화 */}
            <div className="p-10 md:p-14 border-b md:border-b-0 md:border-r border-white/8 flex flex-col justify-center">
              <div className="relative w-48 h-48 mx-auto md:mx-0 mb-8">
                {/* 동심원 */}
                {[1, 0.7, 0.45].map((s, i) => (
                  <div key={i}
                    className="absolute inset-0 rounded-full border border-[#3b82f6]/20"
                    style={{ transform: `scale(${s})`, margin: "auto" }}
                  />
                ))}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-[#3b82f6]/15 border border-[#3b82f6]/30 flex items-center justify-center">
                    <ShieldCheck className="h-9 w-9 text-[#3b82f6]" />
                  </div>
                </div>
                {/* 레이블들 */}
                {[
                  { top: "8%", left: "62%", text: "OTP 인증" },
                  { top: "72%", left: "60%", text: "이중 검증" },
                  { top: "40%", left: "-8%", text: "암호화" },
                ].map((l) => (
                  <div key={l.text}
                    className="absolute text-[9px] text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/20 rounded-full px-2 py-0.5 whitespace-nowrap"
                    style={{ top: l.top, left: l.left }}
                  >
                    {l.text}
                  </div>
                ))}
              </div>
              <h3 className="text-xl font-bold mb-3">금융급 보안을 기본으로</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                입금·출금 별도 OTP 인증, 익일 출금 승인 의무화,
                관리자 권한 계층 분리로 소중한 자금을 안전하게 보호합니다.
              </p>
            </div>
            {/* 우측 — 보안 항목 */}
            <div className="p-10 md:p-14 flex flex-col justify-center">
              <p className="text-[11px] text-[#3b82f6] uppercase tracking-widest mb-6">Security</p>
              <div className="space-y-5">
                {[
                  { icon: <Lock className="h-4 w-4" />, title: "입출금 OTP 이중 인증", desc: "입금 확인·출금 신청 시 별도 OTP 검증으로 무단 거래를 원천 차단합니다." },
                  { icon: <ShieldCheck className="h-4 w-4" />, title: "출금 익일 처리 정책", desc: "출금 신청 후 즉시 처리되지 않고 익일 10시 이후 관리자 승인 후 지급됩니다." },
                  { icon: <BadgeCheck className="h-4 w-4" />, title: "계층별 권한 분리", desc: "readonly·admin·finance 3단계 권한으로 역할에 맞는 접근만 허용됩니다." },
                  { icon: <Layers className="h-4 w-4" />, title: "거래 추적 번호 발급", desc: "모든 거래에 고유 추적번호가 발급되어 감사 및 분쟁 해결이 용이합니다." },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold mb-0.5">{item.title}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 최종 CTA ════════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 pb-24">
        <div className="relative rounded-3xl overflow-hidden text-center py-20 px-6"
          style={{ background: "linear-gradient(135deg, #0d2254 0%, #0a1540 50%, #0d2254 100%)" }}
        >
          {/* 배경 효과 */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-[#3b82f6]/15 blur-3xl rounded-full" />
          <div className="absolute bottom-0 left-0 w-64 h-32 bg-[#7c3aed]/10 blur-2xl rounded-full" />
          <div className="absolute bottom-0 right-0 w-64 h-32 bg-[#0369a1]/10 blur-2xl rounded-full" />

          <div className="relative">
            <div className="mx-auto mb-8 text-white opacity-90">
              <BrandWordmark className="mx-auto h-auto w-56" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">지금 바로 시작하세요</h2>
            <p className="text-slate-300 text-base mb-12 max-w-lg mx-auto leading-relaxed">
              회원이라면 가상계좌로 간편하게 구매를 진행하고,
              관리자라면 대시보드에서 전체 현황을 한눈에 파악하세요.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-md mx-auto">
              <button
                onClick={() => setLocation(nav("/member/login"))}
                className="group flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/18 px-6 py-4 font-semibold transition-all hover:scale-[1.03]"
              >
                <UserCircle2 className="h-5 w-5 text-slate-300" />
                회원 포털 입장
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={() => setLocation(nav("/login"))}
                className="group flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] px-6 py-4 font-semibold transition-all hover:scale-[1.03] shadow-2xl shadow-[#3b82f6]/40"
              >
                <Building2 className="h-5 w-5" />
                관리자 로그인
                <ArrowUpRight className="h-4 w-4 opacity-70 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 푸터 ══════════════════════════════════════════════ */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="text-white opacity-40">
              <BrandWordmark className="h-auto w-36" />
            </div>
            <div className="h-5 w-px bg-white/10" />
            <p className="text-xs text-slate-600">소상공인을 위한 안전한 거래 플랫폼</p>
          </div>
          <p className="text-xs text-slate-700">© 2025 TodoPay. All rights reserved.</p>
          <div className="flex items-center gap-6 text-xs text-slate-600">
            <button onClick={() => setLocation(nav("/member/login"))} className="hover:text-slate-300 transition-colors">회원 포털</button>
            <button onClick={() => setLocation(nav("/login"))} className="hover:text-slate-300 transition-colors">관리자</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
