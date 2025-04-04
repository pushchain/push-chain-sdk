import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertProps {
  variant?: 'default' | 'destructive' | 'success' | 'info';
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
}

export function Alert({
  variant = 'default',
  className,
  children,
  onClose,
}: AlertProps) {
  const variants = {
    default: "bg-background text-foreground",
    destructive: "bg-destructive/15 text-destructive dark:bg-destructive/15",
    success: "bg-green-500/15 text-green-600 dark:bg-green-500/15",
    info: "bg-blue-500/15 text-blue-600 dark:bg-blue-500/15"
  };

  const icons = {
    default: null,
    destructive: <AlertCircle className="h-4 w-4" />,
    success: <CheckCircle2 className="h-4 w-4" />,
    info: <AlertCircle className="h-4 w-4" />
  };

  return (
    <div
      className={cn(
        "relative w-full rounded-lg border p-4",
        variants[variant],
        className
      )}
    >
      <div className="flex items-start gap-4">
        {icons[variant] && (
          <div className="mt-0.5">{icons[variant]}</div>
        )}
        <div className="flex-1">{children}</div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-4 p-1 hover:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}