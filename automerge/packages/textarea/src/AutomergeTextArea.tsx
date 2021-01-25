import React, { 
  ChangeEvent, 
  useEffect,
  useState,
  useRef
} from "react";

import {
  Doc,
  initDocument,
  applyChanges,
  getChanges,
  applyInput,
  getHistory
} from "./AutomergeActions";

import simpleDiff from './simpleDiff'

const AutomergeTextAreaPerf = (props: {docId: string}) => {

  const docId = props.docId;

  const [doc, setDoc] = useState<Doc>(initDocument());
  const docRef = useRef<Doc>();
  docRef.current = doc;

  const [history, setHistory] = useState(new Array(new Array()));

  const wsRef = useRef<WebSocket>();

  useEffect(() => {
    wsRef.current = new WebSocket('ws://localhost:8888/jupyter_rtc/collaboration?room=textarea-react-room');
    wsRef.current.binaryType = 'arraybuffer';
    wsRef.current.onmessage = (message: any) => {
      if (message.data) {
        const data = JSON.parse(message.data);
        if (data.action === 'init' || data.action === 'change') {
          var changedDoc = docRef.current;
          data.changes.forEach((chunk) => {
            changedDoc = applyChanges(changedDoc, [new Uint8Array(Object.values(chunk))]);
          });
          setDoc(changedDoc);
          console.log("changedDoc : ", changedDoc);
        }
      }
    }
  }, []);

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    console.log("TypeScript::handleTextChange", event.target.value);
    console.log("Doc : ", doc);
    event.preventDefault();
    let diff = simpleDiff(doc.textArea.toString(), event.target.value);
    const newDoc = applyInput(doc, diff);
    setDoc(newDoc);
    const changes = getChanges(doc, newDoc);
    var payload = JSON.stringify({
      action: 'change',
      changes: changes
    });
    wsRef.current.send((payload as any));
  }

  const handleShowHistory = () => {
    setHistory(getHistory(doc));
  };

  const value = doc.textArea ? doc.textArea.toString() : '';

  return (
    <div>
      <h3>Automerge TextArea (id: {docId})</h3>
      <textarea
        cols={80}
        rows={5}
        onChange={handleTextChange}
        value={value}
      />
      <div><button onClick={handleShowHistory}>Automerge History</button></div>
      <div>{ history.map(h1 => h1.map(h2 => <div>{h2}</div>)) }</div>
    </div>
  );

}

export default AutomergeTextAreaPerf;
