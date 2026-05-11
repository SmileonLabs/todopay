import React, { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useResetUserPassword, useUpdateUser } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Loader2, User, KeyRound, Shield, Clock, Hash } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/50 bg-purple-500/10 text-purple-400",
  hq: "border-blue-500/50 bg-blue-500/10 text-blue-400",
  distributor: "border-green-500/50 bg-green-500/10 text-green-400",
  agency: "border-orange-500/50 bg-orange-500/10 text-orange-400",
  store: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400",
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: "슈퍼관리자",
  hq: "본사",
  distributor: "총판",
  agency: "대리점",
  store: "매장",
};

const PERM_LABELS: Record<string, string> = {
  readonly: "읽기전용",
  admin: "관리자",
  finance: "재무",
};

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(user?.name ?? "");
  const [nameEditing, setNameEditing] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const updateUser = useUpdateUser();
  const resetPw = useResetUserPassword();

  if (!user) return null;

  const handleSaveName = () => {
    if (!name.trim()) return;
    updateUser.mutate({ id: user.id, data: { name } }, {
      onSuccess: () => {
        toast({ title: "이름이 변경됐습니다" });
        setNameEditing(false);
        void qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      },
      onError: () => toast({ title: "이름 변경 실패", variant: "destructive" }),
    });
  };

  const handleChangePassword = () => {
    if (!newPw.trim()) {
      toast({ title: "새 비밀번호를 입력해주세요", variant: "destructive" });
      return;
    }
    if (newPw !== confirmPw) {
      toast({ title: "새 비밀번호가 일치하지 않습니다", variant: "destructive" });
      return;
    }
    if (newPw.length < 6) {
      toast({ title: "비밀번호는 6자 이상이어야 합니다", variant: "destructive" });
      return;
    }
    resetPw.mutate({ id: user.id, data: { newPassword: newPw } }, {
      onSuccess: () => {
        toast({ title: "비밀번호가 변경됐습니다" });
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
      },
      onError: () => toast({ title: "비밀번호 변경 실패", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">내 계정</h1>

      {/* Account Info */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            계정 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-primary">
                {user.name.charAt(0)}
              </span>
            </div>
            <div>
              <p className="text-lg font-semibold">{user.name}</p>
              <p className="text-sm text-muted-foreground font-mono">{user.loginId}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <Badge variant="outline" className={`${ROLE_COLORS[user.role] ?? ""}`}>
                {ROLE_LABELS[user.role] ?? user.role}
              </Badge>
              <Badge variant="outline" className="border-slate-500/30 text-slate-400 bg-slate-500/10">
                {PERM_LABELS[user.permission] ?? user.permission}
              </Badge>
            </div>
          </div>

          <Separator className="border-border/50" />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Hash className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">아이디</p>
                <p className="font-mono">{user.loginId}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">OTP 인증</p>
                <Badge variant="outline" className={`text-xs ${user.useOtp ? "border-primary/30 text-primary" : "border-slate-500/30 text-slate-400"}`}>
                  {user.useOtp ? "사용 중" : "미사용"}
                </Badge>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">가입일</p>
                <p>{formatDate(user.createdAt)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Name */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            이름 변경
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">이름</Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setNameEditing(e.target.value !== user.name); }}
                placeholder="이름 입력"
              />
            </div>
            <Button
              onClick={handleSaveName}
              disabled={!nameEditing || !name.trim() || updateUser.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {updateUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              저장
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            비밀번호 변경
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">새 비밀번호</Label>
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="새 비밀번호 (6자 이상)"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">새 비밀번호 확인</Label>
            <Input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="비밀번호 재입력"
              onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
            />
            {confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-red-400">비밀번호가 일치하지 않습니다</p>
            )}
          </div>
          <div className="pt-1">
            <Button
              onClick={handleChangePassword}
              disabled={!newPw || !confirmPw || resetPw.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {resetPw.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              비밀번호 변경
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
