/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import type * as nbformat from '@jupyterlab/nbformat';
import type { CodeEditor } from '@jupyterlab/codeeditor';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { nullTranslator } from '@jupyterlab/translation';
import type { TranslationBundle } from '@jupyterlab/translation';

import { Widget } from '@lumino/widgets';

import { NotebookDiffModel } from 'nbdime/lib/diff/model';
import { NotebookDiffWidget } from 'nbdime/lib/diff/widget';
import type { IDiffEntry, IDiffArrayEntry } from 'nbdime/lib/diff/diffentries';

import 'nbdime/lib/styles/variables.css';
import 'nbdime/lib/styles/common.css';
import 'nbdime/lib/styles/diff.css';
import 'nbdime/lib/upstreaming/flexpanel.css';
import 'nbdime/lib/common/collapsible.css';
import '../style/conflictDiff.css';

/**
 * A widget that shows a side-by-side diff between two in-memory notebooks.
 * Uses nbdime's NotebookDiffModel/NotebookDiffWidget for rendering.
 *
 * Because nbdime bundles its own @lumino/widgets (separate from JupyterLab's),
 * we extend Widget and append the nbdime widget's DOM node directly instead
 * of using Panel.addWidget(), which would fail due to the class identity mismatch.
 */
export class ConflictDiffWidget extends Widget {
  private _nbdiffWidget: NotebookDiffWidget | null = null;
  private _editorFactory: CodeEditor.Factory;
  private _rendermime: IRenderMimeRegistry;
  private _trans: TranslationBundle;

  constructor(options: ConflictDiffWidget.IOptions) {
    super();
    this.addClass('nbdime-Widget');
    this._editorFactory = options.editorFactory;
    this._rendermime = options.rendermime;
    this._trans =
      options.translator ?? nullTranslator.load('jupyter_collaboration');
    this.node.style.display = 'flex';
    this.node.style.flexDirection = 'column';
    this.node.style.height = '100%';
    this.node.style.overflow = 'auto';
  }

  async create(options: ConflictDiffWidget.ICreateOptions): Promise<void> {
    const diff = _diffNotebooks(options.base, options.remote);
    const model = new NotebookDiffModel(options.base, diff);
    const diffWidget = new NotebookDiffWidget({
      model,
      rendermime: this._rendermime,
      editorFactory: this._editorFactory
    });
    await diffWidget.init();
    this._nbdiffWidget = diffWidget;
    this.node.appendChild(
      _makeHeaderNode(
        this._trans.__('Server version'),
        this._trans.__('Local version')
      )
    );
    this.node.appendChild(diffWidget.node);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._nbdiffWidget?.dispose();
    super.dispose();
  }
}

export namespace ConflictDiffWidget {
  export interface IOptions {
    translator?: TranslationBundle;
    editorFactory: CodeEditor.Factory;
    rendermime: IRenderMimeRegistry;
  }

  export interface ICreateOptions {
    base: nbformat.INotebookContent;
    remote: nbformat.INotebookContent;
  }
}

function _makeHeaderNode(baseLabel: string, remoteLabel: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'jp-conflict-diff-header nbdime-Diff';

  const banner = document.createElement('div');
  banner.className = 'nbdime-header-banner';

  const base = document.createElement('span');
  base.className = 'nbdime-header-base';
  base.textContent = baseLabel;

  const remote = document.createElement('span');
  remote.className = 'nbdime-header-remote';
  remote.textContent = remoteLabel;

  banner.appendChild(base);
  banner.appendChild(remote);
  node.appendChild(banner);
  return node;
}

function _getSource(cell: nbformat.ICell): string {
  const src = cell.source;
  return Array.isArray(src) ? src.join('') : src;
}

/**
 * Compute index pairs (baseIdx, remoteIdx) for the longest common subsequence
 * of cell IDs between two lists.
 */
function _lcs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: Array<[number, number]> = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

/**
 * Compute a notebook-level IDiffEntry[] for use with NotebookDiffModel.
 * Matches cells by id using LCS; changed-source cells appear as remove+add.
 */
function _diffNotebooks(
  base: nbformat.INotebookContent,
  remote: nbformat.INotebookContent
): IDiffEntry[] {
  const baseCells = base.cells;
  const remoteCells = remote.cells;
  const baseIds = baseCells.map(c => (c.id as string) ?? '');
  const remoteIds = remoteCells.map(c => (c.id as string) ?? '');
  const matches = _lcs(baseIds, remoteIds);

  const cellsDiff: IDiffArrayEntry[] = [];
  let bi = 0,
    ri = 0;

  for (const [baseIdx, remoteIdx] of matches) {
    if (bi < baseIdx) {
      cellsDiff.push({ op: 'removerange', key: bi, length: baseIdx - bi });
    }
    if (ri < remoteIdx) {
      cellsDiff.push({
        op: 'addrange',
        key: bi,
        valuelist: remoteCells.slice(ri, remoteIdx)
      });
    }
    const sourceChanged =
      _getSource(baseCells[baseIdx]) !== _getSource(remoteCells[remoteIdx]);
    const metaChanged =
      JSON.stringify(baseCells[baseIdx].metadata) !==
      JSON.stringify(remoteCells[remoteIdx].metadata);

    if (sourceChanged) {
      cellsDiff.push({ op: 'removerange', key: baseIdx, length: 1 });
      cellsDiff.push({
        op: 'addrange',
        key: baseIdx,
        valuelist: [remoteCells[remoteIdx]]
      });
    } else if (metaChanged) {
      cellsDiff.push({
        op: 'patch',
        key: baseIdx,
        diff: [
          {
            op: 'replace',
            key: 'metadata',
            value: remoteCells[remoteIdx].metadata
          }
        ]
      });
    }
    bi = baseIdx + 1;
    ri = remoteIdx + 1;
  }

  if (bi < baseCells.length) {
    cellsDiff.push({
      op: 'removerange',
      key: bi,
      length: baseCells.length - bi
    });
  }
  if (ri < remoteCells.length) {
    cellsDiff.push({
      op: 'addrange',
      key: bi,
      valuelist: remoteCells.slice(ri)
    });
  }

  const topDiff: IDiffEntry[] = [];
  if (cellsDiff.length > 0) {
    topDiff.push({ op: 'patch', key: 'cells', diff: cellsDiff });
  }
  if (JSON.stringify(base.metadata) !== JSON.stringify(remote.metadata)) {
    topDiff.push({ op: 'replace', key: 'metadata', value: remote.metadata });
  }
  return topDiff;
}
