const ngrok = require('ngrok');
const { exec } = require('child_process');
const path = require('path');

async function startWithNgrok() {
  console.log('🚀 Starting College OS Server with Internet Tunnel...\n');
  
  try {
    // Start NODE server on port 3000
    console.log('📦 Starting Node.js server on port 3000...');
    exec('npm run dev', {
      cwd: __dirname,
      stdio: 'inherit'
    });

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create ngrok tunnel
    console.log('\n🌐 Creating internet tunnel with ngrok...');
    const url = await ngrok.connect(3000);
    
    console.log('\n✅ SUCCESS! Your website is now accessible from internet:\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           🎉 COLLEGE OS PUBLIC URL 🎉                 ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  ${url.padEnd(54)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log('📱 Access from any device with any internet:\n');
    console.log(`   1. Copy the URL above`);
    console.log(`   2. Share with anyone`);
    console.log(`   3. Open in browser on phone/tablet/computer`);
    console.log(`   4. Works on mobile data, different WiFi, anywhere!\n`);
    
    console.log('Local Access (same WiFi):\n');
    console.log(`   📍 http://10.251.220.118:3000\n`);
    
    console.log('⚠️  Warning: Keep this terminal open while using ngrok');
    console.log('⚠️  The public URL will be valid for this session only\n');

    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      await ngrok.disconnect();
      process.exit();
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

startWithNgrok();
