const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const ROUTES = {
  '/':              'quicklabel.html',
  '/quicklabel':    'quicklabel.html',
  '/tracker':       'tracker.html',
  '/tracker.html':  'tracker.html',
  '/quicklabel.html': 'quicklabel.html',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const fileName = ROUTES[url] || 'quicklabel.html';
  const filePath = path.join(__dirname, '..', fileName);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Could not load ' + fileName + ': ' + err.message);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.listen(parseInt(PORT), HOST, () => {
  console.log(`QuickLabel serving on http://${HOST}:${PORT}`);
});
