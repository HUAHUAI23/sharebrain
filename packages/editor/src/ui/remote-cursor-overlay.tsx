
// 渲染 Yjs 远程光标；没有远程参与者时不测量长文档容器布局。
import * as React from 'react';

import { YjsPlugin } from '@platejs/yjs/react';
import {
  type CursorOverlayData,
  useRemoteCursorOverlayPositions,
  useRemoteCursorStates,
} from '@slate-yjs/react';
import { useEditorContainerRef, usePluginOption } from 'platejs/react';

export function RemoteCursorOverlay() {
  const isSynced = usePluginOption(YjsPlugin, '_isSynced');
  const cursors = useRemoteCursorStates<CursorData>();

  if (!isSynced || Object.keys(cursors).length === 0) {
    return null;
  }

  return <RemoteCursorOverlayContent />;
}

function RemoteCursorOverlayContent() {
  const containerRef =
    useEditorContainerRef() as React.RefObject<HTMLDivElement>;
  const [cursors] = useRemoteCursorOverlayPositions<CursorData>({
    containerRef,
  });

  return (
    <>
      {cursors.map((cursor) => (
        <RemoteSelection key={cursor.clientId} {...cursor} />
      ))}
    </>
  );
}

function RemoteSelection({
  caretPosition,
  data,
  selectionRects,
}: CursorOverlayData<CursorData>) {
  if (!data) {
    return null;
  }

  const selectionStyle: React.CSSProperties = {
    // Add a opacity to the background color
    backgroundColor: addAlpha(data.color, 0.5),
  };

  return (
    <>
      {selectionRects.map((position, i) => (
        <div
          key={i}
          className="pointer-events-none absolute"
          style={{ ...selectionStyle, ...position }}
        />
      ))}
      {caretPosition && <Caret data={data} caretPosition={caretPosition} />}
    </>
  );
}

export type CursorData = {
  color: string;
  name: string;
};

const cursorOpacity = 0.7;
const hoverOpacity = 1;

function Caret({
  caretPosition,
  data,
}: Pick<CursorOverlayData<CursorData>, 'caretPosition' | 'data'>) {
  const [isHover, setIsHover] = React.useState(false);

  const handleMouseEnter = () => {
    setIsHover(true);
  };
  const handleMouseLeave = () => {
    setIsHover(false);
  };
  const caretStyle: React.CSSProperties = {
    ...caretPosition,
    background: data?.color,
    opacity: cursorOpacity,
    transition: 'opacity 0.2s',
  };
  const caretStyleHover = { ...caretStyle, opacity: hoverOpacity };

  const labelStyle: React.CSSProperties = {
    background: data?.color,
    opacity: cursorOpacity,
    transform: 'translateY(-100%)',
    transition: 'opacity 0.2s',
  };
  const labelStyleHover = { ...labelStyle, opacity: hoverOpacity };

  return (
    <div
      className="absolute w-0.5"
      style={isHover ? caretStyleHover : caretStyle}
    >
      <div
        className="absolute top-0 whitespace-nowrap rounded rounded-bl-none px-1.5 py-0.5 text-white text-xs"
        style={isHover ? labelStyleHover : labelStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {data?.name}
      </div>
    </div>
  );
}

function addAlpha(hexColor: string, opacity: number): string {
  const normalized = Math.round(Math.min(Math.max(opacity, 0), 1) * 255);

  return hexColor + normalized.toString(16).padStart(2, '0').toUpperCase();
}
