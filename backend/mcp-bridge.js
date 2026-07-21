#!/usr/bin/env node
const http = require('http');
const https = require('https');
const readline = require('readline');

const API_URL = process.env.CRM_MCP_URL || 'http://localhost:3000/api/v1/mcp';
const API_KEY = process.env.CRM_API_KEY;

if (!API_KEY) {
  console.error("Error: CRM_API_KEY environment variable is required.");
  process.exit(1);
}

const url = new URL(API_URL);
const requestModule = url.protocol === 'https:' ? https : http;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
  };

  const req = requestModule.request(API_URL, options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      // Write the response back to stdout exactly as one line (or standard JSON format)
      try {
         // ensure it's minified JSON string
         const parsed = JSON.parse(data);
         console.log(JSON.stringify(parsed));
      } catch(e) {
         // if not valid JSON, just pass it through
         console.log(data.replace(/\n/g, ''));
      }
    });
  });

  req.on('error', (e) => {
    console.error(`MCP Bridge Request Error: ${e.message}`);
  });

  req.write(line);
  req.end();
});
