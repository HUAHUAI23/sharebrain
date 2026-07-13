import type { ReactNode } from "react";

import { NotionIcon } from "@sharebrain/ui/components/notion";
import { cn } from "@sharebrain/ui/lib/utils";

type PageTitleProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function PageTitle({ icon, title, description, className }: PageTitleProps) {
  return (
    <header className={cn("mb-6 grid", icon ? "gap-3.5" : "gap-0", className)}>
      {icon ? <NotionIcon size="lg">{icon}</NotionIcon> : null}
      <div>
        <h1 className="m-0 text-4xl font-bold leading-tight tracking-normal text-foreground max-[560px]:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 mb-0 whitespace-normal text-muted-foreground text-xs leading-snug">
            {description}
          </p>
        ) : null}
      </div>
    </header>
  );
}
