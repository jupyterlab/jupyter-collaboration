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
import { User } from '@jupyterlab/services';
import { JSONExt } from '@lumino/coreutils';
import { Awareness } from 'y-protocols/awareness';
import {
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromJSON,
  createRelativePositionFromTypeIndex,
  RelativePosition,
  Text
} from 'yjs';

/*
  Add widget to codemirror 6 editors displaying collaborators.

  This code is inspired by https://github.com/yjs/y-codemirror.next/blob/main/src/y-remote-selections.js licensed under MIT License by Kevin Jahns

  But it uses an approach similar to the draw selection extension of core CodeMirror to display cursors and selections.
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

interface ICursorState {
  anchor: RelativePosition;
  head: RelativePosition;
  /**
   * Whether the cursor is an empty range or not.
   *
   * Default `true`
   */
  empty?: boolean;
  /**
   * Whether the cursor is the primary one or not.
   *
   * Default `false`
   */
  primary?: boolean;
}

interface IAwarenessState extends Record<string, any> {
  user?: User.IIdentity;
  cursors?: ICursorState[];
}

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
  '.jp-remote-cursor': {
    borderLeft: '1px solid black',
    marginLeft: '-1px'
  },
  '.jp-remote-cursor.jp-mod-primary': {
    borderLeftWidth: '2px'
  },
  '.jp-remote-selection': {
    opacity: 0.5
  }
});

// TODO fix which user needs update
const remoteSelectionsAnnotation = Annotation.define();

/**
 * Wrapper around RectangleMarker to be able to set the user color for the remote cursor and selection ranges.
 */
class RemoteMarker implements LayerMarker {
  /**
   * Constructor
   *
   * @param style Specific user style to be applied on the marker element
   * @param marker {@link RectangleMarker} to wrap
   */
  constructor(
    private style: Record<string, string>,
    private marker: RectangleMarker
  ) {}

  draw(): HTMLDivElement {
    const elt = this.marker.draw();
    for (const [key, value] of Object.entries(this.style)) {
      // @ts-expect-error Unknown key
      elt.style[key] = value;
    }
    return elt;
  }

  eq(other: RemoteMarker): boolean {
    return (
      this.marker.eq(other.marker) && JSONExt.deepEqual(this.style, other.style)
    );
  }

  update(dom: HTMLElement, oldMarker: RemoteMarker): boolean {
    for (const [key, value] of Object.entries(this.style)) {
      // @ts-expect-error Unknown key
      dom.style[key] = value;
    }
    return this.marker.update(dom, oldMarker.marker);
  }
}

/**
 * Extension defining a new editor layer storing the remote user cursors
 */
const remoteCursorsLayer = layer({
  above: true,
  markers(view) {
    const { awareness, ytext } = view.state.facet(editorAwarenessFacet);
    const ydoc = ytext.doc!;
    const cursors: LayerMarker[] = [];
    awareness.getStates().forEach((state: IAwarenessState, clientID) => {
      if (clientID === awareness.doc.clientID) {
        return;
      }

      const cursors_ = state.cursors;
      for (const cursor of cursors_ ?? []) {
        if (!cursor?.anchor || !cursor?.head) {
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
        if (anchor?.type !== ytext || head?.type !== ytext) {
          return;
        }

        const className =
          cursor.primary ?? true
            ? 'jp-remote-cursor jp-mod-primary'
            : 'jp-remote-cursor';
        const cursor_ = EditorSelection.cursor(
          head.index,
          head.index > anchor.index ? -1 : 1
        );
        for (const piece of RectangleMarker.forRange(
          view,
          className,
          cursor_
        )) {
          // Wrap the rectangle marker to set the user color
          cursors.push(
            new RemoteMarker(
              { borderLeftColor: state.user?.color ?? 'black' },
              piece
            )
          );
        }
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

/**
 * Extension defining a new editor layer storing the remote selections
 */
const remoteSelectionLayer = layer({
  above: false,
  markers(view) {
    const { awareness, ytext } = view.state.facet(editorAwarenessFacet);
    const ydoc = ytext.doc!;
    const cursors: LayerMarker[] = [];
    awareness.getStates().forEach((state: IAwarenessState, clientID) => {
      if (clientID === awareness.doc.clientID) {
        return;
      }

      const cursors_ = state.cursors;
      for (const cursor of cursors_ ?? []) {
        if ((cursor.empty ?? true) || !cursor?.anchor || !cursor?.head) {
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
        if (anchor?.type !== ytext || head?.type !== ytext) {
          return;
        }

        const className = 'jp-remote-selection';
        for (const piece of RectangleMarker.forRange(
          view,
          className,
          EditorSelection.range(anchor.index, head.index)
        )) {
          // Wrap the rectangle marker to set the user color
          cursors.push(
            new RemoteMarker(
              { backgroundColor: state.user?.color ?? 'black' },
              piece
            )
          );
        }
      }
    });
    return cursors;
  },
  update(update, layer) {
    return !!update.transactions.find(t =>
      t.annotation(remoteSelectionsAnnotation)
    );
  },
  class: 'jp-remote-selections'
});

/**
 * CodeMirror extension exchanging and displaying remote user selection ranges (including cursors)
 */
const showCollaborators = ViewPlugin.fromClass(
  class {
    editorAwareness: EditorAwareness;
    _listener: (t: {
      added: Array<any>;
      updated: Array<any>;
      removed: Array<any>;
    }) => void;

    constructor(view: EditorView) {
      this.editorAwareness = view.state.facet(editorAwarenessFacet);
      this._listener = ({ added, updated, removed }) => {
        const clients = added.concat(updated).concat(removed);
        if (
          clients.findIndex(
            id => id !== this.editorAwareness.awareness.doc.clientID
          ) >= 0
        ) {
          // Trick to get the remoteCursorLayers to be updated
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
      const localAwarenessState =
        awareness.getLocalState() as IAwarenessState | null;

      // set local awareness state (update cursors)
      if (localAwarenessState) {
        const hasFocus =
          update.view.hasFocus && update.view.dom.ownerDocument.hasFocus();
        const selection = update.state.selection;
        const cursors = new Array<ICursorState>();

        if (hasFocus && selection) {
          for (const r of selection.ranges) {
            const primary = r === selection.main;
            const anchor = createRelativePositionFromTypeIndex(ytext, r.anchor);
            const head = createRelativePositionFromTypeIndex(ytext, r.head);

            cursors.push({
              anchor,
              head,
              primary,
              empty: r.empty
            });
          }

          if (!localAwarenessState.cursors || cursors.length > 0) {
            const oldCursors = localAwarenessState.cursors?.map(cursor => {
              return {
                ...cursor,
                anchor: cursor?.anchor
                  ? createRelativePositionFromJSON(cursor.anchor)
                  : null,
                head: cursor?.head
                  ? createRelativePositionFromJSON(cursor.head)
                  : null
              };
            });
            if (!JSONExt.deepEqual(cursors as any, oldCursors as any)) {
              // Update cursors
              awareness.setLocalStateField('cursors', cursors);
            }
          }
        }
      }
    }
  },
  {
    provide: plugin => {
      return [remoteSelectionTheme, remoteCursorsLayer, remoteSelectionLayer];
    }
  }
);

export function remoteUserCursors(config: EditorAwareness): Extension {
  return [editorAwarenessFacet.of(config), showCollaborators];
}
