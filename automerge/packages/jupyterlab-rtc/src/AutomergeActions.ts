import Automerge, { Text } from "automerge-wasm-bundler";

export type Doc = {
  docId: string;
  textArea: Text;
}

export const initDocument = () => {
  return Automerge.init<Doc>();
}

export const initDocumentText = (): Doc => {
  return Automerge.from({
    docId: '',
    textArea: new Automerge.Text()}
  )
}

export const applyChanges = (doc: Doc, changes: Uint8Array[]) => {
  return Automerge.applyChanges(doc, changes);
}

export const getChanges = (oldDoc: Doc, newDoc: Doc) => {
  return Automerge.getChanges(oldDoc, newDoc);
}

export const merge = (oldDoc: Doc, newDoc: Doc) => {
  return Automerge.merge(oldDoc, newDoc);
}

export const getHistory = (doc: Doc) => {
  return Automerge.getHistory(doc).map(state => [state.change.message, state.snapshot.textArea]);
}
