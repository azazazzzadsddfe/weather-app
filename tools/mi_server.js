/**
 * 米家设备局域网控制服务器
 * 启动: node tools/mi_server.js
 * 端口: 8765
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const CONFIG_FILE = path.join(__dirname, 'mi_devices.json');

// Store connected device instances
const deviceCache = new Map();

function loadDevices() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveDevices(devices) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(devices, null, 2));
}

async function connectDevice(dev) {
  const key = `${dev.ip}:${dev.token}`;
  if (deviceCache.has(key)) return deviceCache.get(key);

  const miio = require('miio');
  try {
    const d = await miio.device({ address: dev.ip, token: dev.token, connectTimeout: 5000 });
    deviceCache.set(key, d);
    return d;
  } catch (e) {
    return null;
  }
}

async function getDeviceInfo(dev) {
  const d = await connectDevice(dev);
  if (!d) return { online: false };

  try {
    const props = ['power', 'temperature', 'humidity', 'aqi', 'brightness', 'mode', 'door_status'];
    const values = await d.call('get_prop', props);
    const info = { online: true, model: d.miioModel || d.model || 'unknown' };
    props.forEach((p, i) => { if (values[i] !== undefined) info[p] = values[i]; });
    return info;
  } catch {
    return { online: true, model: d.miioModel || 'unknown' };
  }
}

async function controlDevice(dev, action) {
  const d = await connectDevice(dev);
  if (!d) throw new Error('设备离线');

  switch (action) {
    case 'on': return d.call('set_power', ['on']);
    case 'off': return d.call('set_power', ['off']);
    case 'toggle': {
      const [p] = await d.call('get_prop', ['power']);
      return d.call('set_power', [p === 'on' ? 'off' : 'on']);
    }
    case 'status': return d.call('get_prop', ['power', 'temperature', 'humidity', 'aqi', 'brightness']);
    case 'discover': return d.call('miIO.info', []);
    default:
      if (action.startsWith('bright:')) return d.call('set_bright', [parseInt(action.split(':')[1])]);
      if (action.startsWith('temp:')) return d.call('set_temperature', [parseFloat(action.split(':')[1])]);
      throw new Error('未知操作: ' + action);
  }
}

// ====== HTTP Server ======

function json(res, data, code = 200) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, {}); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const seg = url.pathname.split('/').filter(Boolean);

  try {
    // GET /devices — list all
    if (req.method === 'GET' && seg[0] === 'devices' && !seg[1]) {
      const devices = loadDevices();
      const list = await Promise.all(devices.map(async d => {
        const info = await getDeviceInfo(d).catch(() => ({ online: false }));
        return { name: d.name, ip: d.ip, model: info.model, online: info.online, state: info };
      }));
      return json(res, { devices: list });
    }

    // POST /devices — add device
    if (req.method === 'POST' && seg[0] === 'devices' && !seg[1]) {
      const body = await parseBody(req);
      if (!body.name || !body.ip || !body.token) {
        return json(res, { error: '缺少 name/ip/token' }, 400);
      }
      const devices = loadDevices();
      const idx = devices.findIndex(d => d.ip === body.ip);
      if (idx >= 0) {
        devices[idx] = { name: body.name, ip: body.ip, token: body.token };
      } else {
        devices.push({ name: body.name, ip: body.ip, token: body.token });
      }
      saveDevices(devices);
      return json(res, { ok: true, device: { name: body.name, ip: body.ip } });
    }

    // DELETE /devices/:ip — remove device
    if (req.method === 'DELETE' && seg[0] === 'devices' && seg[1]) {
      let devices = loadDevices();
      const ip = decodeURIComponent(seg[1]);
      devices = devices.filter(d => d.ip !== ip);
      saveDevices(devices);
      deviceCache.delete(ip);
      return json(res, { ok: true });
    }

    // POST /control — control device { ip, action }
    if (req.method === 'POST' && seg[0] === 'control') {
      const body = await parseBody(req);
      if (!body.ip || !body.action) {
        return json(res, { error: '缺少 ip/action' }, 400);
      }
      const devices = loadDevices();
      const dev = devices.find(d => d.ip === body.ip);
      if (!dev) { return json(res, { error: '设备未找到: ' + body.ip }, 404); }
      const result = await controlDevice(dev, body.action);
      return json(res, { ok: true, result });
    }

    // GET /status — server status
    if (req.method === 'GET' && seg[0] === 'status') {
      return json(res, { running: true, devices: loadDevices().length, cached: deviceCache.size });
    }

    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`米家设备服务器已启动 → http://localhost:${PORT}`);
  const devices = loadDevices();
  if (devices.length === 0) {
    console.log('还没有配置设备，请在天气App中添加');
  } else {
    console.log(`已加载 ${devices.length} 个设备:`);
    devices.forEach(d => console.log(`  ${d.name} (${d.ip})`));
  }
});
