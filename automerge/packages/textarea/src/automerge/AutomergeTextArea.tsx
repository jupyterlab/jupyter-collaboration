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

import simpleDiff from '../utils/simpleDiff'

const AutomergeTextAreaPerf = (props: {docId: string}) => {

  const docId = props.docId;

  const [doc, setDoc] = useState<Doc>(initDocument());
  const docRef = useRef<Doc>();
  docRef.current = doc;

  const [history, setHistory] = useState(new Array(new Array()));

  const wsRef = useRef<WebSocket>();

  useEffect(() => {
    // wsRef.current = new WebSocket('ws://localhost:8888/jupyter_rtc/websocket?doc=automerge-room');
    wsRef.current = new WebSocket('ws://localhost:4321/automerge-room');

    // wsRef.current = new WebSocket('ws://localhost:8989/proxy/4321/automerge-room');
    // wsRef.current = new WebSocket('ws://localhost:8989/datalayer_rtc/proxy?port=4321&doc=automerge-room2');
    wsRef.current.binaryType = 'arraybuffer';
    wsRef.current.onmessage = (message: any) => {
      if (message.data) {
        const data = new Uint8Array(message.data);
        const changedDoc = applyChanges(docRef.current, [data]);
        setDoc(changedDoc);
        console.log("changedDoc : ", changedDoc);
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
    wsRef.current.send((changes[0] as any));
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
