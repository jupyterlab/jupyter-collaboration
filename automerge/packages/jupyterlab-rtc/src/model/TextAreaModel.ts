import { FileEditor } from '@jupyterlab/fileeditor';

import { IObservableString } from "@jupyterlab/observables";

import Automerge, { Text } from "automerge";

export type TextArea = {
  docId: string;
  textArea: Text;
}

export const initTextArea = () => {
  return Automerge.init<TextArea>();
}

export const initTextAreaText = (): TextArea => {
  return Automerge.from({
    docId: '',
    textArea: new Automerge.Text()}
  )
}

export const applyTextAreaChanges = (doc: TextArea, changes: Array<Array<number>>): TextArea => {
  changes.forEach((chunk) => {
    doc = Automerge.applyChanges(doc, [new Uint8Array(Object.values(chunk))]);
  });
  return doc;
}

export const getTextAreaChanges = (oldTextArea: TextArea, newTextArea: TextArea) => {
  return Automerge.getChanges(oldTextArea, newTextArea);
}

export const mergeTextArea = (oldTextArea: TextArea, newTextArea: TextArea) => {
  return Automerge.merge(oldTextArea, newTextArea);
}

export const initialValue = (textArea: TextArea, path: string, text: string) => {
  return Automerge.change(textArea, (t: TextArea) => {
    t.docId = path;
    t.textArea = new Automerge.Text();
    t.textArea.insertAt(0, ...text);
  });
}

export const getTextAreaHistory = (doc: TextArea) => {
  return Automerge.getHistory(doc).map(state => [state.change.message, state.snapshot.textArea]);
}

class TextAreaModel {
  private fileEditor: FileEditor;
  private textArea: TextArea;
  private ws: WebSocket;
  private roomId: string;
  private uri: string;
  
  constructor(fileEditor: FileEditor) { 

    this.fileEditor = fileEditor;
    this.textArea = initTextArea();
    this.roomId = fileEditor.context.path;

    this.uri = encodeURI(`ws://localhost:8888/jupyter_rtc/collaboration?room=/${this.roomId}`);
    this.ws = new WebSocket(this.uri);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (message: any) => {
      if (message.data) {
        const data = JSON.parse(message.data);
        console.log('TextAreaModel Receiving', data);
        if (data.action === 'all_changes') {
          this.textArea = initTextArea();
          this.textArea = applyTextAreaChanges(this.textArea, data.changes);
        }
        if (data.action === 'init' || data.action === 'change') {
          this.textArea = applyTextAreaChanges(this.textArea, data.changes);
        }
        const text = this.textArea.textArea.toString();
        if (this.fileEditor.model.value.text !== text) {
          this.fileEditor.model.value.text = text;
        }
      }
    }

    this.fileEditor.editor.model.value.changed.connect((value, change) => this._onFileEditorValueChange(value, change));

  }

  private _onFileEditorValueChange(value: IObservableString, change: IObservableString.IChangedArgs) {
    let newTextArea: TextArea = null;
    if (change.type === 'set') {
      /*
      newTextArea = Automerge.change(this.textArea, (t: TextArea) => {
        t.docId = this.fileEditor.context.path;
        t.textArea = new Automerge.Text();
        t.textArea.insertAt(change.start, ...change.value);
      });
      */
      this.ws.send(JSON.stringify({
        'action': 'get_all_changes',
      }));
    }
    else if (this.textArea.textArea) {
      if (this.fileEditor.model.value.text !== this.textArea.textArea.toString()) {
        newTextArea = Automerge.change(this.textArea, (d: TextArea) => {
          if (change.type === 'insert') {
            d.textArea.insertAt(change.start, ...change.value);
          }
          else if (change.type === 'remove') {
              d.textArea.deleteAt(change.start, (change.end - change.start));
          }
        });
      }
    }
    if (newTextArea) {
      const changes = getTextAreaChanges(this.textArea, newTextArea);
      this.textArea = newTextArea;
      if (changes.length > 0) {
        console.log('TextAreaModel Sending changes', changes);
        const payload = JSON.stringify({
          'action': 'change',
          'changes': changes
        });
        this.ws.send((payload as any));
      }
    }
  }

}

export default TextAreaModel;
