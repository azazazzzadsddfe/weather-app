const https = require('https');
const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');
const readline = require('readline');

// ====== Xiaomi Cloud API helpers ======

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = mod.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        // Handle redirects
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return request(res.headers.location, opts).then(resolve).catch(reject);
        }
        resolve({ status: res.statusCode, headers: res.headers, body, getCookie: () => {
          const setCookie = res.headers['set-cookie'] || [];
          return setCookie.map(c => c.split(';')[0]).join('; ');
        }});
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

// Xiaomi login hash
function makeHash(password, sid) {
  return md5(Buffer.from(md5(password) + sid).toString('binary'));
}

// ====== Main flow ======

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   米家设备 Token 提取工具           ║');
  console.log('║   账号密码仅在本机使用，不上传       ║');
  console.log('╚══════════════════════════════════════╝\n');

  const user = await ask('小米账号（手机号/邮箱/小米ID）: ');
  const pass = await ask('密码（输入时不可见，输完回车）: ');

  if (!user || !pass) {
    console.log('❌ 账号或密码不能为空');
    rl.close();
    return;
  }

  console.log('\n正在登录小米账号...');

  try {
    // Step 1: Get sign parameters
    const sid = 'xiaomiio';
    const loginPage = await request(
      `https://account.xiaomi.com/pass/serviceLogin?sid=${sid}&_json=true`,
      { headers: { 'User-Agent': 'MIUI-APP/6.0' } }
    );

    const loginJson = JSON.parse(loginPage.body.replace(/^[^(]*\(/, '').replace(/\)$/, ''));
    console.log(`  登录页状态: ${loginJson._sign || loginJson.qs || 'ok'}`);

    const sign = loginJson._sign || '';

    // Step 2: Login
    const loginBody = querystring.stringify({
      user: user,
      hash: makeHash(pass, sign),
      sid: sid,
      _sign: sign,
      _json: 'true',
    });

    const loginResult = await request(
      'https://account.xiaomi.com/pass/serviceLoginAuth2',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MIUI-APP/6.0',
          'Cookie': loginPage.getCookie(),
        },
        body: loginBody,
      }
    );

    const authJson = JSON.parse(loginResult.body.replace(/^[^(]*\(/, '').replace(/\)$/, ''));

    if (authJson.code && authJson.code !== 0) {
      if (authJson.code === 70016) {
        console.log('❌ 检测到验证码保护。需要通过浏览器登录获取 token。');
        console.log('\n📋 改用备用方案：');
        console.log('1. 打开浏览器访问 https://home.mi.com/');
        console.log('2. 用你的小米账号登录');
        console.log('3. 按 F12 打开开发者工具 → Application → Cookies');
        console.log('4. 找到 userId 和 serviceToken，告诉我这两个值\n');
        rl.close();
        return;
      }
      console.log(`❌ 登录失败: code=${authJson.code}, msg=${authJson.message || authJson.desc || ''}`);
      rl.close();
      return;
    }

    console.log(`  登录成功! userId=${authJson.userId}`);

    const userId = authJson.userId;
    const serviceToken = authJson.ssecurity || '';
    const loginCookie = loginResult.getCookie();

    // Step 3: Get service token (needed for API calls)
    // Sometimes serviceToken is already in the login response, sometimes need a redirect
    let actualServiceToken = serviceToken;
    if (!actualServiceToken && authJson.location) {
      const redirectRes = await request(authJson.location, {
        headers: { 'Cookie': loginCookie, 'User-Agent': 'MIUI-APP/6.0' },
      });
      console.log(`  重定向后获取 token...`);
      const cookieStr = redirectRes.getCookie();
      const match = cookieStr.match(/serviceToken=([^;]+)/);
      if (match) actualServiceToken = match[1];
    }

    if (!actualServiceToken) {
      console.log('❌ 无法获取 serviceToken，改用备用方案：');
      console.log('\n1. 打开浏览器访问 https://home.mi.com/');
      console.log('2. 用你的小米账号登录');
      console.log('3. 按 F12 → Application → Cookies → 找到 serviceToken 告诉我\n');
      rl.close();
      return;
    }

    console.log(`  serviceToken 已获取`);

    // Step 4: Get device list
    console.log('\n正在获取设备列表...\n');

    const apiCookies = `userId=${userId}; serviceToken=${actualServiceToken}`;
    const deviceList = await request(
      `https://api.io.mi.com/app/home/device_list?raw=${Date.now()}`,
      {
        headers: {
          'Cookie': apiCookies,
          'User-Agent': 'MIUI-APP/6.0',
          'Content-Type': 'application/json',
        },
      }
    );

    if (deviceList.status !== 200) {
      // Try alternate API
      console.log('  尝试备用 API...');
      const altResult = await request(
        `https://api.io.mi.com/app/device/device_list?raw=${Date.now()}`,
        {
          headers: {
            'Cookie': apiCookies,
            'User-Agent': 'MIUI-APP/6.0',
          },
        }
      );

      try {
        const altJson = JSON.parse(altResult.body);
        if (altJson.result && altJson.result.list) {
          printDevices(altJson.result.list);
          saveDevices(altJson.result.list);
        } else {
          console.log(`  响应: ${altResult.body.slice(0, 300)}`);
        }
      } catch (e) {
        console.log(`❌ 获取设备列表失败: HTTP ${altResult.status}`);
        console.log('   可能需要通过备用方案手动获取 token。');
      }
      rl.close();
      return;
    }

    const devices = JSON.parse(deviceList.body);
    const list = devices.result?.list || devices.list || [];

    if (list.length === 0) {
      console.log('没有找到任何米家设备。');
      console.log('请确认：');
      console.log('1. 账号是否绑定了设备');
      console.log('2. 设备是否在米家 App 中可见');
    } else {
      printDevices(list);
      saveDevices(list);
    }

  } catch (err) {
    console.log(`❌ 出错: ${err.message}`);
    console.log('\n改用备用方案：');
    console.log('1. 打开浏览器访问 https://home.mi.com/ 并登录');
    console.log('2. 按 F12 → Application → Cookies');
    console.log('3. 告诉我 userId 和 serviceToken');
  }
  rl.close();
}

function printDevices(list) {
  console.log(`\n找到 ${list.length} 个设备:\n`);
  console.log('─'.repeat(80));
  console.log(' 名称           | IP          | Token (前16位)       | 型号');
  console.log('─'.repeat(80));
  for (const d of list) {
    const name = (d.name || '未知').slice(0, 14).padEnd(14);
    const ip = (d.localip || '无局域网信息').padEnd(12);
    const token = (d.token || '无').slice(0, 16).padEnd(20);
    const model = (d.model || '?').slice(0, 20);
    console.log(` ${name}| ${ip}| ${token}| ${model}`);
  }
  console.log('─'.repeat(80));
}

function saveDevices(list) {
  const data = list.map(d => ({
    name: d.name,
    model: d.model,
    did: d.did,
    token: d.token,
    ip: d.localip || '',
    mac: d.mac || '',
  }));
  const fs = require('fs');
  const path = __dirname + '/mi_devices.json';
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`\n✅ 设备信息已保存到: ${path}`);

  if (data.some(d => !d.token)) {
    console.log('⚠️  部分设备没有 token（可能是蓝牙/zigbee 网关子设备）');
    console.log('   这些设备无法通过局域网直接控制');
  }
}

main();
