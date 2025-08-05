// A simple WebSocket server for receiving data from the ESP32
const WebSocket = require('ws');

// The server will run on port 8080
const wss = new WebSocket.Server({ port: 8080 });

console.log('WebSocket server started on port 8080');

wss.on('connection', ws => {
  console.log('Client connected');

  // When a message is received from a client (our ESP32)
  ws.on('message', message => {
    // For now, we'll just log the message.
    // In a real application, you might process or store this audio data.
    console.log('Received message => %s', message);

    // You could also broadcast this message to other connected clients (like a web browser)
    // wss.clients.forEach(client => {
    //   if (client !== ws && client.readyState === WebSocket.OPEN) {
    //     client.send(message);
    //   }
    // });
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.send('Welcome! You are connected.');
});

