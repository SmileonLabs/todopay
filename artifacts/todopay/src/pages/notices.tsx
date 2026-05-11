import React, { useState } from "react";
import {
  useListNotices,
  useCreateNotice,
  useUpdateNotice,
  useDeleteNotice,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Loader2, Plus, Pencil, Trash2, Pin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Notice } from "@workspace/api-client-react";

export default function Notices() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Notice | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isPinned, setIsPinned] = useState(false);

  const { data, isLoading } = useListNotices({ page, limit: 20 });
  const create = useCreateNotice();
  const update = useUpdateNotice();
  const del = useDeleteNotice();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/notices"] });

  const openCreate = () => {
    setEditTarget(null);
    setTitle("");
    setContent("");
    setIsPinned(false);
    setFormOpen(true);
  };

  const openEdit = (n: Notice) => {
    setEditTarget(n);
    setTitle(n.title);
    setContent(n.content);
    setIsPinned(n.isPinned);
    setFormOpen(true);
  };

  const handleSave = () => {
    if (editTarget) {
      update.mutate({ id: editTarget.id, data: { title, content, isPinned } }, {
        onSuccess: () => { toast({ title: "공지 수정 완료" }); setFormOpen(false); invalidate(); },
        onError: () => toast({ title: "수정 실패", variant: "destructive" }),
      });
    } else {
      create.mutate({ data: { title, content, isPinned } }, {
        onSuccess: () => { toast({ title: "공지 등록 완료" }); setFormOpen(false); invalidate(); },
        onError: () => toast({ title: "등록 실패", variant: "destructive" }),
      });
    }
  };

  const handleDelete = (id: number) => {
    if (!confirm("공지를 삭제하시겠습니까?")) return;
    del.mutate({ id }, {
      onSuccess: () => { toast({ title: "삭제 완료" }); invalidate(); },
      onError: () => toast({ title: "삭제 실패", variant: "destructive" }),
    });
  };

  const handleTogglePin = (n: Notice) => {
    update.mutate({ id: n.id, data: { isPinned: !n.isPinned } }, {
      onSuccess: () => { toast({ title: !n.isPinned ? "상단 고정 완료" : "고정 해제 완료" }); invalidate(); },
      onError: () => toast({ title: "변경 실패", variant: "destructive" }),
    });
  };

  const isPending = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">공지사항</h1>
        <Button onClick={openCreate} className="bg-primary text-black hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />공지 등록
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {data?.items.map((n) => (
            <Card key={n.id} className={`bg-card/50 border-border/50 transition-colors hover:border-border ${n.isPinned ? "border-primary/30 bg-primary/5" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {n.isPinned && (
                      <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                        <Pin className="h-2.5 w-2.5 mr-1" />고정
                      </Badge>
                    )}
                    <h3 className="font-semibold">{n.title}</h3>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => handleTogglePin(n)} title={n.isPinned ? "고정 해제" : "상단 고정"}>
                      <Pin className={`h-3 w-3 ${n.isPinned ? "text-primary" : ""}`} />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => openEdit(n)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handleDelete(n.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{n.content}</p>
                <p className="text-xs text-muted-foreground/60 mt-3">{formatDate(n.createdAt)}{n.updatedAt ? ` · 수정됨 ${formatDate(n.updatedAt)}` : ""}</p>
              </CardContent>
            </Card>
          ))}
          {data?.items.length === 0 && (
            <Card className="bg-card/50 border-border/50">
              <CardContent className="py-12 text-center text-muted-foreground">공지사항이 없습니다</CardContent>
            </Card>
          )}
        </div>
      )}

      {data && data.total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>이전</Button>
          <span className="text-sm text-muted-foreground self-center">{page} / {Math.ceil(data.total / 20)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>다음</Button>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editTarget ? "공지 수정" : "공지 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>제목</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" />
            </div>
            <div className="space-y-2">
              <Label>내용</Label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="공지 내용" rows={6} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={isPinned} onCheckedChange={setIsPinned} id="pin" />
              <Label htmlFor="pin" className="cursor-pointer">상단 고정</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={!title.trim() || !content.trim() || isPending} className="bg-primary text-black hover:bg-primary/90">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editTarget ? "수정" : "등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
