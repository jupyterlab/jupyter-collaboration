import http from "http";
import socketio from "socket.io";
import { Datastore } from "@lumino/datastore";

const handler: http.RequestListener = (_req, res) => {
  res.writeHead(404);
  return res.end("Connect over socket.io. No http requests");
};

const app = http.createServer(handler);

const io = socketio(app);

app.listen(8888);

const transactions: Datastore.Transaction[] = [];

io.on("connection", (socket) => {
  // Send list of inital transactionon start.
  socket.emit("transactions", transactions);
  socket.on("transaction", (transaction: Datastore.Transaction) => {
    transactions.push(transaction);
    socket.broadcast.emit("transaction", transaction);
  });
});
