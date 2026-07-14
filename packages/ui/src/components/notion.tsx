import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "#lib/utils"

type NotionIconProps = React.ComponentProps<"span"> & {
  size?: "sm" | "md" | "lg"
}

function NotionIcon({ className, size = "sm", ...props }: NotionIconProps) {
  return (
    <span
      data-slot="notion-icon"
      data-size={size}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-accent font-semibold text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]",
        size === "sm" && "size-6 text-xs",
        size === "md" && "size-[38px] text-[17px]",
        size === "lg" && "size-[46px] text-[17px]",
        className
      )}
      {...props}
    />
  )
}

function NotionText({
  className,
  titleClassName,
  descriptionClassName,
  title,
  description,
  ...props
}: React.ComponentProps<"span"> & {
  titleClassName?: string
  descriptionClassName?: string
  title: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <span className={cn("grid min-w-0 gap-px", className)} {...props}>
      <strong className={cn("truncate text-[13px] leading-tight font-semibold", titleClassName)}>
        {title}
      </strong>
      {description ? (
        <small className={cn("truncate text-xs leading-snug font-normal text-muted-foreground", descriptionClassName)}>
          {description}
        </small>
      ) : null}
    </span>
  )
}

function NotionList({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "div"

  return <Comp data-slot="notion-list" className={cn("grid gap-px", className)} {...props} />
}

function NotionListRow({
  className,
  active = false,
  asChild = false,
  clickable,
  ...props
}: React.ComponentProps<"div"> & {
  active?: boolean
  asChild?: boolean
  clickable?: boolean
}) {
  const Comp = asChild ? Slot.Root : "div"
  const isClickable = clickable ?? asChild

  return (
    <Comp
      data-slot="notion-list-row"
      data-active={active || undefined}
      data-clickable={isClickable || undefined}
      className={cn(
        "grid min-h-8 items-center gap-2 rounded-md text-left text-sm text-foreground transition-colors",
        "data-[clickable=true]:cursor-pointer data-[clickable=true]:border-0 data-[clickable=true]:bg-transparent data-[clickable=true]:font-inherit data-[clickable=true]:hover:bg-accent",
        "data-[active=true]:bg-accent data-[active=true]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function NotionEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="notion-empty"
      className={cn("px-2 py-1.5 text-[13px] text-muted-foreground", className)}
      {...props}
    />
  )
}

function NotionSectionHeading({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="notion-section-heading"
      className={cn("flex items-center gap-2 px-0.5 text-muted-foreground", className)}
      {...props}
    />
  )
}

function NotionToolbar({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="notion-toolbar"
      className={cn(
        "sticky top-0 z-10 flex min-h-[42px] items-center gap-2 bg-[color-mix(in_oklab,var(--background)_96%,transparent)] px-2.5 py-1.5",
        className
      )}
      {...props}
    />
  )
}

function NotionSegmentedControl({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="notion-segmented-control"
      className={cn("inline-flex max-w-full rounded-md bg-muted p-0.5", className)}
      {...props}
    />
  )
}

function NotionSegmentedButton({
  className,
  active = false,
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-slot="notion-segmented-button"
      data-active={active || undefined}
      className={cn(
        "rounded-sm border-0 bg-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground data-[active=true]:bg-background data-[active=true]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  NotionEmpty,
  NotionIcon,
  NotionList,
  NotionListRow,
  NotionSectionHeading,
  NotionSegmentedButton,
  NotionSegmentedControl,
  NotionText,
  NotionToolbar,
}
