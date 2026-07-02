import * as React from 'react';

import { PlateElement } from 'platejs/react';

import { cn } from '@sharebrain/ui/lib/utils';

export function CalloutElement({
  attributes,
  children,
  className,
  ...props
}: React.ComponentProps<typeof PlateElement>) {
  return (
    <PlateElement
      className={cn('my-1 flex rounded-sm bg-muted p-4 pl-3', className)}
      style={{
        backgroundColor: props.element.backgroundColor as string | undefined,
      }}
      attributes={{
        ...attributes,
        'data-plate-open-context-menu': true,
      }}
      {...props}
    >
      <div className="flex w-full gap-2 rounded-md">
        <span
          className="flex size-6 select-none items-center justify-center text-[18px]"
          style={{
            fontFamily:
              '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
          }}
          contentEditable={false}
        >
          {(props.element.icon as string | undefined) || '💡'}
        </span>
        <div className="w-full">{children}</div>
      </div>
    </PlateElement>
  );
}
