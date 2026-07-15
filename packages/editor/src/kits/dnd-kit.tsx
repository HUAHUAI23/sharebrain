import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { DndPlugin } from '@platejs/dnd';

import {
  BlockDraggable,
  BlockGutterVisibility,
} from '../ui/block-draggable';

export const DndKit = [
  DndPlugin.configure({
    options: {
      enableScroller: true,
    },
    render: {
      aboveEditable: BlockGutterVisibility,
      aboveNodes: BlockDraggable,
      aboveSlate: ({ children }) => (
        <DndProvider backend={HTML5Backend}>{children}</DndProvider>
      ),
    },
  }),
];
