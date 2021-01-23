import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IEditorTracker, FileEditor } from '@jupyterlab/fileeditor';

import { INotebookTracker } from '@jupyterlab/notebook';

import { Cell, ICellModel } from "@jupyterlab/cells";

import { IObservableString } from '@jupyterlab/observables';

import Automerge from "automerge";

import {
  Doc,
  initDocument,
  applyChanges,
  getChanges,
} from "./AutomergeActions";

class Rtc {
  private notebookWs: WebSocket;
  private notebookTracker: INotebookTracker;
  private cell: Cell<ICellModel>;
  private cellDoc: Doc;

  private editorWs: WebSocket;
  private editorTracker: IEditorTracker;
  private fileEditor: FileEditor;
  private fileEditorDoc: Doc;

  constructor(
    notebookTracker: INotebookTracker, 
    editorTracker: IEditorTracker
    ) {
    this.notebookTracker = notebookTracker;
    this.editorTracker = editorTracker;
    this.notebookTracker.activeCellChanged.connect((sender, cell) => this._activeCellChanged(cell));
    this.editorTracker.widgetAdded.connect((sender, widget) => this._setupFileEditor(widget.content));
    this.editorTracker.currentChanged.connect((sender, widget) => this._setupFileEditor(widget.content));
  }

  private _onCellValueChange(value: IObservableString, change: IObservableString.IChangedArgs) {
    if (this.cellDoc.textArea) {
      if (this.cell.model.value.text !== this.cellDoc.textArea.toString()) {
        const newDoc = Automerge.change(this.cellDoc, (d: Doc) => {
          if (change.type === 'insert') {
            d.textArea.insertAt(change.start, change.value);
          }
          if (change.type === 'remove') {
            d.textArea.deleteAt(change.start, (change.end - change.start));
          }
        });
        const changes = getChanges(this.cellDoc, newDoc);
        this.cellDoc = newDoc;
        console.log('Sending', changes);
        var payload = JSON.stringify(changes);
        this.notebookWs.send((payload as any));
      }
    }
  }

  private _activeCellChanged(cell: Cell<ICellModel>): void {
    if (cell != null) {
      this.cellDoc = initDocument();
      this.cell = cell;
      this.cell.editor.model.value.changed.connect((value, change) => this._onCellValueChange(value, change));
      // this.notebookWs = new WebSocket(`ws://localhost:4321/notebook-${cell.id}`);
      this.notebookWs = new WebSocket(`ws://localhost:8888/jupyter_rtc/websocket?doc=notebook-${cell.id}`);
      this.notebookWs.binaryType = 'arraybuffer';
      this.notebookWs.onmessage = (message: any) => {
        if (message.data) {
          const data = JSON.parse(message.data);
          console.log('Receiving', data);
          const changedDoc = applyChanges(this.cellDoc, data);
          this.cellDoc = changedDoc;
          const text = this.cellDoc.textArea.toString()
          if (this.cell && this.cell.model.value.text !== text) {
            this.cell.model.value.text = text;
          }
        }
      }
    }
  }

  private _onFileEditorValueChange(value: IObservableString, change: IObservableString.IChangedArgs) {
    if (this.fileEditorDoc.textArea) {
      if (this.fileEditor.model.value.text !== this.fileEditorDoc.textArea.toString()) {
        const newDoc = Automerge.change(this.fileEditorDoc, (d: Doc) => {
          if (change.type === 'insert') {
            d.textArea.insertAt(change.start, change.value);
          }
          if (change.type === 'remove') {
            d.textArea.deleteAt(change.start, (change.end - change.start));
          }
        });
        const changes = getChanges(this.fileEditorDoc, newDoc);
        this.fileEditorDoc = newDoc;
        console.log('Sending', changes);
        var payload = JSON.stringify(changes);
        this.editorWs.send((payload as any));
      }
    }
  }

  private _setupFileEditor(fileEditor: FileEditor): void {
    if (fileEditor != null) {
      this.fileEditorDoc = initDocument();
      this.fileEditor = fileEditor;
      this.fileEditor.editor.model.value.changed.connect((value, change) => this._onFileEditorValueChange(value, change));
//      this.editorWs = new WebSocket(`ws://localhost:4321/editor-fileEditor.id`);
      this.editorWs = new WebSocket(`ws://localhost:8888/jupyter_rtc/websocket?doc=editor-`);
      this.editorWs.binaryType = 'arraybuffer';
      this.editorWs.onmessage = (message: any) => {
        if (message.data) {
          const data = JSON.parse(message.data);
          console.log('Receiving', data);
          const changedDoc = applyChanges(this.fileEditorDoc, data);
          this.fileEditorDoc = changedDoc;
          const text = this.fileEditorDoc.textArea.toString();
          console.log(text)
          if (this.fileEditor && this.fileEditor.model.value.text !== text) {
            this.fileEditor.model.value.text = text;
          }
        }
      }
    }
  }

}

/**
 * Initialization data for the @jupyterlab/rtc extension.
 */
const rtc: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/rtc:extension',
  autoStart: true,
  requires: [
    INotebookTracker,
    IEditorTracker
  ],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker, 
    editorTracker: IEditorTracker
  ) => {
    const rtc = new Rtc(notebookTracker, editorTracker);
    console.log('JupyterLab extension @jupyterlab/rtc is activated!', rtc);
  }
};

export default rtc;
