import * as React from "react"

import { Toaster } from "#components/sonner"
import { TooltipProvider } from "#components/tooltip"

function UIProvider({ children }: React.PropsWithChildren) {
  return (
    <TooltipProvider delayDuration={350}>
      {children}
      <Toaster richColors={false} closeButton position="bottom-right" />
    </TooltipProvider>
  )
}

export { UIProvider }
