import type { IntegrationHealth } from '@/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const DEFAULT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];

const tooltipStyle = {
  borderRadius: '12px',
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
  fontSize: '13px',
};

type ChartPoint = Record<string, string | number>;

type BarChartGenericProps = {
  data: ChartPoint[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: string;
};

export function BarChartGeneric({ data, xKey, yKey, color = '#6366f1', height = 'h-64' }: BarChartGenericProps) {
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey={xKey} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey={yKey} fill={color} radius={[6, 6, 0, 0]} barSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type LineChartGenericProps = {
  data: ChartPoint[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: string;
};

export function LineChartGeneric({ data, xKey, yKey, color = '#0ea5e9', height = 'h-64' }: LineChartGenericProps) {
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey={xKey} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type PieChartGenericProps = {
  data: Array<{ name: string; value: number }>;
  colors?: string[];
  height?: string;
};

export function PieChartGeneric({ data, colors = DEFAULT_COLORS, height = 'h-64' }: PieChartGenericProps) {
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={4}
            cornerRadius={4}
          >
            {data.map((entry) => (
              <Cell key={`cell-${entry.name}`} fill={colors[data.indexOf(entry) % colors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLORS: Record<IntegrationHealth['status'], string> = {
  healthy: '#10b981',
  degraded: '#f59e0b',
  failing: '#f43f5e',
  disabled: '#94a3b8',
};

type IntegrationStatusPieProps = {
  integrations: IntegrationHealth[];
  height?: string;
};

export function IntegrationStatusPie({ integrations, height }: IntegrationStatusPieProps) {
  const counts = integrations.reduce<Record<IntegrationHealth['status'], number>>(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { healthy: 0, degraded: 0, failing: 0, disabled: 0 },
  );

  const data = (Object.keys(counts) as IntegrationHealth['status'][])
    .filter((key) => counts[key] > 0)
    .map((key) => ({ name: key, value: counts[key] }));

  return <PieChartGeneric data={data} colors={data.map((d) => STATUS_COLORS[d.name])} height={height} />;
}
