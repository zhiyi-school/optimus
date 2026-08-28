import { Link } from "react-router-dom";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CtaCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function CtaCard({ icon: Icon, title, description, to, onClick, disabled, className }: CtaCardProps) {
  const body = (
    <div className="flex h-full items-start gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );

  const cardClassName = cn(
    "h-full transition-all",
    disabled ? "opacity-50" : "hover:border-primary/40 hover:shadow-card-hover",
    className,
  );

  if (to && !disabled) {
    return (
      <Link to={to} className="block h-full">
        <Card className={cardClassName}>{body}</Card>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block h-full w-full text-left disabled:cursor-not-allowed"
    >
      <Card className={cardClassName}>{body}</Card>
    </button>
  );
}
