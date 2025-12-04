const { program } = require('commander');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const superagent = require('superagent');

program 
    .requiredOption('-h, --host <address>', 'Адреса сервера')
    .requiredOption('-p, --port <number>', 'Порт сервера ', parseInt)
    .requiredOption('-c, --cache <path>', 'Шлях до директорії, що міститиме кешовані файли')
program.parse(process.argv)
const options = program.opts();

const host = options.host;
const port = options.port;
const cache = options.cache;
async function initCacheDirectory() {
  try {
    await fs.access(cache);
    console.log(`Cache directory "${cache}" already exists.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`Creating cache directory: "${cache}"`);
      await fs.mkdir(cache, { recursive: true });
    } else {
      console.error('Error creating cache directory:', error);
      process.exit(1);
    }
  }
}
async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function startCacheServer() {
  await initCacheDirectory();

  const server = http.createServer(async (req, res) => {
    console.log(` Received request: ${req.method} ${req.url}`);

    const httpCode = req.url.slice(1);
    if (!/^\d{3}$/.test(httpCode)) {
      res.writeHead(400);
      res.end('Invalid HTTP status code in URL.');
      return;
    }

    const filePath = path.join(cache, `${httpCode}.jpeg`);

    switch (req.method) {
      case 'GET':
        try {
          const data = await fs.readFile(filePath);
          console.log(` Sending ${httpCode}.jpeg from cache.`);
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          res.end(data);
        } catch (error) {
          if (error.code === 'ENOENT') {
            handleProxyFetch(req, res, filePath, httpCode);
          } else {
            res.writeHead(500);
            res.end('Server error while reading file.');
          }
        }
        break;
      case 'PUT':
        try {
          const body = await readRequestBody(req);
          await fs.writeFile(filePath, body);
          res.writeHead(201);
          res.end('Created or Updated');
        } catch (error) {
          res.writeHead(500);
          res.end('Server error on write.');
        }
        break;
      case 'DELETE':
        try {
          await fs.unlink(filePath);
          res.writeHead(200);
          res.end('Deleted');
        } catch (error) {
          if (error.code === 'ENOENT') {
            res.writeHead(404);
            res.end('File not found in cache.');
          } else {
            res.writeHead(500);
            res.end('Server error on delete.');
          }
        }
        break;
      default:
        res.writeHead(405);
        res.end('Method Not Allowed');
        break;
    }
  });

  server.listen(port, host, () => {
    console.log(` Cache server started at http://${host}:${port}`);
    console.log(` Cache directory: ${cache}`);
  });
}

async function handleProxyFetch(req, res, filePath, httpCode) {
  console.log(` File ${httpCode}.jpeg not found. Requesting from http.cat...`);

  try {
    const response = await superagent
      .get(`https://http.cat/${httpCode}`)
      .responseType('blob');

    await fs.writeFile(filePath, response.body);
    console.log(`Saved ${httpCode}.jpeg to cache.`);

    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(response.body);
  } catch (fetchError) {
    console.error(`http.cat doesn't have image for ${httpCode}.`);
    res.writeHead(404);
    res.end('Image not found in cache or http.cat server.');
  }
}

startCacheServer().catch(console.error);