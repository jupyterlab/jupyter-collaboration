import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IEditorTracker, FileEditor } from '@jupyterlab/fileeditor';

import { INotebookTracker } from '@jupyterlab/notebook';

import { Cell, ICellModel } from "@jupyterlab/cells";

import { requestAPI } from './handler';

import Automerge from "automerge-wasm-bundler";

import {
  Doc,
  initDocument,
  applyChanges,
  getChanges,
} from "./AutomergeActions";

function pingApi() {
  requestAPI<any>('get_example')
  .then(data => {
    console.log(data);
  })
  .catch(reason => {
    console.error(
      `The jupyter_rtc server extension appears to be missing.\n${reason}`
    );
  });
}

class Rtc {
  private notebookTracker: INotebookTracker;
  private editorTracker: IEditorTracker;
  private ws: WebSocket;
  private doc: Doc;
  private cell: Cell<ICellModel>;

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

  private _onCellValueChange(value: any, change: any) {
    console.log(change);
    const newDoc = Automerge.change(this.doc, (d: Doc) => {
      if (change.type == 'insert') {
        d.textArea.insertAt(change.start, change.value);
      }
      if (change.type == 'remove') {
        d.textArea.deleteAt(change.start + 1, change.value);
      }
    });
    const changes = getChanges(this.doc, newDoc);
    console.log(changes)
    this.ws.send((changes[0] as any));
    this.doc = newDoc;
  }

  private _activeCellChanged(cell: Cell<ICellModel>): void {
    if (cell != null) {
      this.cell = cell;
      this.doc = initDocument();
      this.ws = new WebSocket(`ws://localhost:8888/jupyter_rtc/websocket?doc=${cell.id}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onmessage = (message: any) => {
        if (message.data) {
          const data = new Uint8Array(message.data);
          const changedDoc = applyChanges(this.doc, [data]);
          console.log("changedDoc:", changedDoc);
          this.doc = changedDoc;
          console.log(this.cell)
//          this.cell.model.value = doc.
        }
      }
      cell.editor.model.value.changed.connect((value, change) => this._onCellValueChange(value, change));
    }
  }

  private _onFileEditorValueChange(value: any, change: any) {
    console.log(change);
  }

  private _setupFileEditor(fileEditor: FileEditor): void {
    if (fileEditor != null) {
      fileEditor.editor.model.value.changed.connect((value, change) => this._onFileEditorValueChange(value, change));
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
    pingApi();
  }
};

export default rtc;
