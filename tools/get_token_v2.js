const https = require('https');
const crypto = require('crypto');
const readline = require('readline');

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: opts.method || 'GET', headers: opts.headers || {},
      rejectUnauthorized: false,
    };
    const r = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let cookies = '';
        if (res.headers['set-cookie']) {
          cookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        }
        resolve({ status: res.statusCode, headers: res.headers, body, cookies });
      });
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('timeout')); });
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   米家 Token 提取 V2                  ║');
  console.log('╚══════════════════════════════════════╝\n');

  const user = await ask('小米账号: ');
  const pass = await ask('密码: ');

  if (!user || !pass) { console.log('账号密码不能为空'); rl.close(); return; }

  console.log('\n[1/3] 登录小米账号...');

  try {
    // Step 1: Get sign from login page
    const r1 = await req(
      'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true',
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } }
    );

    // Try to parse JSON from the response (it's wrapped in callback sometimes)
    let signData;
    const rawBody = r1.body;

    // Try direct JSON first
    try {
      signData = JSON.parse(rawBody);
    } catch {
      // Try stripping callback wrapper
      const jsonMatch = rawBody.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { signData = JSON.parse(jsonMatch[0]); } catch { signData = {}; }
      } else {
        signData = {};
      }
    }

    const sign = signData._sign || '';
    const qsParam = signData.qs || '';
    console.log(`  Login page loaded, sign=${sign ? sign.slice(0,20)+'...' : 'none'}, qs=${qsParam}`);

    // Step 2: Submit login
    const passHash = md5(pass);
    const combinedHash = md5(Buffer.from(passHash + sign, 'binary'));

    const loginBody = new URLSearchParams({
      user: user,
      hash: combinedHash,
      sid: 'xiaomiio',
      _sign: sign,
      _json: 'true',
    }).toString();

    const r2 = await req(
      'https://account.xiaomi.com/pass/serviceLoginAuth2',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': r1.cookies,
          'User-Agent': 'Mozilla/5.0',
        },
        body: loginBody,
      }
    );

    // Parse login response
    let authData;
    try {
      authData = JSON.parse(r2.body);
    } catch {
      const jsonMatch = r2.body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { authData = JSON.parse(jsonMatch[0]); } catch { authData = {}; }
      } else {
        console.log(`  Raw response: ${r2.body.slice(0, 500)}`);
        authData = { code: -1 };
      }
    }

    console.log(`  Login result: code=${authData.code}, msg=${authData.message || authData.desc || '(none)'}`);

    // Check for common error codes
    if (authData.code === 87001) {
      console.log('\n❌ 需要验证码。请用手机浏览器打开 https://account.xiaomi.com');
      console.log('   登录后，在地址栏找到类似 "ssecurity=xxx" 的参数，把整个URL发给我');
      rl.close(); return;
    }
    if (authData.code === 70016) {
      console.log('\n❌ 需要图形验证码。请用手机上的米家 App 登录确认，然后重试');
      rl.close(); return;
    }

    const userId = authData.userId;
    const ssecurity = authData.ssecurity;
    const location = authData.location;

    if (!userId || (!ssecurity && !location)) {
      console.log(`\n❌ 登录未成功。可能需要两步验证。`);
      console.log(`   请在手机米家 App 中确认登录请求，然后重试`);
      rl.close(); return;
    }

    let serviceToken = ssecurity || '';
    let finalCookies = r2.cookies;

    // If there's a redirect location, follow it to get the serviceToken
    if (location && !serviceToken) {
      console.log('  跟随重定向获取 token...');
      const r3 = await req(location, {
        headers: { 'Cookie': finalCookies, 'User-Agent': 'Mozilla/5.0' },
      });
      finalCookies = (finalCookies + '; ' + r3.cookies).trim();
      const m = r3.cookies.match(/serviceToken=([^;]+)/);
      if (m) serviceToken = m[1];
      if (!serviceToken) {
        // Try from the redirect location URL itself
        const urlMatch = r3.headers.location?.match(/serviceToken=([^&]+)/);
        if (urlMatch) serviceToken = urlMatch[1];
      }
    }

    if (!serviceToken) {
      console.log('\n❌ 未能提取 serviceToken');
      console.log('   Cookies: ' + finalCookies.slice(0, 200));
      rl.close(); return;
    }

    console.log(`  ✓ 登录成功! userId=${userId}`);
    console.log(`  serviceToken=${serviceToken.slice(0, 20)}...`);

    // Step 3: Get device list
    console.log('\n[2/3] 获取设备列表...');

    const deviceUrl = `https://api.io.mi.com/app/home/device_list?data=${encodeURIComponent(JSON.stringify({}))}`;
    const r4 = await req(deviceUrl, {
      headers: {
        'Cookie': `userId=${userId}; serviceToken=${serviceToken}`,
        'User-Agent': 'Mozilla/5.0',
      },
    });

    console.log(`  HTTP ${r4.status}`);
    let devices = [];

    try {
      const devData = JSON.parse(r4.body);
      const list = devData.result?.list || devData.data?.devices || devData.list || [];
      devices = list;
    } catch {
      console.log(`  响应: ${r4.body.slice(0, 500)}`);
    }

    if (devices.length === 0) {
      console.log('\n❌ 未获取到设备列表');
      console.log('可能原因: 1) 账号没有绑定设备  2) API 已变更');
    } else {
      console.log(`\n✅ 找到 ${devices.length} 个设备!\n`);
      console.log('名称'.padEnd(16) + 'IP'.padEnd(16) + 'Token'.padEnd(36) + '型号');
      console.log('─'.repeat(80));
      for (const d of devices) {
        const name = (d.name || '?').padEnd(14);
        const ip = (d.localip || '?').padEnd(14);
        const token = (d.token || '无').padEnd(34);
        const model = (d.model || '?').padEnd(20);
        console.log(`${name} ${ip} ${token} ${model}`);
      }

      // Save to file
      const fs = require('fs');
      fs.writeFileSync(__dirname + '/mi_devices.json',
        JSON.stringify(devices.map(d => ({
          name: d.name, model: d.model, ip: d.localip,
          token: d.token, did: d.did, mac: d.mac
        })), null, 2)
      );
      console.log('\n✅ 已保存到 tools/mi_devices.json');
    }

  } catch (err) {
    console.log(`\n❌ 错误: ${err.message}`);
  }
  rl.close();
}

main();
