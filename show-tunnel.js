#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

console.log('🚀 Starting localtunnel...\n');

const lt = spawn('lt', ['--port', '3000'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: lt.stdout,
  terminal: false
});

let urlFound = false;

rl.on('line', (line) => {
  console.log(line);
  
  // Look for the URL in the output
  if (line.includes('your url is:') && !urlFound) {
    urlFound = true;
    const url = line.split('your url is: ')[1]?.trim();
    if (url) {
      console.log('\n');
      console.log('╔════════════════════════════════════════════╗');
      console.log('║   ✅ TUNNEL IS READY!                    ║');
      console.log('╠════════════════════════════════════════════╣');
      console.log(`║  URL: ${url.padEnd(36)} ║`);
      console.log('║                                            ║');
      console.log('║  Password: 106.205.191.72                 ║');
      console.log('╚════════════════════════════════════════════╝');
      console.log('\n');
    }
  }
});

lt.stderr.on('data', (data) => {
  console.error(`Error: ${data}`);
});

lt.on('close', (code) => {
  console.log(`\nTunnel closed with code ${code}`);
  process.exit(code);
});

// Handle termination gracefully
process.on('SIGINT', () => {
  console.log('\n\nStopping tunnel...');
  lt.kill();
  process.exit();
});
