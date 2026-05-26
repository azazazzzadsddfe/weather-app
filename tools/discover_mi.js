const miio = require('miio');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   米家设备发现工具                   ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log('⚠️  确保电脑和米家设备连接在同一个 WiFi 网络下\n');

  console.log('选择方式：');
  console.log('  1. 自动扫描局域网设备（需要 token，可先跳过 token 尝试）');
  console.log('  2. 用小米账号从云端获取设备列表\n');

  const choice = await ask('请输入 1 或 2: ');

  if (choice === '2') {
    console.log('\n由于小米 API 经常变动，推荐手动方式：');
    console.log('1. 电脑浏览器打开 https://home.mi.com/ 并登录你的小米账号');
    console.log('2. 登录后页面会显示你的设备列表');
    console.log('3. 按 F12 打开开发者工具，切换到 Network（网络）标签');
    console.log('4. 刷新页面，找到 "device_list" 或 "home/device_list" 请求');
    console.log('5. 点击该请求，查看 Response（响应），把内容复制给我\n');
    rl.close();
    return;
  }

  // Option 1: Try local discovery
  console.log('\n正在扫描局域网设备...（超时15秒）\n');

  try {
    const devices = await new Promise((resolve, reject) => {
      const found = [];
      const timeout = setTimeout(() => {
        browser.stop();
        resolve(found);
      }, 15000);

      // Try to discover devices on common miio ports
      const dgram = require('dgram');
      const socket = dgram.createSocket('udp4');

      socket.on('message', (msg, rinfo) => {
        try {
          const str = msg.toString('hex');
          if (!found.some(d => d.ip === rinfo.address)) {
            found.push({ ip: rinfo.address, port: rinfo.port, raw: str.slice(0, 80) + '...' });
            console.log(`  发现设备: ${rinfo.address}:${rinfo.port}`);
          }
        } catch (e) {}
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        // Send hello packet to common miio port
        const hello = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
        for (let i = 0; i < 3; i++) {
          socket.send(hello, 54321, '255.255.255.255');
          socket.send(hello, 54321, '192.168.1.255');
          socket.send(hello, 54321, '192.168.0.255');
          socket.send(hello, 54321, '192.168.31.255');
        }
      });

      setTimeout(() => clearTimeout(timeout), 15000);
    });

    if (devices.length === 0) {
      console.log('❌ 未发现任何设备。');
      console.log('\n可能原因：');
      console.log('  - 设备和电脑不在同一网络');
      console.log('  - 设备不支持局域网通信（蓝牙/zigbee子设备）');
      console.log('  - 防火墙阻止了 UDP 广播\n');
    } else {
      console.log(`\n发现 ${devices.length} 个可能的设备\n`);
    }

  } catch (e) {
    console.log(`扫描出错: ${e.message}`);
  }

  console.log('\n---');
  console.log('如果自动扫描没有找到设备，可以手动提供设备信息：');
  console.log('打开米家 App → 选择设备 → 右上角 ⋯ → 设备信息 → 查看 IP 地址');
  console.log('把 IP 地址告诉我，我帮你继续配置。');

  rl.close();
}

main();
