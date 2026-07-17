// 渲染工作台内容页统一的标题与说明层级。
import type { ReactNode } from "react";

import { cn } from "@sharebrain/ui/lib/utils";

type PageTitleProps = {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function PageTitle({ title, description, className }: PageTitleProps) {
  return (
    <header className={cn("mb-7 grid gap-1.5", className)}>
      <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-normal text-foreground max-[560px]:text-2xl">
        {title}
      </h1>
      {description ? (
        <p className="m-0 max-w-2xl whitespace-normal text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}
