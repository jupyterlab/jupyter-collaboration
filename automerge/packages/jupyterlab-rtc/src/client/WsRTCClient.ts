import { IEditorTracker, FileEditor } from '@jupyterlab/fileeditor';

import { INotebookTracker } from '@jupyterlab/notebook';

import { Cell, ICellModel } from "@jupyterlab/cells";

import { IObservableString } from "@jupyterlab/observables";

import Automerge from "automerge";

import TextAreaModel, {
  TextArea,
  initTextArea,
//  applyChanges,
  getTextAreaChanges,
} from "../model/TextAreaModel";

class WsRTCClient {

  private editorTracker: IEditorTracker;
  private editors = new Map<string, TextAreaModel>();

  private notebookWs: WebSocket;
  private notebookTracker: INotebookTracker;
  private cell: Cell<ICellModel>;
  private cellDoc: TextArea;

  constructor(
    editorTracker: IEditorTracker,
    notebookTracker: INotebookTracker
    ) {

      this.editorTracker = editorTracker;
    // this.editorTracker.widgetAdded.connect((sender, widget) => this._setupFileEditor(widget.content));
      this.editorTracker.currentChanged.connect((sender, widget) => {
        if (widget) {
          this._setupFileEditor(widget.content)
        }
      });

      this.notebookTracker = notebookTracker;
      this.notebookTracker.widgetAdded.connect((sender, widget) => console.log('---', sender, widget));
      this.notebookTracker.activeCellChanged.connect((sender, cell) => this._activeCellChanged(cell));
  
  }

  private _setupFileEditor(fileEditor: FileEditor): void {
    if (fileEditor) {
      let textAreaModel = this.editors.get(fileEditor.context.path);
      if (!textAreaModel) {
        textAreaModel = new TextAreaModel(fileEditor);
        this.editors.set(fileEditor.context.path, textAreaModel);
      }
    }
  }

  private _activeCellChanged(cell: Cell<ICellModel>): void {
    if (cell) {
      this.cell = cell;
      this.cellDoc = initTextArea();
      this.cell.editor.model.value.changed.connect((value, change) => this._onCellValueChange(value, change));
      this.notebookWs = new WebSocket(`ws://localhost:8888/jupyter_rtc/collaboration?room=cell`);
      this.notebookWs.binaryType = 'arraybuffer';
      /*
      this.notebookWs.onmessage = (message: any) => {
        if (message.data) {
          const data = JSON.parse(message.data);
          console.log('Receiving', data);
          const changedDoc = applyChanges(this.cellDoc, data);
          this.cellDoc = changedDoc;
          const text = this.cellDoc.textArea.toString()
          if (this.cell.model.value.text !== text) {
              this.cell.model.value.text = text;
          }
        }
      }
      */
    }
  }

  private _onCellValueChange(value: IObservableString, change: IObservableString.IChangedArgs) {
    if (this.cellDoc.textArea) {
      if (this.cell.model.value.text !== this.cellDoc.textArea.toString()) {
          const newDoc = Automerge.change(this.cellDoc, (d: TextArea) => {
          if (change.type === 'insert') {
              d.textArea.insertAt(change.start, change.value);
          }
          if (change.type === 'remove') {
              d.textArea.deleteAt(change.start, (change.end - change.start));
          }
          });
          const changes = getTextAreaChanges(this.cellDoc, newDoc);
          this.cellDoc = newDoc;
          console.log('Sending', changes);
//          var payload = JSON.stringify(changes);
//          this.notebookWs.send((payload as any));
      }
    }
  }

}

export default WsRTCClient;
