import React, { useState, useMemo, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { useChainId } from 'wagmi';
import { goldrushClient } from '@/lib/utils';
import { Chain, PortfolioResponse } from '@covalenthq/client-sdk';

interface ChartDataPoint {
  date: Date;
  value: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: ChartDataPoint;
  }>;
}

type TimeFrame = '7d' | '30d';

const PortfolioChart = ({
  walletAddress,
  chainId,
}: {
  walletAddress: string;
  chainId: number;
}) => {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('30d');
  const [data, setData] = useState<PortfolioResponse | null>(null);

  // Format data for the chart
  const chartData = useMemo(() => {
    if (!data?.items?.length) return [];

    const now = new Date();
    const daysToShow = timeFrame === '7d' ? 7 : 30;
    const cutoffDate = new Date(now.setDate(now.getDate() - daysToShow));

    // Create a map to aggregate values by timestamp
    const aggregatedValues = new Map<string, number>();

    // First, collect all timestamps and sum up values for each timestamp
    data.items.forEach((item) => {
      if (!item.holdings) return;
      item.holdings.forEach((holding) => {
        const timestamp = new Date(holding.timestamp ?? 0).toISOString();
        const currentValue = aggregatedValues.get(timestamp) || 0;
        aggregatedValues.set(
          timestamp,
          currentValue + (holding?.close?.quote || 0)
        );
      });
    });

    // Convert the map to an array of data points
    const aggregatedData = Array.from(aggregatedValues.entries())
      .map(([timestamp, value]) => ({
        date: new Date(timestamp),
        value: value,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Filter for the selected time frame
    return aggregatedData.filter((item) => item.date >= cutoffDate);
  }, [data, timeFrame]);

  // Format value for tooltip
  const formatValue = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Custom tooltip
  const CustomTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-lg">
          <p className="text-gray-600">
            {format(payload[0].payload.date, 'MMM d, yyyy')}
          </p>
          <p className="text-lg font-semibold text-blue-600">
            {formatValue(payload[0].value)}
          </p>
        </div>
      );
    }
    return null;
  };

  useEffect(() => {
    const fetchHistoricalData = async (chainName: Chain) => {
      try {
        if (!walletAddress) return;
        const response =
          await goldrushClient.BalanceService.getHistoricalPortfolioForWalletAddress(
            chainName,
            walletAddress,
            {
              days: 30, // Request 30 days of data
            }
          );
        if (!response.error && response.data) {
          setData(response.data);
          console.log('Portfolio data:', response.data); // Debug log
        } else {
          console.error(
            'Error fetching portfolio data:',
            response.error_message
          );
        }
      } catch (error) {
        console.error('Error fetching portfolio data:', error);
      }
    };

    if (walletAddress) {
      fetchHistoricalData(chainId);
    }
  }, [walletAddress, chainId]);

  // If no data, show loading or empty state
  if (!data?.items?.length) {
    return (
      <div className="w-full h-96 p-4 bg-white rounded-xl shadow-md flex items-center justify-center">
        <p className="text-gray-500">No portfolio data available</p>
      </div>
    );
  }

  return (
    <div className="w-full h-96 px-4 py-6 bg-white">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Portfolio Value</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTimeFrame('7d')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              timeFrame === '7d'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            7D
          </button>
          <button
            onClick={() => setTimeFrame('30d')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              timeFrame === '30d'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            30D
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-2rem)]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#E5E7EB"
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date: Date) => format(date, 'MMM d')}
              stroke="#6B7280"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis
              tickFormatter={formatValue}
              stroke="#6B7280"
              tickLine={false}
              axisLine={false}
              width={80}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#3B82F6"
              fillOpacity={1}
              fill="url(#colorValue)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PortfolioChart;
