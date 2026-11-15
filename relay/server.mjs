// Local relay for Bisim: run on ANY device connected to the same Wi-Fi / hotspot.
// No internet needed. Usage:  cd relay && npm install && npm start
import os from "node:os";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8787);
const wss = new WebSocketServer({ port, maxPayload: 256 * 1024 });

wss.on("connection", (ws) => {
  ws.on("message", (data, isBinary) => {
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) client.send(data, { binary: isBinary });
    }
  });
});

console.log(`Bisim relay listening on port ${port}. Enter one of these in the app:`);
for (const list of Object.values(os.networkInterfaces())) {
  for (const a of list ?? []) {
    if (a.family === "IPv4" && !a.internal) console.log(`  ws://${a.address}:${port}`);
  }
}
