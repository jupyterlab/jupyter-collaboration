import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IEditorTracker, FileEditor } from '@jupyterlab/fileeditor';

import { INotebookTracker } from '@jupyterlab/notebook';

import { Cell, ICellModel } from "@jupyterlab/cells";

import { IObservableString } from '@jupyterlab/observables';

// import { CodeMirrorEditor } from '@jupyterlab/codemirror';

import Automerge from "automerge";

import {
  Doc,
  initDocument,
  applyChanges,
  getChanges,
} from "./AutomergeActions";

class Rtc {
  private notebookTracker: INotebookTracker;
  private editorTracker: IEditorTracker;
  private ws: WebSocket;
  private rtcCell: Doc;
  private cell: Cell<ICellModel>;
  private rtcEditor: Doc;
  private fileEditor: FileEditor;

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
    if (this.rtcCell.textArea) {
      if (this.cell.model.value.text !== this.rtcCell.textArea.toString()) {
        const newDoc = Automerge.change(this.rtcCell, (d: Doc) => {
          if (change.type === 'insert') {
            d.textArea.insertAt(change.start, change.value);
          }
          if (change.type === 'remove') {
            d.textArea.deleteAt(change.start, (change.end - change.start));
          }
        });
        const changes = getChanges(this.rtcCell, newDoc);
        this.rtcCell = newDoc;
        this.ws.send((changes[0] as any));
      }
    }
  }

  private _activeCellChanged(cell: Cell<ICellModel>): void {
    if (cell != null) {
      this.rtcCell = initDocument();
      this.cell = cell;
      this.cell.editor.model.value.changed.connect((value, change) => this._onCellValueChange(value, change));
      this.ws = new WebSocket(`ws://localhost:8888/jupyter_rtc/websocket?doc=${cell.id}`);
      //this.ws = new WebSocket(`ws://localhost:4321/${cell.id}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onmessage = (message: any) => {
        if (message.data) {

          const data = JSON.parse(message.data);
          const changedDoc = applyChanges(this.rtcCell, data);
          this.rtcCell = changedDoc;
          const text = this.rtcCell.textArea.toString()
          if (this.cell.model.value.text !== text) {
            this.cell.model.value.text = text;
          }
        }
      }
    }
  }

  private _onFileEditorValueChange(value: IObservableString, change: IObservableString.IChangedArgs) {
    if (this.rtcEditor.textArea) {
      if (this.fileEditor.model.value.text !== this.rtcEditor.textArea.toString()) {
        const newDoc = Automerge.change(this.rtcEditor, (d: Doc) => {
          if (change.type === 'insert') {
            d.textArea.insertAt(change.start, change.value);
          }
          if (change.type === 'remove') {
            d.textArea.deleteAt(change.start, (change.end - change.start));
          }
        });
        const changes = getChanges(this.rtcEditor, newDoc);
        this.rtcEditor = newDoc;
        this.ws.send((changes[0] as any));
      }
    }
  }

  private _setupFileEditor(fileEditor: FileEditor): void {
    if (fileEditor != null) {
      this.rtcEditor = initDocument();
      this.fileEditor = fileEditor;
      this.fileEditor.editor.model.value.changed.connect((value, change) => this._onFileEditorValueChange(value, change));
//      this.ws = new WebSocket(`ws://localhost:8888/jupyter_rtc/websocket?doc=${cell.id}`);
      this.ws = new WebSocket(`ws://localhost:4321/${fileEditor.id}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onmessage = (message: any) => {
        if (message.data) {

          const data = JSON.parse(message.data);
          const changedDoc = applyChanges(this.rtcEditor, data);
          this.rtcEditor = changedDoc;
          const text = this.rtcEditor.textArea.toString()
          if (this.fileEditor.model.value.text !== text) {
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
