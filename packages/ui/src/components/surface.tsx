import * as React from "react";

import { cn } from "../lib/utils";

export type SurfaceProps = React.HTMLAttributes<HTMLDivElement>;

export function Surface({ className, ...props }: SurfaceProps) {
  return (
    <div
      className={cn("rounded-md border border-border-subtle bg-surface text-foreground", className)}
      {...props}
    />
  );
}
