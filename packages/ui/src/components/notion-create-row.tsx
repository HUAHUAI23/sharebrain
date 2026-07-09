import * as React from "react"
import { LoaderCircle, Plus } from "lucide-react"

import { Input } from "#components/input"
import { cn } from "#lib/utils"

type NotionCreateRowProps = {
  value: string
  onValueChange: (value: string) => void
  onCreate: () => void
  placeholder: string
  ariaLabel: string
  isPending?: boolean
  error?: string | null
  leadingIcon?: React.ReactNode
  compact?: boolean
  className?: string
  inputClassName?: string
  children?: React.ReactNode
}

function NotionCreateRow({
  value,
  onValueChange,
  onCreate,
  placeholder,
  ariaLabel,
  isPending = false,
  error,
  leadingIcon,
  compact = false,
  className,
  inputClassName,
  children,
}: NotionCreateRowProps) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isPending) {
      onCreate()
    }
  }

  const hasFields = React.Children.count(children) > 0

  return (
    <form
      data-slot="notion-create-row"
      data-compact={compact || undefined}
      data-with-fields={hasFields || undefined}
      className={cn(
        "grid min-h-8 grid-cols-[24px_minmax(0,1fr)] items-start gap-x-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent",
        "has-[[data-slot=notion-create-row-fields]]:grid-cols-[24px_minmax(160px,1fr)]",
        compact && "min-h-7 py-0.5",
        className
      )}
      onSubmit={submit}
    >
      <button
        className="inline-flex size-6 items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        type="submit"
        aria-label={ariaLabel}
        disabled={isPending}
      >
        {isPending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          leadingIcon ?? <Plus className="size-3.5" />
        )}
      </button>
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={isPending}
        className={cn(
          "h-6 border-transparent bg-transparent px-1 text-sm hover:bg-transparent focus-visible:bg-background",
          inputClassName
        )}
      />
      {hasFields && (
        <div
          data-slot="notion-create-row-fields"
          className="col-span-2 mt-1 grid gap-2 pl-7 sm:col-span-1 sm:mt-0 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] sm:pl-0"
        >
          {children}
        </div>
      )}
      {error && <div className="col-span-2 px-7 py-1 text-xs leading-5 text-destructive">{error}</div>}
    </form>
  )
}

export { NotionCreateRow, type NotionCreateRowProps }
