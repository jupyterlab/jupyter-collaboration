/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * Helpers for reconciling a local shared document with a new document
 * session, after the server room's Yjs history diverged from the local one
 * (server restart without a persisted YStore, out-of-band file change while
 * the room was evicted, YStore deletion/corruption).
 *
 * The strategy follows the plan from
 * https://github.com/jupyterlab/jupyter-collaboration/issues/597: the local
 * Yjs history is discarded (all ordered content is tombstoned so that
 * resynchronization contributes tombstones only) and, when safe, the local
 * content is re-applied on top of the new session as fresh semantic edits.
 */

import type * as nbformat from '@jupyterlab/nbformat';
import { JSONExt } from '@lumino/coreutils';
import * as Y from 'yjs';

import type { DocumentChange, ISharedNotebook, YDocument } from '@jupyter/ydoc';

/**
 * Normalize an nbformat multiline string.
 *
 * @param source - The nbformat source, either a string or a list of lines.
 * @returns The source joined into a single string.
 *
 * #### Notes
 * Candidate for upstreaming to `@jupyter/ydoc` together with
 * {@link applyNotebookContent}: the Python `jupyter_ydoc` normalizes
 * multiline sources the same way when merging content in `YNotebook._set`.
 */
export function normalizeMultiline(source: unknown): string {
  if (Array.isArray(source)) {
    return source.join('');
  }
  if (typeof source === 'string') {
    return source;
  }
  return source === null || source === undefined ? '' : String(source);
}

/**
 * Cell keys which do not round-trip between the shared model and the file
 * on disk and must be ignored when comparing content.
 */
const TRANSIENT_CELL_KEYS = new Set(['execution_state']);

function normalizeOutput(output: any): any {
  const normalized: any = { ...output };
  if ('text' in normalized) {
    normalized.text = normalizeMultiline(normalized.text);
  }
  if (normalized.data && typeof normalized.data === 'object') {
    const data: any = {};
    for (const key of Object.keys(normalized.data)) {
      const value = normalized.data[key];
      data[key] = Array.isArray(value) ? value.join('') : value;
    }
    normalized.data = data;
  }
  return normalized;
}

function normalizeCell(cell: any): any {
  const normalized: any = {};
  for (const key of Object.keys(cell ?? {})) {
    if (TRANSIENT_CELL_KEYS.has(key)) {
      continue;
    }
    normalized[key] = cell[key];
  }
  normalized.source = normalizeMultiline(cell?.source);
  normalized.metadata = cell?.metadata ?? {};
  if (cell?.cell_type === 'code') {
    normalized.execution_count = cell?.execution_count ?? null;
    normalized.outputs = (cell?.outputs ?? []).map(normalizeOutput);
  }
  return normalized;
}

/**
 * Normalize notebook JSON for comparison between the shared model
 * (`YNotebook.getSource()`) and the REST contents API model.
 *
 * @param content - The notebook content in nbformat JSON.
 * @returns The normalized notebook structure.
 *
 * #### Notes
 * Candidate for upstreaming to `@jupyter/ydoc` together with
 * {@link applyNotebookContent}, e.g. as a `YNotebook.equals(nbformat JSON)`
 * or a static `YNotebook.normalize(content)` helper, so that semantic
 * content comparison and semantic merging share one normalization.
 */
export function normalizeNotebook(content: any): any {
  return {
    nbformat: content?.nbformat,
    nbformat_minor: content?.nbformat_minor,
    metadata: content?.metadata ?? {},
    cells: (content?.cells ?? []).map(normalizeCell)
  };
}

/**
 * Whether local and server content are semantically identical.
 *
 * @param local - The local document content.
 * @param server - The server document content.
 * @param contentType - The document content type (e.g. `'notebook'`).
 * @returns Whether the two contents are semantically identical.
 */
export function contentsEqual(
  local: unknown,
  server: unknown,
  contentType: string
): boolean {
  if (contentType === 'notebook') {
    return JSONExt.deepEqual(
      normalizeNotebook(local),
      normalizeNotebook(server)
    );
  }
  if (typeof local === 'string' && typeof server === 'string') {
    return local.replace(/\r\n/g, '\n') === server.replace(/\r\n/g, '\n');
  }
  return JSONExt.deepEqual(local as any, server as any);
}

/**
 * Tombstone all ordered content of the document's top-level shared types.
 *
 * After this, resynchronizing with a room holding a different history
 * lineage contributes only tombstones (deletions of items the new lineage
 * has never seen), so it can neither duplicate content nor delete anything
 * live in the new room. Key-based types (`Y.Map`) are intentionally left
 * untouched: they converge last-writer-wins and cannot duplicate, while
 * deleting a map key whose winning item is the local one would make the key
 * read as absent rather than fall back to the remote value (see the
 * analysis in jupyter-ai-contrib/jupyter-server-documents#254).
 *
 * @param ydoc - The Yjs document to clear.
 * @param origin - The Yjs transaction origin.
 */
export function clearOrderedSharedTypes(ydoc: Y.Doc, origin: unknown): void {
  ydoc.transact(() => {
    for (const [, type] of ydoc.share) {
      if (type instanceof Y.Map) {
        continue;
      }
      if (type instanceof Y.Array) {
        type.delete(0, type.length);
      } else if (type instanceof Y.Text) {
        // Also covers Y.XmlText which extends Y.Text.
        type.delete(0, type.length);
      } else if (type instanceof Y.XmlFragment) {
        type.delete(0, type.length);
      }
    }
  }, origin);
}

/**
 * Clear the local content in preparation for adopting a new document
 * session (see {@link clearOrderedSharedTypes}).
 *
 * For notebooks, a placeholder cell is inserted in the same transaction:
 * the notebook widget automatically inserts a default cell whenever the
 * cells array becomes empty, and that spurious cell would otherwise be
 * synchronized into the new session as real content. The placeholder must
 * be removed with {@link removePlaceholderCell} once the new session's
 * content has been received.
 *
 * @param sharedModel - The shared document to clear.
 * @param contentType - The document content type.
 * @param origin - The Yjs transaction origin.
 * @returns The id of the placeholder cell, if one was inserted.
 */
export function clearForAdoption(
  sharedModel: YDocument<DocumentChange>,
  contentType: string,
  origin: unknown
): string | null {
  let placeholderId: string | null = null;
  sharedModel.ydoc.transact(() => {
    clearOrderedSharedTypes(sharedModel.ydoc, origin);
    if (contentType === 'notebook') {
      placeholderId = `rebase-placeholder-${Date.now().toString(
        36
      )}-${Math.random().toString(36).slice(2)}`;
      (sharedModel as unknown as ISharedNotebook).insertCell(0, {
        cell_type: 'raw',
        id: placeholderId,
        source: ''
      });
    }
  }, origin);
  return placeholderId;
}

/**
 * Remove the placeholder cell inserted by {@link clearForAdoption}.
 *
 * @param sharedModel - The shared document holding the placeholder.
 * @param placeholderId - The id of the placeholder cell.
 */
export function removePlaceholderCell(
  sharedModel: YDocument<DocumentChange>,
  placeholderId: string
): void {
  const notebook = sharedModel as unknown as ISharedNotebook;
  for (let index = notebook.cells.length - 1; index >= 0; index--) {
    if (notebook.getCell(index).getId() === placeholderId) {
      notebook.deleteCell(index);
    }
  }
}

function toCellModel(cell: any): any {
  // `insertCell` preserves a provided id, so re-applied cells keep their
  // nbformat identity even though they are re-created as fresh Yjs items.
  return JSONExt.deepCopy(cell);
}

function updateCellInPlace(ycell: any, cell: any): boolean {
  if (ycell.cell_type !== cell.cell_type) {
    return false;
  }
  const source = normalizeMultiline(cell.source);
  if (ycell.getSource() !== source) {
    ycell.setSource(source);
  }
  const metadata = cell.metadata ?? {};
  if (!JSONExt.deepEqual(ycell.getMetadata() ?? {}, metadata)) {
    ycell.setMetadata(metadata);
  }
  if (cell.cell_type === 'code') {
    const executionCount = cell.execution_count ?? null;
    if ((ycell.execution_count ?? null) !== executionCount) {
      ycell.execution_count = executionCount;
    }
    const outputs = cell.outputs ?? [];
    if (
      !JSONExt.deepEqual(
        (ycell.getOutputs?.() ?? []).map(normalizeOutput),
        outputs.map(normalizeOutput)
      )
    ) {
      ycell.setOutputs(outputs);
    }
  } else if (typeof ycell.setAttachments === 'function') {
    const attachments = cell.attachments;
    if (!JSONExt.deepEqual(ycell.getAttachments() ?? {}, attachments ?? {})) {
      ycell.setAttachments(attachments);
    }
  }
  return true;
}

/**
 * Apply target notebook content onto the shared notebook with cell-granular
 * operations, so that unchanged cells keep their identity (no spurious
 * re-rendering, cursor or scroll resets beyond the affected cells).
 *
 * Cells are matched by their nbformat `id`; when any target cell lacks an
 * id (nbformat < 4.5) the whole content is applied via `fromJSON` instead.
 *
 * @param notebook - The shared notebook to update.
 * @param target - The target notebook content in nbformat JSON.
 *
 * #### Notes
 * Candidate for upstreaming to `@jupyter/ydoc`: this is a JS port of the
 * granular merge which the Python `jupyter_ydoc` performs in
 * `YNotebook._set` (jupyter-server/jupyter_ydoc#355 and follow-ups) and
 * which currently has no JS counterpart: the JS `fromJSON` is destructive
 * (deletes and re-creates every cell). A natural upstream API shape would
 * be an option on the existing entry point,
 * `YNotebook.fromJSON(value, options?: { granular?: boolean })`, or a
 * dedicated `YNotebook.mergeJSON(value, options?)` with `undoable`/`origin`
 * options mirroring `YDocument.transact`, so that out-of-band reloads and
 * conflict rebases avoid full re-renders on the frontend the same way the
 * server already does. The cell-id matching here also overlaps with the
 * LCS matcher in the extension's `ConflictDiffWidget`; a shared upstream
 * matcher could serve both. (Until such an API is released and the
 * `@jupyter/ydoc` version floor is raised, this local implementation is
 * required.)
 */
export function applyNotebookContent(
  notebook: ISharedNotebook,
  target: nbformat.INotebookContent
): void {
  const targetCells: any[] = target.cells ?? [];
  if (targetCells.some(cell => !cell.id)) {
    notebook.fromJSON(target);
    return;
  }

  notebook.transact(() => {
    if (
      !JSONExt.deepEqual(notebook.getMetadata() ?? {}, target.metadata ?? {})
    ) {
      notebook.setMetadata(target.metadata ?? {});
    }
    if (target.nbformat && notebook.nbformat !== target.nbformat) {
      // Read-only on the interface, but writable on YNotebook.
      (notebook as any).nbformat = target.nbformat;
    }
    if (
      target.nbformat_minor !== undefined &&
      target.nbformat_minor !== null &&
      notebook.nbformat_minor !== target.nbformat_minor
    ) {
      (notebook as any).nbformat_minor = target.nbformat_minor;
    }

    // The shared notebook's cell list is a plain array refreshed by an
    // observer which only runs once the transaction commits, so `cells`,
    // `getCell` and `moveCell` (which reads a cell to clone it) all see the
    // state as it was *before* this transaction. Everything below therefore
    // reads the notebook exactly once, up front, and tracks the effect of
    // its own operations in `order`; `_ycells` itself is live, so the
    // indices computed from `order` address the right cells.
    const existing = new Map<string, any>();
    const order: string[] = [];
    for (const cell of notebook.cells) {
      const id = cell.getId();
      existing.set(id, cell);
      order.push(id);
    }

    // Update the cells the target keeps, while their indices still hold.
    const retyped = new Set<string>();
    for (const targetCell of targetCells) {
      const cell = existing.get(targetCell.id);
      if (cell && !updateCellInPlace(cell, targetCell)) {
        // The cell type changed: it has to be replaced wholesale below.
        retyped.add(targetCell.id);
      }
    }

    const targetIds = new Set(targetCells.map(cell => cell.id));
    // Delete local cells the target does not keep.
    for (let index = order.length - 1; index >= 0; index--) {
      const id = order[index];
      if (!targetIds.has(id) || retyped.has(id)) {
        notebook.deleteCell(index);
        order.splice(index, 1);
      }
    }

    // Bring the remaining cells into the target order, inserting the
    // missing ones at their final position.
    for (let index = 0; index < targetCells.length; index++) {
      const targetCell = targetCells[index];
      const found = order.indexOf(targetCell.id, index);
      if (found === index) {
        continue;
      }
      if (found > index) {
        // Moving a cell re-creates it anyway (`moveCells` clones), so this
        // costs no identity that a move would have preserved.
        notebook.deleteCell(found);
        order.splice(found, 1);
      }
      notebook.insertCell(index, toCellModel(targetCell));
      order.splice(index, 0, targetCell.id);
    }

    // Any trailing cells left beyond the target length would have been
    // deleted above (their ids are not in the target), but guard anyway.
    if (order.length > targetCells.length) {
      notebook.deleteCellRange(targetCells.length, order.length);
    }
  }, false);
}

/**
 * Apply target content onto a shared document of any supported type.
 *
 * @param sharedModel - The shared document to update.
 * @param target - The target content.
 * @param contentType - The document content type.
 */
export function applyContent(
  sharedModel: YDocument<DocumentChange>,
  target: unknown,
  contentType: string
): void {
  if (contentType === 'notebook') {
    applyNotebookContent(
      sharedModel as unknown as ISharedNotebook,
      target as nbformat.INotebookContent
    );
    return;
  }
  sharedModel.setSource(
    typeof target === 'string' ? target : JSON.stringify(target)
  );
}

/**
 * Restore the values which {@link clearForAdoption} cannot carry over.
 *
 * @param sharedModel - The shared document which adopted a new session.
 * @param target - The authoritative content (as loaded from the server).
 * @param hash - The hash of the file the target content comes from.
 * @param contentType - The document content type.
 *
 * #### Notes
 * The adoption deliberately leaves `Y.Map` keys alone (see
 * {@link clearOrderedSharedTypes}), so after resynchronizing, a key set in
 * the discarded lineage still competes with the value of the new one, and
 * Yjs resolves that by client id - a coin flip which the stale value wins
 * half of the time, after which it is saved back to disk. Rewriting the
 * authoritative values here settles it: a write made after synchronizing is
 * causally later than both, so it wins for every client.
 */
export function reassertAuthoritativeState(
  sharedModel: YDocument<DocumentChange>,
  target: unknown,
  hash: string | null,
  contentType: string
): void {
  sharedModel.transact(() => {
    if (hash) {
      // A stale hash would misclassify the *next* reconciliation, making it
      // treat an out-of-band change as this client's unsaved edits.
      sharedModel.setState('hash', hash);
    }
    if (contentType !== 'notebook') {
      return;
    }
    const notebook = sharedModel as unknown as ISharedNotebook;
    const content = (target ?? {}) as nbformat.INotebookContent;
    const metadata = content.metadata ?? {};
    if (!JSONExt.deepEqual(notebook.getMetadata() ?? {}, metadata)) {
      notebook.setMetadata(metadata);
    }
    if (content.nbformat && notebook.nbformat !== content.nbformat) {
      (notebook as any).nbformat = content.nbformat;
    }
    if (
      content.nbformat_minor !== undefined &&
      content.nbformat_minor !== null &&
      notebook.nbformat_minor !== content.nbformat_minor
    ) {
      (notebook as any).nbformat_minor = content.nbformat_minor;
    }
  }, false);
}

/**
 * The ids of the notebook cells of given content.
 *
 * @param content - The document content.
 * @returns The set of cell ids, or `null` for non-notebook content and for
 *   content whose cells are not all identifiable.
 */
export function cellIdSet(content: any): Set<string> | null {
  if (!content || !Array.isArray(content.cells)) {
    return null;
  }
  const cells: any[] = content.cells;
  if (cells.some(cell => !cell?.id)) {
    // nbformat < 4.5: ids cannot identify cells, and collapsing them into a
    // set would make unrelated notebooks look like the same one.
    return null;
  }
  return new Set(cells.map((cell: any) => String(cell.id)));
}

/**
 * Whether the shared document has settled on the given base content: equal
 * content for plain documents, or matching cell-id sets for notebooks
 * (tolerant to concurrent in-cell edits by other clients while still
 * detecting that progressive loading has completed).
 *
 * @param local - The local document content.
 * @param base - The base content the document is expected to settle on.
 * @param contentType - The document content type.
 * @returns Whether the document has settled on the base content.
 */
export function settledOnBase(
  local: unknown,
  base: unknown,
  contentType: string
): boolean {
  if (contentType === 'notebook') {
    const baseIds = cellIdSet(base);
    const localIds = cellIdSet(local);
    if (baseIds && localIds) {
      if (baseIds.size !== localIds.size) {
        return false;
      }
      for (const id of baseIds) {
        if (!localIds.has(id)) {
          return false;
        }
      }
      return true;
    }
  }
  return contentsEqual(local, base, contentType);
}
