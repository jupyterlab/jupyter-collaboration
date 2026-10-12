// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  Annotation,
  EditorSelection,
  EditorState,
  Extension,
  Facet,
  StateField
} from '@codemirror/state';
import {
  EditorView,
  hoverTooltip,
  layer,
  LayerMarker,
  RectangleMarker,
  showTooltip,
  Tooltip,
  tooltips,
  TooltipView,
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
  Doc,
  RelativePosition,
  Text,
  Transaction
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

export interface ICursorState {
  /**
   * Cursor anchor
   */
  anchor: RelativePosition;
  /**
   * Cursor head
   */
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

/**
 * Awareness state definition
 */
export interface IAwarenessState extends Record<string, any> {
  /**
   * User identity
   */
  user?: User.IIdentity;
  /**
   * User cursors
   */
  cursors?: ICursorState[];
}

/**
 * Facet storing the Yjs document objects
 */
export const editorAwarenessFacet = Facet.define<
  EditorAwareness,
  EditorAwareness
>({
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
    marginLeft: '-1px',
    pointerEvents: 'none'
  },
  '.jp-remote-cursor.jp-mod-primary': {
    borderLeftWidth: '2px'
  },
  '.jp-remote-selection': {
    opacity: 0.5
  },
  '.cm-tooltip': {
    border: 'none'
  },
  '.cm-tooltip.jp-remote-userFlag-host': {
    background: 'none'
  }
});

// TODO fix which user needs update
const remoteSelectionsAnnotation = Annotation.define();

/**
 * How long a collaborator flag stays visible after their last edit.
 */
const FLAG_IDLE_MS = 2000;

/**
 * CodeMirror matches tooltips by `create` identity, so keep one per client.
 */
type Collaborator = {
  at: number;
  user?: User.IIdentity;
  create?: () => TooltipView;
};

const collaborators = new WeakMap<Awareness, Map<number, Collaborator>>();

function collaborator(awareness: Awareness, clientID: number): Collaborator {
  let byClient = collaborators.get(awareness);
  if (!byClient) {
    byClient = new Map();
    collaborators.set(awareness, byClient);
  }
  let entry = byClient.get(clientID);
  if (!entry) {
    entry = { at: 0 };
    byClient.set(clientID, entry);
  }
  return entry;
}

function markActive(awareness: Awareness, clientIDs: Iterable<number>): void {
  const now = Date.now();
  for (const clientID of clientIDs) {
    collaborator(awareness, clientID).at = now;
  }
}

function isFlagVisible(awareness: Awareness, clientID: number): boolean {
  return Date.now() - collaborator(awareness, clientID).at < FLAG_IDLE_MS;
}

const editTrackedDocs = new WeakSet<Doc>();

/**
 * Mark edit authors from the Yjs clocks; awareness misses end-of-line typing.
 */
function trackRemoteEdits(awareness: Awareness, ydoc: Doc): void {
  if (editTrackedDocs.has(ydoc)) {
    return;
  }
  editTrackedDocs.add(ydoc);
  // Before the observers, so the flag is up when the edit reaches the editor.
  ydoc.on('beforeObserverCalls', (tr: Transaction) => {
    const authors: number[] = [];
    tr.afterState.forEach((clock, clientID) => {
      if (
        clientID !== ydoc.clientID &&
        tr.beforeState.get(clientID) !== clock
      ) {
        authors.push(clientID);
      }
    });
    if (authors.length > 0) {
      markActive(awareness, authors);
    }
  });
}

/**
 * Build the avatar and name badge shown for a collaborator.
 *
 * @param user The collaborator identity, if known
 * @returns The badge element
 */
export function collaboratorPill(
  user: User.IIdentity | undefined
): HTMLDivElement {
  const dom = document.createElement('div');
  dom.className = 'jp-remote-userFlag';
  renderPill(dom, user);
  return dom;
}

function renderPill(dom: HTMLElement, user: User.IIdentity | undefined): void {
  dom.replaceChildren();
  dom.style.borderColor = user?.color ?? 'darkgrey';

  const avatar = document.createElement('div');
  avatar.className = 'jp-remote-userFlag-avatar';
  if (user?.avatar_url) {
    const img = document.createElement('img');
    img.src = user.avatar_url;
    img.alt = '';
    img.onerror = () => {
      avatar.style.backgroundColor = user.color ?? 'darkgrey';
      avatar.textContent = user.initials ?? '';
    };
    avatar.appendChild(img);
  } else {
    avatar.style.backgroundColor = user?.color ?? 'darkgrey';
    avatar.textContent = user?.initials ?? '';
  }

  const name = document.createElement('span');
  name.className = 'jp-remote-userFlag-name';
  name.textContent = user?.display_name ?? 'Anonymous';
  dom.append(avatar, name);
}

function drawFlag(awareness: Awareness, clientID: number): TooltipView {
  const entry = collaborator(awareness, clientID);
  const dom = collaboratorPill(entry.user);
  let shown = entry.user;
  const sync = () => {
    if (!JSONExt.deepEqual({ ...shown } as any, { ...entry.user } as any)) {
      shown = entry.user;
      renderPill(dom, shown);
    }
    dom.classList.toggle('jp-mod-idle', !isFlagVisible(awareness, clientID));
  };
  sync();
  return { dom, update: sync };
}

function flagCreator(
  awareness: Awareness,
  clientID: number
): () => TooltipView {
  const entry = collaborator(awareness, clientID);
  return (entry.create ??= () => drawFlag(awareness, clientID));
}

function collaboratorFlags(state: EditorState): readonly Tooltip[] {
  const { awareness, ytext } = state.facet(editorAwarenessFacet);
  const ydoc = ytext.doc;
  if (!ydoc) {
    return [];
  }
  const flags: Tooltip[] = [];
  awareness.getStates().forEach((remote: IAwarenessState, clientID) => {
    if (clientID === awareness.doc.clientID) {
      return;
    }
    const cursor = remote.cursors?.find(c => c.primary ?? true);
    if (!cursor?.head) {
      return;
    }
    const head = createAbsolutePositionFromRelativePosition(cursor.head, ydoc);
    if (head?.type !== ytext) {
      return;
    }
    collaborator(awareness, clientID).user = remote.user;
    flags.push({
      pos: Math.min(head.index, state.doc.length),
      above: true,
      create: flagCreator(awareness, clientID)
    });
  });
  return flags;
}

/**
 * Extension showing a fading name flag above each remote cursor
 */
const remoteCursorFlags = StateField.define<readonly Tooltip[]>({
  create: collaboratorFlags,
  update(flags, tr) {
    return tr.docChanged ||
      tr.annotation(remoteSelectionsAnnotation) !== undefined
      ? collaboratorFlags(tr.state)
      : flags;
  },
  provide: field => showTooltip.computeN([field], state => state.field(field))
});

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
    const ydoc = ytext.doc;
    if (!ydoc) {
      return [];
    }
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
 * Tooltip extension to display user display name at cursor position
 */
const userHover = hoverTooltip(
  (view, pos) => {
    const { awareness, ytext } = view.state.facet(editorAwarenessFacet);
    const ydoc = ytext.doc;
    if (!ydoc) {
      return null;
    }

    for (const [clientID, state] of awareness.getStates()) {
      if (clientID === awareness.doc.clientID) {
        continue;
      }

      if (isFlagVisible(awareness, clientID)) {
        continue;
      }

      for (const cursor of state.cursors ?? []) {
        if (!cursor?.head) {
          continue;
        }
        const head = createAbsolutePositionFromRelativePosition(
          cursor.head,
          ydoc
        );
        if (head?.type !== ytext) {
          continue;
        }
        // Use some margin around the cursor to display the user.
        const index = Math.min(head.index, view.state.doc.length);
        if (index - 3 <= pos && pos <= index + 3) {
          return {
            pos: index,
            above: true,
            create: () => {
              const dom = collaboratorPill((state as IAwarenessState).user);
              return {
                dom,
                overlap: true,
                mount: () =>
                  dom.parentElement?.classList.add('jp-remote-userFlag-host')
              };
            }
          };
        }
      }
    }

    return null;
  },
  {
    hideOn: (tr, tooltip) => !!tr.annotation(remoteSelectionsAnnotation),
    hoverTime: 1
  }
);

/**
 * Extension defining a new editor layer storing the remote selections
 */
const remoteSelectionLayer = layer({
  above: false,
  markers(view) {
    const { awareness, ytext } = view.state.facet(editorAwarenessFacet);
    const ydoc = ytext.doc;
    if (!ydoc) {
      return [];
    }
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
    _fadeTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(view: EditorView) {
      this.editorAwareness = view.state.facet(editorAwarenessFacet);
      this._listener = ({ added, updated, removed }) => {
        const { awareness } = this.editorAwareness;
        const clients = added
          .concat(updated)
          .concat(removed)
          .filter(id => id !== awareness.doc.clientID);
        if (clients.length > 0) {
          markActive(awareness, clients);
          // Trick to get the remoteCursorLayers to be updated
          view.dispatch({ annotations: [remoteSelectionsAnnotation.of([])] });
          this.scheduleFade(view);
        }
      };

      const ydoc = this.editorAwareness.ytext.doc;
      if (ydoc) {
        trackRemoteEdits(this.editorAwareness.awareness, ydoc);
      }

      this.editorAwareness.awareness.on('change', this._listener);
    }

    scheduleFade(view: EditorView): void {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = setTimeout(() => {
        view.dispatch({ annotations: [remoteSelectionsAnnotation.of([])] });
      }, FLAG_IDLE_MS + 50);
    }

    destroy(): void {
      clearTimeout(this._fadeTimer);
      this.editorAwareness.awareness.off('change', this._listener);
    }

    /**
     * Communicate the current user cursor position to all remotes
     */
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.scheduleFade(update.view);
      }

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
    provide: () => {
      return [
        remoteSelectionTheme,
        remoteCursorsLayer,
        remoteSelectionLayer,
        remoteCursorFlags,
        userHover,
        // As we use relative positioning of widget, the tooltip must be positioned absolutely
        // And we attach the tooltip to the body to avoid overflow rules
        tooltips({ position: 'absolute', parent: document.body })
      ];
    }
  }
);

/**
 * CodeMirror extension to display remote users cursors
 *
 * @param config Editor source and awareness
 * @returns CodeMirror extension
 */
export function remoteUserCursors(config: EditorAwareness): Extension {
  return [editorAwarenessFacet.of(config), showCollaborators];
}
