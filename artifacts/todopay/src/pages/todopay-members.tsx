import { useState } from "react";
import { Search } from "lucide-react";
import { TodoPayGuard } from "@/components/todopay-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { useTodoPayQuery, type Page, type TodoPayMember } from "@/lib/todopay-api";

function maskPhone(value: string) {
  return value.replace(/(\d{3})\d+(\d{4})$/, "$1-****-$2");
}

function MembersContent() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const params = new URLSearchParams({ limit: "50" });
  if (search) params.set("search", search);
  const members = useTodoPayQuery<Page<TodoPayMember>>(`/members?${params}`);

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold">회원 및 가상계좌</h1><p className="mt-1 text-sm text-muted-foreground">TodoPay 회원과 실제 가상계좌 발급 상태를 조회합니다.</p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">회원 검색</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input value={input} onChange={(event) => setInput(event.target.value)} placeholder="이름, 아이디, 전화번호" onKeyDown={(event) => event.key === "Enter" && setSearch(input.trim())} />
          <Button onClick={() => setSearch(input.trim())}><Search className="mr-2 h-4 w-4" />조회</Button>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0"><div className="divide-y divide-border">
        {(members.data?.items ?? []).map((member) => <div key={member.id} className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1.2fr_.8fr]">
          <div><p className="font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.loginId}</p></div>
          <div><p className="text-xs text-muted-foreground">연락처</p><p>{maskPhone(member.phone)}</p></div>
          <div><p className="text-xs text-muted-foreground">가상계좌</p>{member.virtualAccount ? <p>{member.virtualAccount.bankName} · {member.virtualAccount.accountNumber}</p> : <p className="text-muted-foreground">미발급</p>}</div>
          <div><Badge variant="outline">{member.isActive ? "활성" : "비활성"}</Badge><p className="mt-1 text-xs text-muted-foreground">{formatDate(member.createdAt)}</p></div>
        </div>)}
        {!members.isLoading && (members.data?.items.length ?? 0) === 0 && <p className="p-10 text-center text-muted-foreground">회원이 없습니다.</p>}
      </div></CardContent></Card>
    </div>
  );
}

export default function TodoPayMembers() {
  return <TodoPayGuard><MembersContent /></TodoPayGuard>;
}
