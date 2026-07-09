import type { ReactNode } from "react";

import { NotionIcon } from "@sharebrain/ui/components/notion";

type PageTitleProps = {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
};

export function PageTitle({ icon, title, description }: PageTitleProps) {
  return (
    <header className="mb-6 grid gap-3.5">
      <NotionIcon size="lg">{icon}</NotionIcon>
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
