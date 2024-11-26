import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

interface CryptoChartProps {
  data: { date: string; value: number }[];
}

export function CryptoChart({ data }: CryptoChartProps) {
  return (
    <div className="w-full">
      <div>
        <ChartContainer
          config={{
            value: {
              label: 'Value',
              color: 'hsl(var(--chart-1))',
            },
          }}
          className="h-[300px] w-full mt-8"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => value}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => `$${value.toLocaleString()}`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="value"
                strokeWidth={2}
                activeDot={{ r: 8 }}
                stroke="var(--color-value)"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </div>
  );
}
