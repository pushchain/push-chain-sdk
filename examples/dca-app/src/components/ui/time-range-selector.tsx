"use client";

import {Button} from "@/components/ui/button";
import {TimeRange} from "@/lib/utils";

interface TimeRangeSelectorProps {
  selectedRange: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function TimeRangeSelector({
  selectedRange,
  onRangeChange,
}: TimeRangeSelectorProps) {
  const ranges: TimeRange[] = ["7d", "1m"];

  return (
    <div className="flex space-x-2">
      {ranges.map((range) => (
        <Button
          key={range}
          variant={selectedRange === range ? "default" : "outline"}
          onClick={() => onRangeChange(range)}
        >
          {range}
        </Button>
      ))}
    </div>
  );
}
