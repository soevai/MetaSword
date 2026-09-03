/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2026-08-01
 * @LastUpdated 2026-09-01
 * @Description 浏览器自动化隔离进程（BrowserBridge）
 * @License     MIT
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const BROWSER_CHANNELS = ['chrome', 'msedge'];
const PROFILE_ROOT = path.resolve(
  process.env.METASWORD_USER_DATA || process.env.LOCALAPPDATA || process.env.APPDATA || (os.homedir && os.homedir()) || os.tmpdir(),
  process.env.METASWORD_USER_DATA ? '' : 'MetaSword',
  'browser-profile'
);

let ctx = null;
let page = null;
const networkRequests = [];

function log(msg) {
  process.stderr.write(`[BrowserBridge] ${msg}\n`);
}

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function sendErr(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } }) + '\n');
}

async function ensurePage() {
  if (ctx && page && !page.isClosed()) return page;
  if (ctx) {
    try { page = await ctx.newPage(); return page; } catch { ctx = null; }
  }
  const pw = require('playwright-core');
  let lastErr = null;
  for (const channel of BROWSER_CHANNELS) {
    try {
      const profileDir = path.join(PROFILE_ROOT, channel);
      try { fs.mkdirSync(profileDir, { recursive: true }); } catch { }
      ctx = await pw.chromium.launchPersistentContext(profileDir, {
        channel,
        headless: false,
        viewport: null,
        chromiumSandbox: true,
        args: ['--window-size=1440,960', '--window-position=-5,0', '--no-restore-session-state'],
        timeout: 30000,
      });

      const allPages = ctx.pages();
      for (let i = 1; i < allPages.length; i++) {
        try { await allPages[i].close(); } catch { }
      }
      page = ctx.pages()[0] || (await ctx.newPage());
      page.on('crash', () => { log('PAGE CRASH detected'); page = null; });
      page.on('close', () => { log('page closed'); });
      page.on('request', (req) => {
        const type = req.resourceType();
        if (type === 'xhr' || type === 'fetch' || type === 'script') {
          networkRequests.push({ url: req.url(), method: req.method(), type, time: Date.now() });
        }
      });
      page.on('response', (res) => {
        const url = res.url();
        const existing = networkRequests.find(r => r.url === url && !r.status);
        if (existing) {
          existing.status = res.status();
          existing.size = res.headers()['content-length'] ? parseInt(res.headers()['content-length']) : null;
        }
      });
      ctx.on('close', () => { ctx = null; page = null; });
      log(`browser started: ${channel}`);
      return page;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('没有可用的浏览器（需要 Edge 或 Chrome）');
}

function buildLocator(page, args) {
  const { selector, role, name, text } = args || {};
  if (selector) return page.locator(selector);
  if (role) return page.getByRole(role, (name && name.trim()) ? { name: name.trim() } : {});
  if (text) return page.getByText(text);
  return null;
}

async function handle(method, args, id) {
  try {
    switch (method) {
      case 'navigate': {
        let url = (args && args.url ? String(args.url).trim() : '');
        if (!url) { sendErr(id, '缺少参数：url'); return; }
        if (!/^https?:\/\//i.test(url)) {
          if (/^file:\/\//i.test(url)) { sendErr(id, '不支持 file:// 协议（禁止读取本地文件）'); return; }
          url = 'https://' + url;
        }
        const u = new URL(url);
        const priv = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' ||
          u.hostname.startsWith('127.') || u.hostname.startsWith('10.') ||
          u.hostname.startsWith('192.168.') || u.hostname === '0.0.0.0';
        let is172 = false;
        if (u.hostname.startsWith('172.')) {
          const oct2 = parseInt(u.hostname.split('.')[1]);
          is172 = !isNaN(oct2) && oct2 >= 16 && oct2 <= 31;
        }
        if (priv || is172) {
          sendErr(id, '禁止访问内网地址（localhost / 内网 IP）'); return;
        }
        const p = await ensurePage();
        const waitUntil = (args && args.waitUntil === 'networkidle') ? 'networkidle' : 'domcontentloaded';
        await p.goto(url.toString(), { timeout: 45000, waitUntil });
        await p.waitForTimeout(800);
        let title = '';
        try { title = await p.title(); } catch { }
        send(id, { content: [{ type: 'text', text: `已打开：${p.url()}（${title}）` }] });
        break;
      }
      case 'snapshot': {
        const p = await ensurePage();
        const yaml = await p.evaluate(() => {
          const body = document.body;
          if (!body) return '';
          const lines = [];

          const title = document.title || '无标题页面';
          lines.push(`[页面: ${title}]`);
          lines.push(`[URL: ${location.href}]`);
          const sel = 'button,a,input,select,textarea,label,summary,details,' +
            'h1,h2,h3,h4,h5,h6,' +
            '[role],[tabindex],[aria-label],[aria-expanded],[aria-selected],[aria-pressed],[aria-haspopup],' +
            '[placeholder],[onclick],[onmousedown],[data-testid],[data-action],[data-click]';

          function collect(root, prefix) {
            const els = root.querySelectorAll(sel);
            for (const el of els) {
              const tag = (el.tagName || '').toLowerCase();
              if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || tag === 'option') continue;
              if (el.getAttribute('aria-hidden') === 'true') continue;

              if (el.offsetParent === null && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) continue;
              }
              const role = el.getAttribute('role') || '';
              const tabIdx = el.getAttribute('tabindex');
              const isFocusable = tabIdx !== null && Number(tabIdx) >= 0;
              const hasOnClick = el.hasAttribute('onclick') || el.hasAttribute('onmousedown');
              const hasAriaState = el.hasAttribute('aria-expanded') || el.hasAttribute('aria-selected') || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-haspopup');
              const hasDataAttr = el.hasAttribute('data-testid') || el.hasAttribute('data-action') || el.hasAttribute('data-click');
              const isStrict = ['button', 'a', 'input', 'select', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
              const isImg = tag === 'img' && (hasOnClick || isFocusable || !!role);
              const isNative = tag === 'summary' || tag === 'details';
              const isDynamic = role || isFocusable || hasOnClick || hasAriaState || hasDataAttr;
              if (!isStrict && !isDynamic && !isNative && !isImg) continue;
              const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
              const inputType = el.getAttribute('type') || '';
              const href = el.getAttribute('href') || '';
              const elName = el.getAttribute('name') || '';
              let maxLen = 50;
              if (['div', 'li', 'span', 'p', 'section', 'article', 'tr'].includes(tag)) maxLen = 30;
              else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) maxLen = 0;
              let elText = '';
              if (maxLen > 0) {
                let txt = '';
                for (const child of el.childNodes) {
                  if (child.nodeType === 3) txt += child.textContent;
                  if (txt.length > maxLen) break;
                }
                elText = txt.trim().slice(0, maxLen);
              }
              let desc = prefix + tag;
              if (role) desc += `[role="${role}"]`;
              if (label) desc += ` "${label}"`;
              if (elName) desc += ` name="${elName}"`;
              if (inputType) desc += ` type="${inputType}"`;
              if (href) desc += ` href="${href}"`;
              if (isImg) {
                const alt = el.getAttribute('alt') || '';
                if (alt) desc += ` alt="${alt.slice(0, 40)}"`;
              }
              if (elText && elText !== label) desc += ` "${elText}"`;
              lines.push(desc);
            }

            const iframes = root.querySelectorAll('iframe');
            for (const iframe of iframes) {
              try {
                const doc = iframe.contentDocument;
                if (doc && doc.body) {
                  const name = iframe.getAttribute('name') || iframe.getAttribute('id') || '';
                  lines.push(prefix + `[iframe${name ? ' ' + name : ''}]`);
                  collect(doc.body, prefix + '  ');
                }
              } catch (_) { }
            }
          }

          collect(body, '');
          return lines.join('\n');
        });
        const clipped = yaml.length > 12000
          ? yaml.slice(0, 12000) + '\n…（快照过长已截断，可换更具体的操作）'
          : yaml;
        send(id, { content: [{ type: 'text', text: clipped || '(页面为空)' }] });
        break;
      }
      case 'click': {
        const p = await ensurePage();
        const loc = buildLocator(p, args);
        if (!loc) { sendErr(id, '缺少定位参数：selector / role(+name) / text 三选一'); return; }
        const btn = (args && args.button === 'right') ? 'right' : ((args && args.button === 'middle') ? 'middle' : 'left');
        await loc.click({ button: btn, timeout: 15000 });
        send(id, { content: [{ type: 'text', text: btn === 'right' ? '右键点击完成' : '点击完成' }] });
        break;
      }
      case 'hover': {
        const p = await ensurePage();
        const loc = buildLocator(p, args);
        if (!loc) { sendErr(id, '缺少定位参数：selector / role(+name) / text 三选一'); return; }
        await loc.hover({ timeout: 10000 });
        send(id, { content: [{ type: 'text', text: '悬停完成' }] });
        break;
      }
      case 'double_click': {
        const p = await ensurePage();
        const loc = buildLocator(p, args);
        if (!loc) { sendErr(id, '缺少定位参数：selector / role(+name) / text 三选一'); return; }
        await loc.dblclick({ timeout: 15000 });
        send(id, { content: [{ type: 'text', text: '双击完成' }] });
        break;
      }
      case 'drag': {
        const p = await ensurePage();
        const fromLoc = buildLocator(p, args);
        if (!fromLoc) { sendErr(id, '缺少定位参数：selector / role(+name) / text 三选一（拖拽起点）'); return; }
        const toArgs = (args && args.to) || {};
        const toLoc = buildLocator(p, toArgs);
        if (!toLoc) { sendErr(id, '缺少目标定位参数：to.selector / to.role / to.text（拖拽终点）'); return; }
        await fromLoc.dragTo(toLoc, { timeout: 15000 });
        send(id, { content: [{ type: 'text', text: '拖拽完成' }] });
        break;
      }
      case 'type': {
        const text = args && args.text !== undefined ? String(args.text) : null;
        if (text === null) { sendErr(id, '缺少参数：text'); return; }
        const p = await ensurePage();
        const loc = buildLocator(p, args);
        if (!loc) { sendErr(id, '缺少定位参数：selector / role(+name) / text 三选一'); return; }
        await loc.fill(text, { timeout: 15000 });
        if (args && args.submit) {
          await Promise.all([
            p.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => { }),
            p.keyboard.press('Enter'),
          ]);
        }
        send(id, { content: [{ type: 'text', text: `已输入${args && args.submit ? '并回车' : ''}：${text}` }] });
        break;
      }
      case 'screenshot': {
        const p = await ensurePage();
        const fullPage = args && args.fullPage === true;
        const dir = path.join(process.env.APPDATA || os.tmpdir(), 'MetaSword', 'images');
        fs.mkdirSync(dir, { recursive: true });
        const d = new Date();
        const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}-${String(d.getMilliseconds()).padStart(3, '0')}`;
        const file = path.join(dir, `browser-${ts}.png`);
        await p.screenshot({ path: file, fullPage });
        send(id, { content: [{ type: 'text', text: `截图已保存${fullPage ? '（全页）' : ''}：${file}` }] });
        break;
      }
      case 'close': {
        if (!ctx) { send(id, { content: [{ type: 'text', text: '浏览器未在运行' }] }); return; }
        await ctx.close();
        ctx = null; page = null;
        send(id, { content: [{ type: 'text', text: '浏览器已关闭' }] });
        break;
      }
      case 'new_tab': {
        await ensurePage();
        const newPage = await ctx.newPage();
        page = newPage;
        send(id, { content: [{ type: 'text', text: '已打开新标签页' }] });
        break;
      }
      case 'switch_tab': {
        if (!ctx) { sendErr(id, '浏览器未在运行'); return; }
        const idx = (args && args.index !== undefined && !Number.isNaN(Number(args.index))) ? Number(args.index) : 0;
        const pages = ctx.pages();
        if (idx < 0 || idx >= pages.length) { sendErr(id, `标签页索引越界：共 ${pages.length} 个标签页（索引 0~${pages.length - 1}）`); return; }
        page = pages[idx];
        await page.bringToFront();
        send(id, { content: [{ type: 'text', text: `已切换到标签页 ${idx}（共 ${pages.length} 个）` }] });
        break;
      }
      case 'scroll': {
        const p = await ensurePage();
        const hasTarget = args && (args.selector || args.role || args.text);
        if (hasTarget) {
          const loc = buildLocator(p, args);
          if (!loc) { sendErr(id, '缺少定位参数'); return; }
          await loc.scrollIntoViewIfNeeded({ timeout: 10000 });
          send(id, { content: [{ type: 'text', text: '已滚动到元素位置' }] });
        } else {
          const delta = (args && args.delta !== undefined && !Number.isNaN(Number(args.delta))) ? Number(args.delta) : NaN;
          if (Number.isNaN(delta)) { sendErr(id, '缺少参数：delta（像素，正=向下）或 selector/role/text（滚动到元素）'); return; }
          await p.evaluate((d) => window.scrollBy(0, d), delta);
          send(id, { content: [{ type: 'text', text: delta === 0 ? '滚动量 0（无操作）' : `已滚动 ${delta > 0 ? '向下' : '向上'} ${Math.abs(delta)}px` }] });
        }
        break;
      }
      case 'press_key': {
        const key = args && args.key ? String(args.key).trim() : '';
        if (!key) { sendErr(id, '缺少参数：key'); return; }
        const p = await ensurePage();
        await p.keyboard.press(key);
        send(id, { content: [{ type: 'text', text: `已按下：${key}` }] });
        break;
      }
      case 'select_option': {
        const p = await ensurePage();
        const loc = buildLocator(p, args);
        if (!loc) { sendErr(id, '缺少定位参数：selector / role(+name) / text 三选一'); return; }
        const val = args && args.value !== undefined ? String(args.value) : null;
        const lbl = args && args.label !== undefined ? String(args.label) : null;
        const idx = (args && args.index !== undefined && !Number.isNaN(Number(args.index))) ? Number(args.index) : null;
        if (val !== null) await loc.selectOption({ value: val }, { timeout: 10000 });
        else if (lbl !== null) await loc.selectOption({ label: lbl }, { timeout: 10000 });
        else if (idx !== null) await loc.selectOption({ index: idx }, { timeout: 10000 });
        else { sendErr(id, '缺少选择参数：value / label / index 三选一'); return; }
        send(id, { content: [{ type: 'text', text: '选项已选择' }] });
        break;
      }
      case 'wait': {
        const p = await ensurePage();
        const ms = (args && args.ms !== undefined && !Number.isNaN(Number(args.ms)) && Number(args.ms) > 0) ? Number(args.ms) : 5000;
        if (args && (args.selector || args.role || args.text)) {
          const loc = buildLocator(p, args);
          if (!loc) { sendErr(id, '缺少定位参数'); return; }
          await loc.waitFor({ state: 'visible', timeout: ms });
          send(id, { content: [{ type: 'text', text: '等待的元素已出现' }] });
        } else {
          await p.waitForTimeout(ms);
          send(id, { content: [{ type: 'text', text: `已等待 ${ms}ms` }] });
        }
        break;
      }
      case 'evaluate': {
        const script = args && args.script ? String(args.script).trim() : '';
        if (!script) { sendErr(id, '缺少参数：script'); return; }
        const p = await ensurePage();
        const result = await p.evaluate(script);
        let text;
        try {
          text = result === undefined ? 'undefined' : (typeof result === 'string' ? result : JSON.stringify(result));
        } catch (_) {
          text = String(result);
        }
        send(id, { content: [{ type: 'text', text }] });
        break;
      }
      case 'back': {
        const p = await ensurePage();
        await p.goBack({ timeout: 30000, waitUntil: 'domcontentloaded' });
        send(id, { content: [{ type: 'text', text: `已后退：${p.url()}` }] });
        break;
      }
      case 'forward': {
        const p = await ensurePage();
        await p.goForward({ timeout: 30000, waitUntil: 'domcontentloaded' });
        send(id, { content: [{ type: 'text', text: `已前进：${p.url()}` }] });
        break;
      }
      case 'hide_window': {
        const p = await ensurePage();
        const session = await ctx.newCDPSession(p);
        try {
          const { windowId } = await session.send('Browser.getWindowForTarget');
          await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        } finally {
          try { await session.detach(); } catch { }
        }
        send(id, { content: [{ type: 'text', text: '浏览器窗口已隐藏，后台操作继续进行' }] });
        break;
      }
      case 'show_window': {
        const p = await ensurePage();
        const session = await ctx.newCDPSession(p);
        try {
          const { windowId } = await session.send('Browser.getWindowForTarget');
          await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        } finally {
          try { await session.detach(); } catch { }
        }
        send(id, { content: [{ type: 'text', text: '浏览器窗口已显示' }] });
        break;
      }
      case 'network_requests': {
        const clear = args && args.clear !== false;
        const list = clear ? networkRequests.splice(0, networkRequests.length) : [...networkRequests];
        const lines = list.map(r => `${r.status || '...'} ${r.method} ${r.type} ${r.url}${r.size ? ' (' + r.size + 'B)' : ''}`);
        const text = lines.length > 0 ? `共 ${list.length} 条请求（XHR/Fetch/JS）：\n${lines.join('\n')}` : '暂无网络请求';
        send(id, { content: [{ type: 'text', text }] });
        break;
      }
      default:
        sendErr(id, `未知方法：${method}`);
    }
  } catch (e) {
    let msg = e.message || '';
    if (/strict mode violation/i.test(msg)) {
      msg = '匹配到多个元素，请提供更精确的 selector 或 name';
    } else if (/timeout/i.test(msg)) {
      msg = '操作超时，请检查网络或页面是否加载完成';
    } else if (/no such element|not found|does not exist/i.test(msg)) {
      msg = '未找到指定元素，请确认 selector/role/text 是否正确';
    } else if (/target closed/i.test(msg)) {
      msg = '浏览器页面已关闭，请重新打开网页';
    } else if (/navigation failed|net::err/i.test(msg)) {
      msg = '网络请求失败，请检查网址是否正确或网络是否可用';
    } else if (/element is not visible|not visible/i.test(msg)) {
      msg = '元素不可见，请先滚动到该元素位置或等待其出现';
    }
    sendErr(id, `${method} 失败：${msg}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: null, terminal: false });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (!req || !req.method) return;
  handle(req.method, req.params || {}, req.id);
});
rl.on('close', () => { log('stdin closed, exiting'); cleanup(); });

log('started');

async function cleanup() {
  if (ctx) {
    try { await ctx.close(); } catch (_) { }
    ctx = null; page = null;
  }
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('beforeExit', cleanup);
