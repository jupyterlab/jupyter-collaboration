// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  Annotation,
  EditorSelection,
  Extension,
  Facet
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  layer,
  LayerMarker,
  RectangleMarker,
  ViewPlugin,
  ViewUpdate
} from '@codemirror/view';
import { Awareness } from 'y-protocols/awareness';
import {
  compareRelativePositions,
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromJSON,
  createRelativePositionFromTypeIndex,
  Text
} from 'yjs';

/*
  Add widget to codemirror 6 editors displaying collaboratros.

  This code is inspired by https://github.com/yjs/y-codemirror.next/blob/main/src/y-remote-selections.js licensed under MIT License by Kevin Jahns
 */

/**
 * Yjs document objects
 */
export type EditorAwareness = {
  /**
   * User related information
   */
  awareness: Awareness;
  /**
   * Shared editor source
   */
  ytext: Text;
};

/**
 * Facet storing the Yjs document objects
 */
const editorAwarenessFacet = Facet.define<EditorAwareness, EditorAwareness>({
  combine(configs: readonly EditorAwareness[]) {
    return configs[configs.length - 1];
  }
});

/**
 * Remote selection theme
 */
const remoteSelectionTheme = EditorView.baseTheme({
  '.jp-remote-cursors': {
    'background-color': 'pink'
  }
});

// TODO fix which user needs update
const remoteSelectionsAnnotation = Annotation.define();

const remoteCursorsLayer = layer({
  above: true,
  markers(view) {
    const { awareness, ytext } = view.state.facet(editorAwarenessFacet);
    const ydoc = ytext.doc!;
    const cursors: LayerMarker[] = [];
    awareness.getStates().forEach((state, clientID) => {
      if (clientID === awareness.doc.clientID) {
        return;
      }

      const cursor = state.cursor;
      if (cursor === null || cursor.anchor === null || cursor.head === null) {
        return;
      }

      const anchor = createAbsolutePositionFromRelativePosition(
        cursor.anchor,
        ydoc
      );
      const head = createAbsolutePositionFromRelativePosition(
        cursor.head,
        ydoc
      );
      if (
        anchor === null ||
        head === null ||
        anchor.type !== ytext ||
        head.type !== ytext
      ) {
        return;
      }

      const className = 'jp-remote-cursor';
      const cursor_ = EditorSelection.cursor(
        head.index,
        head.index > anchor.index ? -1 : 1
      );
      for (const piece of RectangleMarker.forRange(view, className, cursor_)) {
        cursors.push(piece);
      }
    });
    return cursors;
  },
  update(update, layer) {
    return !!update.transactions.find(t =>
      t.annotation(remoteSelectionsAnnotation)
    );
  },
  class: 'jp-remote-cursors'
});

const showCollaborators = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    editorAwareness: EditorAwareness;
    _listener: (t: {
      added: Array<any>;
      updated: Array<any>;
      removed: Array<any>;
    }) => void;

    constructor(view: EditorView) {
      this.editorAwareness = view.state.facet(editorAwarenessFacet);
      this.decorations = Decoration.set([]);
      this._listener = ({ added, updated, removed }) => {
        const clients = added.concat(updated).concat(removed);
        if (
          clients.findIndex(
            id => id !== this.editorAwareness.awareness.doc.clientID
          ) >= 0
        ) {
          view.dispatch({ annotations: [remoteSelectionsAnnotation.of([])] });
        }
      };

      this.editorAwareness.awareness.on('change', this._listener);
    }

    destroy(): void {
      this.editorAwareness.awareness.off('change', this._listener);
    }

    /**
     * Communicate the current user cursor position to all remotes
     */
    update(update: ViewUpdate): void {
      if (!update.docChanged && !update.selectionSet) {
        return;
      }

      const { awareness, ytext } = this.editorAwareness;
      const localAwarenessState = awareness.getLocalState();

      // set local awareness state (update cursors)
      if (localAwarenessState !== null) {
        const hasFocus =
          update.view.hasFocus && update.view.dom.ownerDocument.hasFocus();
        const selection = update.state.selection.main;

        if (hasFocus && selection !== null) {
          const currentAnchor =
            localAwarenessState.cursor === null
              ? null
              : createRelativePositionFromJSON(
                  localAwarenessState.cursor.anchor
                );
          const currentHead =
            localAwarenessState.cursor === null
              ? null
              : createRelativePositionFromJSON(localAwarenessState.cursor.head);

          const anchor = createRelativePositionFromTypeIndex(
            ytext,
            selection.anchor
          );
          const head = createRelativePositionFromTypeIndex(
            ytext,
            selection.head
          );
          if (
            localAwarenessState.cursor === null ||
            !compareRelativePositions(currentAnchor, anchor) ||
            !compareRelativePositions(currentHead, head)
          ) {
            awareness.setLocalStateField('cursor', {
              anchor,
              head
            });
          }
        }
      }
    }
  },
  {
    provide: plugin => {
      return [remoteCursorsLayer];
    }
  }
);

export function remoteUserCursors(config: EditorAwareness): Extension {
  return [
    editorAwarenessFacet.of(config),
    remoteSelectionTheme,
    showCollaborators
  ];
}
