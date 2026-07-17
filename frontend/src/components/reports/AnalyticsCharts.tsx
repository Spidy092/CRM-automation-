import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from 'recharts';

// ── Colour palette ─────────────────────────────────────────────────────────

const PALETTE = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

const TOOLTIP_STYLE = {
  borderRadius: '10px',
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  fontSize: '12px',
  padding: '8px 12px',
};

// ── Shared axis props ──────────────────────────────────────────────────────

const axisProps = {
  stroke: '#94a3b8',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

// ── BarChartGeneric ────────────────────────────────────────────────────────

interface BarChartGenericProps {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
}

export function BarChartGeneric({
  data,
  xKey,
  yKey,
  color = PALETTE[0],
  height = 240,
}: BarChartGenericProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={yKey} fill={color} radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── LineChartGeneric ───────────────────────────────────────────────────────

interface LineChartGenericProps {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
}

export function LineChartGeneric({
  data,
  xKey,
  yKey,
  color = PALETTE[1],
  height = 240,
}: LineChartGenericProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Line
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── MultiLineChart ─────────────────────────────────────────────────────────

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

interface MultiLineChartProps {
  data: Record<string, string | number>[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
}

export function MultiLineChart({ data, xKey, series, height = 260 }: MultiLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? PALETTE[i % PALETTE.length];
            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        {series.map((s, i) => {
          const color = s.color ?? PALETTE[i % PALETTE.length];
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── HorizontalBarChart ─────────────────────────────────────────────────────

interface HorizontalBarChartProps {
  data: Record<string, string | number>[];
  yKey: string;
  xKey: string;
  color?: string;
  height?: number;
}

export function HorizontalBarChart({
  data,
  yKey,
  xKey,
  color = PALETTE[2],
  height,
}: HorizontalBarChartProps) {
  const calculatedHeight = Math.max(180, data.length * 52);
  return (
    <ResponsiveContainer width="100%" height={height ?? calculatedHeight}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 24, left: 4, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey={yKey}
          {...axisProps}
          width={110}
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={xKey} fill={color} radius={[0, 6, 6, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── DonutChartWithLegend ───────────────────────────────────────────────────

interface DonutChartWithLegendProps {
  data: { name: string; value: number }[];
  height?: number;
}

export function DonutChartWithLegend({ data, height = 240 }: DonutChartWithLegendProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="50%"
          outerRadius="72%"
          paddingAngle={3}
          cornerRadius={4}
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── IntegrationStatusPie (legacy alias) ───────────────────────────────────

interface IntegrationRow {
  name?: string;
  displayName?: string;
  status?: string;
}

export function IntegrationStatusPie({ integrations }: { integrations: IntegrationRow[] }) {
  const counts: Record<string, number> = {};
  integrations.forEach((i) => {
    const s = i.status ?? 'unknown';
    counts[s] = (counts[s] ?? 0) + 1;
  });
  const data = Object.entries(counts).map(([name, value]) => ({ name, value }));
  return <DonutChartWithLegend data={data} />;
}

// ── FunnelProgressBar ──────────────────────────────────────────────────────

interface FunnelStage {
  stageName: string;
  leadCount: number;
  conversionRate: number;
  dropOffRate?: number;
}

interface FunnelProgressBarProps {
  stages: FunnelStage[];
}

export function FunnelProgressBar({ stages }: FunnelProgressBarProps) {
  if (!stages.length) return null;
  const max = Math.max(...stages.map((s) => s.leadCount), 1);
  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const pct = Math.round((stage.leadCount / max) * 100);
        const color = PALETTE[i % PALETTE.length];
        return (
          <div key={stage.stageName}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">{stage.stageName}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{stage.leadCount} leads</span>
                <span className="text-xs font-semibold" style={{ color }}>
                  {stage.conversionRate.toFixed(1)}% conv.
                </span>
                {stage.dropOffRate !== undefined && stage.dropOffRate > 0 && (
                  <span className="text-xs text-red-500">
                    -{stage.dropOffRate.toFixed(1)}% drop
                  </span>
                )}
              </div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
