const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Create a standard HTTP server
const server = http.createServer((req, res) => {
  // This part serves the index.html file
  let filePath = path.join(__dirname, 'index.html');
  if (req.url === '/script.js') {
    filePath = path.join(__dirname, 'script.js');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end(`Error loading ${req.url}`);
      return;
    }
    let contentType = 'text/html';
    if (req.url === '/script.js') {
      contentType = 'text/javascript';
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// Create a WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ server });

console.log('HTTP and WebSocket server started on port 8080');

wss.on('connection', ws => {
  console.log('Client connected');

  // When a message is received from a client (ESP32 or Browser)
  ws.on('message', (message, isBinary) => {
    // Broadcast the received message to all other connected clients
    if (isBinary) {
      wss.clients.forEach(client => {
        // Broadcast the binary audio data to all other connected clients
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message, { binary: true });
        }
      });
    } else {
      // If it's a text message (likely from a browser), log it
      console.log('Received text message => %s', message.toString());
    }
      
  });
  

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.send('Welcome! You are connected.');
});

// Start the HTTP server
server.listen(8080);
