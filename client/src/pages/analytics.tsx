import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";
import { Download, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLocations, useStockItems, useTransactions } from "@/lib/firestore-hooks";
import { replayBalanceHistory } from "@/lib/history-replay";
import type { Transaction } from "@/lib/types";

const MONTHS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
const CHART_COLORS = ["#0f766e", "#f97316", "#2563eb", "#ca8a04", "#9333ea", "#dc2626"];
const ANALYTICS_TRANSACTION_TYPES: Transaction["type"][] = ["sales", "heat_treatment_created", "factory_transfer_created", "office_transfer_created"];

const getFinancialYear = (date: Date) => {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
};

const fiscalMonthDate = (financialYear: string, monthIndex: number) => {
  const startYear = 2000 + Number(financialYear.slice(0, 2));
  return new Date(monthIndex < 9 ? startYear : startYear + 1, (monthIndex + 3) % 12, 1);
};

const transactionDate = (tx: Transaction) => tx.businessDate || tx.timestamp;
const amount = (tx: Transaction) => Math.abs(tx.quantityChange || 0);
const activityGroupKey = (tx: Transaction) =>
  tx.bulkTransactionId || tx.processId || tx.transferId || tx.salesId || tx.id;

const countActivityBlocks = (transactions: Transaction[], type: Transaction["type"]) =>
  new Set(transactions.filter((tx) => tx.type === type).map(activityGroupKey)).size;

const countUserActivityBlocks = (transactions: Transaction[]) => {
  const groups = new Map<string, { name: string; count: number }>();
  transactions.forEach((tx) => {
    const key = activityGroupKey(tx);
    if (!groups.has(key)) {
      groups.set(key, { name: tx.user?.name || tx.user?.id || "Unknown", count: 1 });
    }
  });
  return Array.from(groups.values())
    .reduce((users, group) => {
      const existing = users.find((user) => user.name === group.name);
      if (existing) existing.count += group.count;
      else users.push({ ...group });
      return users;
    }, [] as Array<{ name: string; count: number }>)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
};

const pdfEscape = (value: string) => value.replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const pdfColor = (hex: string) => {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)}`;
};

const pdfText = (commands: string[], text: string, x: number, y: number, size = 9, bold = false, color = "0 0 0") => {
  commands.push(`BT ${color} rg ${bold ? "/F2" : "/F1"} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`);
};

const pdfRect = (commands: string[], x: number, y: number, width: number, height: number, color: string) => {
  commands.push(`${color} rg ${x} ${y} ${width} ${height} re f`);
};

const pdfLine = (commands: string[], x1: number, y1: number, x2: number, y2: number, color = "0.82 0.85 0.88") => {
  commands.push(`${color} RG ${x1} ${y1} m ${x2} ${y2} l S`);
};

const pdfPie = (commands: string[], cx: number, cy: number, radius: number, values: Array<{ value: number }>, colors: string[]) => {
  const total = values.reduce((sum, item) => sum + item.value, 0);
  if (!total) return;
  let start = -Math.PI / 2;
  values.forEach((item, index) => {
    if (!item.value) return;
    const end = start + (item.value / total) * Math.PI * 2;
    const steps = Math.max(3, Math.ceil(Math.abs(end - start) * 16));
    const points = [`${cx} ${cy} m`];
    for (let step = 0; step <= steps; step += 1) {
      const angle = start + ((end - start) * step) / steps;
      points.push(`${cx + Math.cos(angle) * radius} ${cy + Math.sin(angle) * radius} l`);
    }
    commands.push(`${pdfColor(colors[index % colors.length])} rg ${points.join(" ")} h f`);
    start = end;
  });
};

const buildAnalyticsPdf = (title: string, report: {
  periodLabel: string;
  financialYear: string;
  summary: Array<{ label: string; quantity: number; count: number }>;
  salesByCompany: Array<{ name: string; value: number }>;
  categoryData: Array<{ name: string; sales: number; heatTreatment: number; factory: number; office: number }>;
  locationData: Array<{ name: string; value: number }>;
  userRanking: Array<{ name: string; count: number }>;
  averageDay: string;
  averageMonth: string;
  closingStock: number;
}) => {
  const commands: string[] = [];
  pdfText(commands, title, 42, 800, 18, true);
  pdfText(commands, `Period: ${report.periodLabel} | Financial year: ${report.financialYear}`, 42, 780, 9, false, "0.25 0.29 0.35");
  pdfText(commands, "Quantity and activity summary", 42, 748, 12, true, "0.05 0.35 0.32");
  const cardWidth = 124;
  report.summary.forEach((item, index) => {
    const x = 42 + index * 130;
    pdfRect(commands, x, 674, cardWidth, 56, index === 0 ? "1 0.94 0.88" : index === 1 ? "0.88 0.93 1" : index === 2 ? "0.94 0.9 1" : "0.87 0.96 0.94");
    pdfText(commands, item.label, x + 8, 714, 8, true);
    pdfText(commands, `${item.quantity} stock units`, x + 8, 696, 11, true);
    pdfText(commands, `${item.count} transactions`, x + 8, 682, 8, false, "0.25 0.29 0.35");
  });

  pdfText(commands, "Sales by company", 42, 646, 12, true);
  pdfPie(commands, 105, 570, 55, report.salesByCompany, CHART_COLORS);
  report.salesByCompany.forEach((item, index) => {
    const y = 620 - index * 16;
    pdfRect(commands, 180, y - 2, 8, 8, pdfColor(CHART_COLORS[index]));
    pdfText(commands, `${item.name}: ${item.value}`, 194, y, 9);
  });

  pdfText(commands, "Closing stock by location", 330, 646, 12, true);
  pdfPie(commands, 393, 570, 55, report.locationData, CHART_COLORS);
  report.locationData.forEach((item, index) => {
    const y = 620 - index * 16;
    pdfRect(commands, 468, y - 2, 8, 8, pdfColor(CHART_COLORS[index]));
    pdfText(commands, `${item.name}: ${item.value}`, 482, y, 8);
  });

  pdfText(commands, "Transaction volume by category (stock units)", 42, 480, 12, true);
  const chartX = 64;
  const chartY = 300;
  const chartWidth = 470;
  const chartHeight = 150;
  const maxCategoryValue = Math.max(1, ...report.categoryData.map((row) => Math.max(row.sales, row.heatTreatment, row.factory, row.office)));
  [0, 0.25, 0.5, 0.75, 1].forEach((step) => {
    const y = chartY + chartHeight * step;
    pdfLine(commands, chartX, y, chartX + chartWidth, y);
    pdfText(commands, String(Math.round(maxCategoryValue * step)), 28, y - 3, 7, false, "0.35 0.39 0.45");
  });
  const barColors = ["0.98 0.45 0.08", "0.05 0.47 0.43", "0.15 0.39 0.92", "0.58 0.2 0.86"];
  report.categoryData.forEach((row, rowIndex) => {
    const groupWidth = chartWidth / Math.max(1, report.categoryData.length);
    const barWidth = Math.min(12, groupWidth / 5);
    [row.sales, row.heatTreatment, row.factory, row.office].forEach((value, barIndex) => {
      const x = chartX + rowIndex * groupWidth + 8 + barIndex * (barWidth + 2);
      const height = (value / maxCategoryValue) * chartHeight;
      pdfRect(commands, x, chartY, barWidth, height, barColors[barIndex]);
      if (value > 0) pdfText(commands, String(value), x - 2, chartY + height + 7, 6, false, "0.15 0.18 0.22");
    });
    pdfText(commands, row.name.slice(0, 18), chartX + rowIndex * groupWidth, chartY - 16, 7);
  });
  ["Sales", "Heat treatment", "Factory", "Office"].forEach((label, index) => {
    pdfRect(commands, 80 + index * 110, 270, 8, 8, barColors[index]);
    pdfText(commands, label, 92 + index * 110, 271, 7);
  });

  pdfText(commands, "Most active users (transaction blocks)", 42, 240, 12, true);
  report.userRanking.forEach((user, index) => {
    const y = 218 - index * 14;
    pdfText(commands, `${index + 1}. ${user.name}`, 50, y, 8);
    pdfRect(commands, 170, y - 2, Math.min(280, user.count * 6), 9, "0.05 0.47 0.43");
    pdfText(commands, String(user.count), 458, y, 8, true);
  });
  pdfText(commands, "Operational summary", 42, 132, 10, true, "0.05 0.35 0.32");
  pdfText(commands, `Blocks/day: ${report.averageDay}`, 42, 116, 9, false, "0.25 0.29 0.35");
  pdfText(commands, `Blocks/month: ${report.averageMonth}`, 210, 116, 9, false, "0.25 0.29 0.35");
  pdfText(commands, `Closing stock: ${report.closingStock} units`, 390, 116, 9, false, "0.25 0.29 0.35");
  pdfText(commands, "Adjustments and edits are included in closing-stock reconstruction, but excluded from activity counts and averages.", 42, 88, 7, false, "0.25 0.29 0.35");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${commands.join("\n").length} >>\nstream\n${commands.join("\n")}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="border-slate-200 shadow-sm"><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="h-72">{children}</CardContent></Card>;
}

export default function AnalyticsPage() {
  const currentYear = getFinancialYear(new Date());
  const [financialYear, setFinancialYear] = useState(currentYear);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const { transactions, loading: transactionsLoading } = useTransactions(0, true);
  const { items, loading: itemsLoading } = useStockItems();
  const { locations } = useLocations();

  const period = useMemo(() => {
    const months = selectedMonths.length ? [...selectedMonths].sort((a, b) => a - b) : MONTHS.map((_, index) => index);
    const first = fiscalMonthDate(financialYear, months[0]);
    const last = fiscalMonthDate(financialYear, months[months.length - 1]);
    const requestedEnd = endOfMonth(last);
    const isCurrentPeriod = financialYear === currentYear && requestedEnd > new Date();
    return { months, start: startOfMonth(first), end: isCurrentPeriod ? new Date() : requestedEnd };
  }, [financialYear, selectedMonths, currentYear]);

  const analytics = useMemo(() => {
    const periodTransactions = transactions.filter((tx) => {
      const date = transactionDate(tx);
      return date >= period.start && date <= period.end;
    });
    const visiblePeriodTransactions = periodTransactions.filter((tx) => !tx.historyHidden);
    const inPeriod = visiblePeriodTransactions.filter((tx) => ANALYTICS_TRANSACTION_TYPES.includes(tx.type));
    const historicalTransactions = transactions.filter((tx) => tx.timestamp <= period.end);
    const replay = replayBalanceHistory(historicalTransactions);
    const latestBalances = new Map<string, { ht: number; fa: number; of: number }>();
    replay.forEach((row) => latestBalances.set(row.itemKey, row.after));

    const categories = Array.from(new Set(items.map((item) => item.category).concat(transactions.map((tx) => tx.category)))).filter(Boolean);
    const totalFor = (type: Transaction["type"]) => inPeriod.filter((tx) => tx.type === type).reduce((sum, tx) => sum + amount(tx), 0);
    const countFor = (type: Transaction["type"]) => countActivityBlocks(inPeriod, type);
    const categoryData = categories.map((category) => ({
      name: category,
      sales: inPeriod.filter((tx) => tx.type === "sales" && tx.category === category).reduce((sum, tx) => sum + amount(tx), 0),
      heatTreatment: inPeriod.filter((tx) => tx.type === "heat_treatment_created" && tx.category === category).reduce((sum, tx) => sum + amount(tx), 0),
      factory: inPeriod.filter((tx) => tx.type === "factory_transfer_created" && tx.category === category).reduce((sum, tx) => sum + amount(tx), 0),
      office: inPeriod.filter((tx) => tx.type === "office_transfer_created" && tx.category === category).reduce((sum, tx) => sum + amount(tx), 0),
    }));
    const salesByCompany = ["CEC", "AGW", "BRP"].map((name) => ({ name, value: inPeriod.filter((tx) => tx.type === "sales" && tx.salesCompany === name).reduce((sum, tx) => sum + amount(tx), 0) })).filter((row) => row.value > 0);
    const balances = Array.from(latestBalances.values());
    const locationData = [
      { name: "Heat treatment", value: balances.reduce((sum, balance) => sum + balance.ht, 0) },
      { name: "Factory", value: balances.reduce((sum, balance) => sum + balance.fa, 0) },
      { name: "Office", value: balances.reduce((sum, balance) => sum + balance.of, 0) },
    ];
    const userRanking = countUserActivityBlocks(inPeriod);
    const days = Math.max(1, differenceInCalendarDays(period.end, period.start) + 1);
    return {
      inPeriod,
      periodTransactionCount: inPeriod.length,
      categoryData,
      salesByCompany,
      locationData,
      userRanking,
      days,
      totalSales: totalFor("sales"),
      totalFactory: totalFor("factory_transfer_created"),
      totalOffice: totalFor("office_transfer_created"),
      totalHeatTreatment: totalFor("heat_treatment_created"),
      countSales: countFor("sales"),
      countFactory: countFor("factory_transfer_created"),
      countOffice: countFor("office_transfer_created"),
      countHeatTreatment: countFor("heat_treatment_created"),
    };
  }, [items, transactions, period]);

  const toggleMonth = (index: number) => setSelectedMonths((current) => current.includes(index) ? current.filter((month) => month !== index) : [...current, index]);
  const handlePdf = () => {
    const periodLabel = `${format(period.start, "dd MMM yyyy")} - ${format(period.end, "dd MMM yyyy")}`;
    const report = {
      periodLabel,
      financialYear,
      summary: [
        { label: "Sales", quantity: analytics.totalSales, count: analytics.countSales },
        { label: "Factory transfers", quantity: analytics.totalFactory, count: analytics.countFactory },
        { label: "Office transfers", quantity: analytics.totalOffice, count: analytics.countOffice },
        { label: "Heat treatment", quantity: analytics.totalHeatTreatment, count: analytics.countHeatTreatment },
      ],
      salesByCompany: analytics.salesByCompany,
      categoryData: analytics.categoryData,
      locationData: analytics.locationData,
      userRanking: analytics.userRanking,
      averageDay: (analytics.inPeriod.length / analytics.days).toFixed(2),
      averageMonth: (analytics.inPeriod.length / Math.max(1, period.months.length)).toFixed(2),
      closingStock: analytics.locationData.reduce((sum, row) => sum + row.value, 0),
    };
    const url = URL.createObjectURL(buildAnalyticsPdf(`StockPro Analytics FY ${financialYear}`, report));
    const link = document.createElement("a"); link.href = url; link.download = `analytics-${financialYear}-${format(period.end, "yyyy-MM-dd")}.pdf`; link.click(); URL.revokeObjectURL(url);
  };

  const loading = transactionsLoading || itemsLoading;
  return <Layout>
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Company intelligence</p><h1 className="text-3xl font-bold tracking-tight text-slate-900">Analytics</h1><p className="mt-1 text-slate-500">Transaction activity and closing stock for the selected period.</p></div>
        <Button onClick={handlePdf} disabled={loading}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
      </div>
      <Card className="border-teal-100 bg-teal-50/50"><CardContent className="grid gap-4 p-5 lg:grid-cols-[180px_1fr] lg:items-end">
        <div><Label htmlFor="financial-year">Financial year</Label><select id="financial-year" value={financialYear} onChange={(event) => { setFinancialYear(event.target.value); setSelectedMonths([]); }} className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option>{currentYear}</option><option>25-26</option><option>24-25</option><option>23-24</option></select></div>
        <div><Label>Months (leave empty for the full year)</Label><div className="mt-2 flex flex-wrap gap-2">{MONTHS.map((month, index) => <Button key={month} type="button" size="sm" variant={selectedMonths.includes(index) ? "default" : "outline"} onClick={() => toggleMonth(index)}>{month}</Button>)}</div></div>
      </CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Sales", analytics.totalSales, analytics.countSales, "text-orange-700"],
        ["Factory transfers", analytics.totalFactory, analytics.countFactory, "text-blue-700"],
        ["Office transfers", analytics.totalOffice, analytics.countOffice, "text-violet-700"],
        ["Heat treatment", analytics.totalHeatTreatment, analytics.countHeatTreatment, "text-teal-700"],
      ].map(([label, quantity, count, color]) => <Card key={String(label)}><CardContent className="p-5"><p className="text-sm text-slate-500">{label}</p><p className={`mt-2 text-3xl font-bold ${color}`}>{quantity}</p><p className="text-xs font-medium text-slate-500">Stock units</p><p className="mt-2 text-sm text-slate-600"><span className="font-semibold">{count}</span> {Number(count) === 1 ? "transaction" : "transactions"}</p></CardContent></Card>)}</div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Sales by company"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={analytics.salesByCompany} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={85} label>{analytics.salesByCompany.map((row, index) => <Cell key={row.name} fill={CHART_COLORS[index]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Transaction volume by category"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.categoryData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="sales" fill="#f97316" /><Bar dataKey="heatTreatment" name="Heat treatment" fill="#0f766e" /><Bar dataKey="factory" fill="#2563eb" /><Bar dataKey="office" fill="#9333ea" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Closing stock by location"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={analytics.locationData} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={85} label>{analytics.locationData.map((row, index) => <Cell key={row.name} fill={CHART_COLORS[index]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Most active users"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.userRanking} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={90} /><Tooltip /><Bar dataKey="count" name="Transactions" fill="#0f766e" /></BarChart></ResponsiveContainer></ChartCard>
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-teal-700" />Operational summary</CardTitle><CardDescription>Qualifying activity excludes adjustment records. Closing stock is calculated as of {format(period.end, "dd MMM yyyy")}.</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Qualifying transactions / day</span><p className="text-xl font-semibold">{(analytics.inPeriod.length / analytics.days).toFixed(2)}</p></div><div><span className="text-slate-500">Qualifying transactions / month</span><p className="text-xl font-semibold">{(analytics.inPeriod.length / Math.max(1, period.months.length)).toFixed(2)}</p></div><div><span className="text-slate-500">Closing stock units</span><p className="text-xl font-semibold">{analytics.locationData.reduce((sum, row) => sum + row.value, 0)}</p></div></CardContent></Card>
      {locations.length === 0 && <p className="text-xs text-slate-400">No named locations have been configured yet; balances are shown by the app's three tracked stock locations.</p>}
    </div>
  </Layout>;
}