const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Create a standard HTTP server
const server = http.createServer((req, res) => {
  // This part serves the index.html file
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading index.html');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// Create a WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ server });

console.log('HTTP and WebSocket server started on port 8080');

wss.on('connection', ws => {
  console.log('Client connected');

  // When a message is received from a client (ESP32 or Browser)
  ws.on('message', message => {
    console.log('Received message => %s', message);

    // Broadcast the received message to all other connected clients
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.send('Welcome! You are connected.');
});

// Start the HTTP server
server.listen(8080);
