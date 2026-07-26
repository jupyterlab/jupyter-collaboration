// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/// <reference types="jest" />

import { YFile, YNotebook } from '@jupyter/ydoc';
import type * as nbformat from '@jupyterlab/nbformat';

import {
  applyNotebookContent,
  cellIdSet,
  clearForAdoption,
  clearOrderedSharedTypes,
  contentsEqual,
  reassertAuthoritativeState,
  removePlaceholderCell,
  settledOnBase
} from '../rebase';

function notebook(cells: any[], metadata: any = {}): nbformat.INotebookContent {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata,
    cells
  } as nbformat.INotebookContent;
}

function codeCell(id: string, source: string | string[], extra: any = {}): any {
  return {
    cell_type: 'code',
    id,
    metadata: {},
    source,
    outputs: [],
    execution_count: null,
    ...extra
  };
}

describe('rebase', () => {
  describe('cellIdSet', () => {
    it('returns the ids of an identifiable notebook', () => {
      const ids = cellIdSet(notebook([codeCell('a', ''), codeCell('b', '')]));
      expect(ids && Array.from(ids).sort()).toEqual(['a', 'b']);
    });

    it('refuses to identify cells of an nbformat < 4.5 notebook', () => {
      // Collapsing id-less cells into a set would make every such notebook
      // look like every other one, and `settledOnBase` would report a
      // document as settled before it received any content.
      const idless = notebook([
        { cell_type: 'code', source: 'a' },
        { cell_type: 'code', source: 'b' }
      ]);
      expect(cellIdSet(idless)).toBeNull();
    });

    it('returns null for non-notebook content', () => {
      expect(cellIdSet('some text')).toBeNull();
      expect(cellIdSet(null)).toBeNull();
    });
  });

  describe('settledOnBase', () => {
    it('tolerates in-cell edits while the cell set matches', () => {
      const base = notebook([codeCell('a', 'x = 1')]);
      const local = notebook([codeCell('a', 'x = 2')]);
      expect(settledOnBase(local, base, 'notebook')).toBe(true);
    });

    it('is not settled while cells are still missing', () => {
      const base = notebook([codeCell('a', ''), codeCell('b', '')]);
      const local = notebook([codeCell('a', '')]);
      expect(settledOnBase(local, base, 'notebook')).toBe(false);
    });

    it('falls back to content comparison without cell ids', () => {
      const base = notebook([{ cell_type: 'code', source: 'x = 1' }]);
      const different = notebook([{ cell_type: 'code', source: 'x = 2' }]);
      expect(settledOnBase(different, base, 'notebook')).toBe(false);
      expect(settledOnBase(base, base, 'notebook')).toBe(true);
    });
  });

  describe('contentsEqual', () => {
    it('ignores transient cell state', () => {
      const a = notebook([codeCell('a', 'x', { execution_state: 'idle' })]);
      const b = notebook([codeCell('a', 'x')]);
      expect(contentsEqual(a, b, 'notebook')).toBe(true);
    });

    it('normalizes multiline sources', () => {
      const a = notebook([codeCell('a', ['x = 1\n', 'y = 2'])]);
      const b = notebook([codeCell('a', 'x = 1\ny = 2')]);
      expect(contentsEqual(a, b, 'notebook')).toBe(true);
    });

    it('normalizes line endings of plain files', () => {
      expect(contentsEqual('a\r\nb', 'a\nb', 'file')).toBe(true);
    });

    it('detects differing metadata', () => {
      const a = notebook([codeCell('a', 'x')], { tag: 'one' });
      const b = notebook([codeCell('a', 'x')], { tag: 'two' });
      expect(contentsEqual(a, b, 'notebook')).toBe(false);
    });

    it('converges when the same cells hold the same text', () => {
      // Cell ids live in the file, so an out-of-band change which edits
      // existing cells leaves both sides identifying them the same way: the
      // user can bring the document back onto the server content by hand,
      // and the convergence watch then rejoins on its own.
      const server = notebook([codeCell('from-the-file', 'print(1)')]);
      const edited = notebook([codeCell('from-the-file', 'print(1)')]);
      expect(contentsEqual(edited, server, 'notebook')).toBe(true);
    });

    it('cannot converge onto a cell the client has never seen', () => {
      // A cell *added* out of band carries an id the user cannot reproduce
      // by editing, so this is the case where converging is out of reach and
      // the explicit "Revert" is the only way back.
      const server = notebook([codeCell('added-out-of-band', 'print(1)')]);
      const retyped = notebook([codeCell('minted-locally', 'print(1)')]);
      expect(contentsEqual(retyped, server, 'notebook')).toBe(false);
    });
  });

  describe('clearOrderedSharedTypes', () => {
    it('tombstones ordered content but leaves map keys alone', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1')], { tag: 'keep' }));

      clearOrderedSharedTypes(shared.ydoc, 'test');

      expect(shared.cells.length).toBe(0);
      // Map keys are deliberately kept: deleting a key whose winning item is
      // the local one makes it read as absent rather than falling back to
      // the remote value.
      expect(shared.getMetadata()).toEqual(
        expect.objectContaining({ tag: 'keep' })
      );
      shared.dispose();
    });

    it('clears the source of a plain file', () => {
      const shared = new YFile();
      shared.setSource('hello');
      clearOrderedSharedTypes(shared.ydoc, 'test');
      expect(shared.getSource()).toBe('');
      shared.dispose();
    });
  });

  describe('clearForAdoption', () => {
    it('keeps a notebook non-empty so no default cell is synchronized', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1')]));

      const placeholderId = clearForAdoption(shared, 'notebook', 'test');

      expect(placeholderId).not.toBeNull();
      expect(shared.cells.length).toBe(1);
      expect(shared.getCell(0).getId()).toBe(placeholderId);

      removePlaceholderCell(shared, placeholderId!);
      expect(shared.cells.length).toBe(0);
      shared.dispose();
    });

    it('mints a distinct placeholder id on repeated adoptions', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1')]));
      const first = clearForAdoption(shared, 'notebook', 'test');
      const second = clearForAdoption(shared, 'notebook', 'test');
      expect(first).not.toEqual(second);
      // The previous placeholder was tombstoned along with everything else.
      expect(shared.cells.length).toBe(1);
      shared.dispose();
    });
  });

  describe('reassertAuthoritativeState', () => {
    it('restores the authoritative notebook metadata and hash', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1')], { tag: 'stale' }));

      reassertAuthoritativeState(
        shared,
        notebook([codeCell('a', 'x = 1')], { tag: 'fresh' }),
        'server-hash',
        'notebook'
      );

      expect(shared.getMetadata()).toEqual(
        expect.objectContaining({ tag: 'fresh' })
      );
      expect(shared.getState('hash')).toBe('server-hash');
      shared.dispose();
    });

    it('does not touch cells, which synchronization already delivered', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'from the room')]));

      reassertAuthoritativeState(
        shared,
        notebook([codeCell('a', 'from the file')]),
        null,
        'notebook'
      );

      expect(shared.getCell(0).getSource()).toBe('from the room');
      shared.dispose();
    });

    it('records the hash for a plain file too', () => {
      const shared = new YFile();
      reassertAuthoritativeState(shared, 'content', 'server-hash', 'file');
      expect(shared.getState('hash')).toBe('server-hash');
      shared.dispose();
    });
  });

  describe('applyNotebookContent', () => {
    it('keeps the identity of unchanged cells', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1'), codeCell('b', 'y')]));
      const untouched = shared.getCell(1);

      applyNotebookContent(
        shared,
        notebook([codeCell('a', 'x = 2'), codeCell('b', 'y')])
      );

      expect(shared.getCell(0).getSource()).toBe('x = 2');
      // Same Yjs cell object: no re-render, no lost cursor.
      expect(shared.getCell(1)).toBe(untouched);
      shared.dispose();
    });

    it('inserts, deletes and reorders to match the target', () => {
      const shared = new YNotebook();
      shared.fromJSON(
        notebook([codeCell('a', 'a'), codeCell('b', 'b'), codeCell('c', 'c')])
      );

      applyNotebookContent(
        shared,
        notebook([codeCell('c', 'c'), codeCell('d', 'd'), codeCell('a', 'a')])
      );

      expect(shared.cells.map(cell => cell.getId())).toEqual(['c', 'd', 'a']);
      expect(shared.cells.map(cell => cell.getSource())).toEqual([
        'c',
        'd',
        'a'
      ]);
      shared.dispose();
    });

    it('replaces a cell whose type changed', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1')]));

      applyNotebookContent(
        shared,
        notebook([
          { cell_type: 'markdown', id: 'a', metadata: {}, source: '#' }
        ])
      );

      expect(shared.cells.length).toBe(1);
      expect(shared.getCell(0).cell_type).toBe('markdown');
      expect(shared.getCell(0).getSource()).toBe('#');
      shared.dispose();
    });

    it('applies notebooks whose cells have no ids', () => {
      const shared = new YNotebook();
      shared.fromJSON(notebook([codeCell('a', 'x = 1')]));

      applyNotebookContent(
        shared,
        notebook([{ cell_type: 'code', source: 'brand new' }])
      );

      expect(shared.cells.length).toBe(1);
      expect(shared.getCell(0).getSource()).toBe('brand new');
      shared.dispose();
    });
  });
});
