import React, { useState } from "react";
import { useGetDailyStatistics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const KRW_TICK = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}백만` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}천` : String(v);

export default function Statistics() {
  const defaults = getDefaultDates();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  const { data, isLoading } = useGetDailyStatistics({ startDate, endDate });

  const chartData = (data ?? []).map((d) => ({
    date: d.date.slice(5),
    입금: d.depositAmount,
    출금: d.withdrawalAmount,
    수수료: d.feeAmount,
    건수입금: d.depositCount,
    건수출금: d.withdrawalCount,
  }));

  const totals = (data ?? []).reduce(
    (acc, d) => ({
      deposit: acc.deposit + d.depositAmount,
      withdrawal: acc.withdrawal + d.withdrawalAmount,
      fee: acc.fee + d.feeAmount,
      net: acc.net + d.netAmount,
      depositCount: acc.depositCount + d.depositCount,
      withdrawalCount: acc.withdrawalCount + d.withdrawalCount,
    }),
    { deposit: 0, withdrawal: 0, fee: 0, net: 0, depositCount: 0, withdrawalCount: 0 },
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">일자별 통계</h1>

      {/* Date filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input type="date" className="w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span className="text-muted-foreground">~</span>
        <Input type="date" className="w-40" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      {/* Totals */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "총 입금", value: formatMoney(totals.deposit), color: "text-blue-400" },
            { label: "총 출금", value: formatMoney(totals.withdrawal), color: "text-red-400" },
            { label: "총 수수료", value: formatMoney(totals.fee), color: "text-green-400" },
            { label: "순액", value: formatMoney(totals.net), color: "text-primary" },
            { label: "입금 건수", value: `${totals.depositCount}건`, color: "text-blue-400" },
            { label: "출금 건수", value: `${totals.withdrawalCount}건`, color: "text-red-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-card/50 border-border/50">
              <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs text-muted-foreground">{s.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4"><p className={`text-base font-bold ${s.color}`}>{s.value}</p></CardContent>
            </Card>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Amount Chart */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader><CardTitle className="text-base">입출금 금액 추이</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tickFormatter={KRW_TICK} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                    formatter={(v: number) => formatMoney(v)}
                    labelStyle={{ color: "#cbd5e1" }}
                  />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Bar dataKey="입금" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="출금" fill="#f87171" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="수수료" fill="#4ade80" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Count Chart */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader><CardTitle className="text-base">입출금 건수 추이</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#cbd5e1" }}
                  />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Bar dataKey="건수입금" fill="#818cf8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="건수출금" fill="#fb923c" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Table */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader><CardTitle className="text-base">일별 상세 데이터</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      {["날짜", "입금건수", "입금금액", "출금건수", "출금금액", "수수료", "순액"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data ?? []).slice().reverse().map((d) => (
                      <tr key={d.date} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono text-xs">{d.date}</td>
                        <td className="px-4 py-2 text-blue-400">{d.depositCount}건</td>
                        <td className="px-4 py-2 text-blue-400">{formatMoney(d.depositAmount)}</td>
                        <td className="px-4 py-2 text-red-400">{d.withdrawalCount}건</td>
                        <td className="px-4 py-2 text-red-400">{formatMoney(d.withdrawalAmount)}</td>
                        <td className="px-4 py-2 text-green-400">{formatMoney(d.feeAmount)}</td>
                        <td className="px-4 py-2 text-primary">{formatMoney(d.netAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
