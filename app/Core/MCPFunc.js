/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.8
 * @Since       2026-03-15
 * @LastUpdated 2026-04-01
 * @Description MCP HTTP 服务
 * @License     MIT
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ipcMain } = require('electron');

function startMCPHttpServer(windows, createFridaIDEWindow) {
  function parseXMLSimple(xml) {
    const tools = [];
    const categoryRegex = /<category[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/category>/g;
    let categoryMatch;
    while ((categoryMatch = categoryRegex.exec(xml)) !== null) {
      const categoryName = categoryMatch[1];
      const categoryContent = categoryMatch[2];
      const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(categoryContent)) !== null) {
        const itemContent = itemMatch[1];
        const nameMatch = itemContent.match(/<text[^>]*>([\s\S]*?)<\/text>/);
        const pathMatch = itemContent.match(/<executablePath[^>]*>([\s\S]*?)<\/executablePath>/);
        const uacMatch = itemContent.match(/<uac[^>]*>([\s\S]*?)<\/uac>/);
        if (nameMatch) {
          tools.push({
            name: nameMatch[1].trim(),
            category: categoryName,
            path: pathMatch ? pathMatch[1].trim() : '',
            uac: uacMatch ? uacMatch[1].trim() : 'off'
          });
        }
      }
    }
    return tools;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sendResponse(res, request, result) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  }

  function sendErrorResponse(res, request, message) {
    sendResponse(res, request, { content: [{ type: 'text', text: message }], isError: true });
  }

  function checkFridaWindow() {
    return windows.frida && !windows.frida.isDestroyed();
  }

  function notifyToolsUpdated() {
    Object.values(windows).forEach(win => {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send('tools-updated');
      }
    });
  }

  function handleSwapTools(args) {
    const { tool1, tool2 } = args;
    const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
    try {
      let xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
      const tool1Regex = new RegExp(`(<item>\\s*<text>${escapeRegExp(tool1)}</text>[\\s\\S]*?</item>)`);
      const tool2Regex = new RegExp(`(<item>\\s*<text>${escapeRegExp(tool2)}</text>[\\s\\S]*?</item>)`);
      const tool1Match = xmlContent.match(tool1Regex);
      const tool2Match = xmlContent.match(tool2Regex);
      if (!tool1Match || !tool2Match) {
        return { content: [{ type: 'text', text: `错误：找不到工具 "${!tool1Match ? tool1 : tool2}"` }], isError: true };
      }
      const tool1Block = tool1Match[1];
      const tool2Block = tool2Match[1];
      xmlContent = xmlContent.replace(tool1Block, '___TOOL1_PLACEHOLDER___');
      xmlContent = xmlContent.replace(tool2Block, tool1Block);
      xmlContent = xmlContent.replace('___TOOL1_PLACEHOLDER___', tool2Block);
      fs.writeFileSync(toolsListPath, xmlContent, 'utf-8');
      notifyToolsUpdated();
      return { content: [{ type: 'text', text: `成功交换工具位置："${tool1}" 和 "${tool2}" 的位置已互换` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `交换工具位置失败：${error.message}` }], isError: true };
    }
  }

  function handleMoveTool(args) {
    const { toolName, targetPosition, targetCategory } = args;
    const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
    try {
      let xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
      const toolRegex = new RegExp(`(<item>\\s*<text>${escapeRegExp(toolName)}</text>[\\s\\S]*?</item>)`);
      const toolMatch = xmlContent.match(toolRegex);
      if (!toolMatch) {
        return { content: [{ type: 'text', text: `错误：找不到工具 "${toolName}"` }], isError: true };
      }
      const toolBlock = toolMatch[1];
      xmlContent = xmlContent.replace(toolBlock, '').replace(/\n\s*\n/g, '\n');
      if (targetCategory) {
        const categoryRegex = new RegExp(`(<category[^>]*name="${escapeRegExp(targetCategory)}"[^>]*>)([\\s\\S]*?)(</category>)`);
        const categoryMatch = xmlContent.match(categoryRegex);
        if (!categoryMatch) {
          return { content: [{ type: 'text', text: `错误：找不到分类 "${targetCategory}"` }], isError: true };
        }
        const categoryStart = categoryMatch[1];
        const categoryContent = categoryMatch[2];
        const categoryEnd = categoryMatch[3];
        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const items = categoryContent.match(itemRegex) || [];
        const insertIndex = Math.max(0, Math.min(targetPosition - 1, items.length));
        let newCategoryContent;
        if (items.length === 0) {
          newCategoryContent = '\n    ' + toolBlock;
        } else if (insertIndex >= items.length) {
          newCategoryContent = categoryContent + '    ' + toolBlock + '\n  ';
        } else {
          const beforeItems = items.slice(0, insertIndex).join('\n    ');
          const afterItems = items.slice(insertIndex).join('\n    ');
          newCategoryContent = beforeItems ? '\n    ' + beforeItems + '\n    ' + toolBlock + '\n    ' + afterItems + '\n  ' : '\n    ' + toolBlock + '\n    ' + afterItems + '\n  ';
        }
        xmlContent = xmlContent.replace(categoryMatch[0], categoryStart + newCategoryContent + categoryEnd);
        fs.writeFileSync(toolsListPath, xmlContent, 'utf-8');
        notifyToolsUpdated();
        return { content: [{ type: 'text', text: `成功将 "${toolName}" 移动到 "${targetCategory}" 分类的第 ${Math.min(insertIndex + 1, items.length + 1)} 个位置` }] };
      } else {
        const allCategoriesRegex = /<category[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/category>/g;
        let categoryMatch, targetCategoryName = null;
        while ((categoryMatch = allCategoriesRegex.exec(xmlContent)) !== null) {
          if (categoryMatch[2].includes(toolBlock)) {
            targetCategoryName = categoryMatch[1];
            break;
          }
        }
        if (!targetCategoryName) {
          return { content: [{ type: 'text', text: `错误：无法确定 "${toolName}" 所在的分类` }], isError: true };
        }
        xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
        const categoryRegex = new RegExp(`(<category[^>]*name="${escapeRegExp(targetCategoryName)}"[^>]*>)([\\s\\S]*?)(</category>)`);
        const catMatch = xmlContent.match(categoryRegex);
        if (catMatch) {
          const categoryStart = catMatch[1];
          const categoryContent = catMatch[2];
          const categoryEnd = catMatch[3];
          const itemRegex = /<item>[\s\S]*?<\/item>/g;
          const items = categoryContent.match(itemRegex) || [];
          const filteredItems = items.filter(item => !item.includes(`<text>${escapeRegExp(toolName)}</text>`));
          const insertIndex = Math.max(0, Math.min(targetPosition - 1, filteredItems.length));
          filteredItems.splice(insertIndex, 0, toolBlock);
          const newCategoryContent = '\n    ' + filteredItems.join('\n    ') + '\n  ';
          xmlContent = xmlContent.replace(catMatch[0], categoryStart + newCategoryContent + categoryEnd);
          fs.writeFileSync(toolsListPath, xmlContent, 'utf-8');
          notifyToolsUpdated();
          return { content: [{ type: 'text', text: `成功将 "${toolName}" 移动到 "${targetCategoryName}" 分类的第 ${insertIndex + 1} 个位置` }] };
        }
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `移动工具失败：${error.message}` }], isError: true };
    }
  }

  function handleReadFile(res, request, args) {
    const { filePath } = args;
    try {
      if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      sendResponse(res, request, { content: [{ type: 'text', text: `文件读取成功：${filePath}\n\n${content}` }] });
    } catch (error) {
      console.error('读取文件失败:', error);
      sendErrorResponse(res, request, `读取文件失败：${error.message}`);
    }
  }

  function handleRunPowerShellCommand(res, request, args) {
    const { command, timeout = 90000 } = args;
    let stdout = '', stderr = '';
    let responseSent = false;
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + command], { encoding: 'utf-8', env: { ...process.env, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' } });
    ps.stdout.on('data', (data) => { stdout += data; });
    ps.stderr.on('data', (data) => { stderr += data; });
    ps.on('close', (code) => {
      if (!responseSent) {
        responseSent = true;
        sendResponse(res, request, { content: [{ type: 'text', text: `PowerShell命令执行结果：\n${stdout}\n${stderr ? '错误：\n' + stderr : ''}` }] });
      }
    });
    ps.on('error', (error) => {
      if (!responseSent) {
        responseSent = true;
        console.error('执行PowerShell命令失败:', error);
        sendErrorResponse(res, request, `执行PowerShell命令失败：${error.message}`);
      }
    });
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        ps.kill('SIGTERM');
        sendResponse(res, request, { content: [{ type: 'text', text: `PowerShell命令执行超时（${timeout}毫秒），已终止执行。\n当前输出：\n${stdout}\n${stderr ? '错误：\n' + stderr : ''}` }] });
      }
    }, timeout);
  }

  function handleDeleteFile(res, request, args) {
    const { filePath, force = false } = args;
    try {
      if (!fs.existsSync(filePath)) {
        if (force) {
          sendResponse(res, request, { content: [{ type: 'text', text: `文件删除成功：${filePath}` }] });
          return;
        }
        throw new Error(`文件不存在: ${filePath}`);
      }
      fs.unlinkSync(filePath);
      sendResponse(res, request, { content: [{ type: 'text', text: `文件删除成功：${filePath}` }] });
    } catch (error) {
      console.error('删除文件失败:', error);
      sendErrorResponse(res, request, `删除文件失败：${error.message}`);
    }
  }

  function handleWriteFile(res, request, args) {
    const { filePath, content, overwrite = true } = args;
    try {
      if (fs.existsSync(filePath) && !overwrite) throw new Error(`文件已存在且设置为不覆盖: ${filePath}`);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      sendResponse(res, request, { content: [{ type: 'text', text: `文件写入成功：${filePath}` }] });
    } catch (error) {
      console.error('写入文件失败:', error);
      sendErrorResponse(res, request, `写入文件失败：${error.message}`);
    }
  }

  function handleRunPythonScript(res, request, args) {
    const { script, scriptPath } = args;
    try {
      const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
      const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
      const tools = parseXMLSimple(xmlContent);
      const pythonTool = tools.find(tool => tool.category === 'Language' && tool.name.includes('Python'));
      if (!pythonTool || !pythonTool.path) throw new Error('未找到Python环境');
      let pythonPath = pythonTool.path;
      if (!/^[a-zA-Z]:\\/.test(pythonTool.path)) pythonPath = path.join(__dirname, '..', '..', '..', pythonTool.path);
      if (!fs.existsSync(pythonPath)) throw new Error(`Python路径不存在: ${pythonPath}`);
      if (fs.statSync(pythonPath).isDirectory()) {
        pythonPath = path.join(pythonPath, 'python.exe');
        if (!fs.existsSync(pythonPath)) throw new Error(`Python可执行文件不存在: ${pythonPath}`);
      }
      const tempScriptPath = path.join(os.tmpdir(), `temp_${Date.now()}.py`);
      const useScriptPath = scriptPath && fs.existsSync(scriptPath);
      if (!useScriptPath) fs.writeFileSync(tempScriptPath, script);
      let stdout = '', stderr = '';
      let responseSent = false;
      const ps = spawn(pythonPath, [useScriptPath ? scriptPath : tempScriptPath], { encoding: 'utf-8' });
      ps.stdout.on('data', (data) => { stdout += data; });
      ps.stderr.on('data', (data) => { stderr += data; });
      ps.on('close', (code) => {
        if (!responseSent) {
          responseSent = true;
          if (!useScriptPath && fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
          sendResponse(res, request, { content: [{ type: 'text', text: `Python脚本执行结果：\n${stdout}\n${stderr ? '错误：\n' + stderr : ''}` }] });
        }
      });
      ps.on('error', (error) => {
        if (!responseSent) {
          responseSent = true;
          if (!useScriptPath && fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
          console.error('运行Python脚本失败:', error);
          sendErrorResponse(res, request, `运行Python脚本失败：${error.message}`);
        }
      });
      setTimeout(() => {
        if (!responseSent) {
          responseSent = true;
          ps.kill('SIGTERM');
          if (!useScriptPath && fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
          sendResponse(res, request, { content: [{ type: 'text', text: `Python脚本执行超时（90000毫秒=1分半钟），已终止执行。\n当前输出：\n${stdout}\n${stderr ? '错误：\n' + stderr : ''}` }] });
        }
      }, 90000);
    } catch (error) {
      console.error('运行Python脚本失败:', error);
      sendErrorResponse(res, request, `运行Python脚本失败：${error.message}`);
    }
  }

  function handleGetWindowsProcesses(res, request, args) {
    const { filter = '' } = args;
    let stdout = '', stderr = '';
    let responseSent = false;
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Select-Object Id, Name, MainWindowTitle | ConvertTo-Json -Compress'], { encoding: 'utf-8', env: { ...process.env, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' } });
    ps.stdout.on('data', (data) => { stdout += data; });
    ps.stderr.on('data', (data) => { stderr += data; });
    ps.on('close', (code) => {
      if (!responseSent) {
        responseSent = true;
        try {
          if (stderr) { console.error('PowerShell错误:', stderr); throw new Error(stderr); }
          let processes = JSON.parse(stdout);
          if (!Array.isArray(processes)) processes = [processes];
          if (filter) processes = processes.filter(process => process.Name.toLowerCase().includes(filter.toLowerCase()));
          sendResponse(res, request, { content: [{ type: 'text', text: `Windows进程列表：\n${JSON.stringify(processes, null, 2)}` }] });
        } catch (error) {
          console.error('获取Windows进程列表失败:', error);
          sendErrorResponse(res, request, `获取Windows进程列表失败：${error.message}`);
        }
      }
    });
    ps.on('error', (error) => {
      if (!responseSent) {
        responseSent = true;
        console.error('获取Windows进程列表失败:', error);
        sendErrorResponse(res, request, `获取Windows进程列表失败：${error.message}`);
      }
    });
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        ps.kill('SIGTERM');
        sendErrorResponse(res, request, '获取Windows进程列表超时（90000毫秒=1分半钟）');
      }
    }, 90000);
  }

  function handleRunTool(args) {
    const { toolName, forceUAC = false } = args;
    const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
    try {
      const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
      const tools = parseXMLSimple(xmlContent);
      const selectedTool = tools.find(tool => tool.name === toolName);
      if (!selectedTool) return { content: [{ type: 'text', text: `错误：找不到工具 "${toolName}"` }], isError: true };
      if (!selectedTool.path) return { content: [{ type: 'text', text: `错误：工具 "${toolName}" 没有设置可执行路径` }], isError: true };
      let executablePath = selectedTool.path;
      if (!/^[a-zA-Z]:\\/.test(selectedTool.path)) executablePath = path.join(__dirname, '..', '..', '..', selectedTool.path);
      if (!fs.existsSync(executablePath)) return { content: [{ type: 'text', text: `错误：工具路径不存在：${executablePath}` }], isError: true };
      let requiresUAC = forceUAC || selectedTool.uac === 'on';
      const stats = fs.statSync(executablePath);
      if (stats.isDirectory()) {
        require('child_process').exec(`start "" "${executablePath}"`);
      } else {
        const ext = path.extname(executablePath).toLowerCase();
        let command;
        if (ext === '.vbs') {
          command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process wscript -ArgumentList '${executablePath}' -WindowStyle Normal"`;
        } else {
          command = requiresUAC ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${executablePath}' -Verb RunAs}"` : `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${executablePath}'}"`;
        }
        require('child_process').exec(command, { encoding: 'utf-8' }, () => { });
      }
      return { content: [{ type: 'text', text: `正在运行工具：${toolName}` }] };
    } catch (error) {
      console.error('运行工具失败:', error);
      return { content: [{ type: 'text', text: `运行工具失败：${error.message}` }], isError: true };
    }
  }

  function handleWriteToFridaEditor(res, request, args) {
    const { code, replace = true } = args;
    if (!checkFridaWindow()) { sendErrorResponse(res, request, '错误：Frida IDE窗口未打开'); return; }
    let responseSent = false;
    new Promise((resolve) => {
      windows.frida.webContents.send('write-to-editor', { code, replace });
      const timeout = setTimeout(() => resolve(null), 90000);
      ipcMain.once('write-to-editor-complete', () => { clearTimeout(timeout); resolve(true); });
    }).then((success) => {
      if (!responseSent) {
        responseSent = true;
        success ? sendResponse(res, request, { content: [{ type: 'text', text: '成功向Frida IDE编辑器写入代码' }] }) : sendErrorResponse(res, request, '写入代码超时（90000毫秒=1分半钟）');
      }
    }).catch((error) => {
      if (!responseSent) {
        responseSent = true;
        sendErrorResponse(res, request, `写入代码失败：${error.message}`);
      }
    });
  }

  function handleSetFridaProcess(args) {
    const { pid, processName = '' } = args;
    if (!checkFridaWindow()) return { content: [{ type: 'text', text: '错误：Frida IDE窗口未打开' }], isError: true };
    windows.frida.webContents.send('set-frida-process', { pid, processName });
    return { content: [{ type: 'text', text: `成功设置Frida IDE目标进程：PID=${pid}${processName ? ` (${processName})` : ''}` }] };
  }

  function handleOpenFridaIDE() {
    try {
      if (typeof createFridaIDEWindow === 'function') {
        createFridaIDEWindow();
        return { content: [{ type: 'text', text: '已打开Frida IDE窗口' }] };
      }
      return { content: [{ type: 'text', text: '错误：无法找到打开Frida IDE的方法' }], isError: true };
    } catch (error) {
      return { content: [{ type: 'text', text: `打开Frida IDE失败：${error.message}` }], isError: true };
    }
  }

  function handleGetFridaProcesses(res, request, args) {
    const { filter = '' } = args;
    if (!checkFridaWindow()) { sendErrorResponse(res, request, '错误：Frida IDE窗口未打开'); return; }
    const Fridapath = path.join(__dirname, '..', 'Plugins', 'Frida');
    const fastlistProcess = spawn(`${Fridapath}/exten/Fastlist`);
    let processes = [];
    let responseSent = false;
    fastlistProcess.stdout.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const pid = parts[0];
          let name = parts.slice(2).join(' ');
          if (name.toLowerCase().endsWith('.exe')) name = name.slice(0, -4);
          if (!filter || name.toLowerCase().includes(filter.toLowerCase())) processes.push({ pid, name });
        }
      });
    });
    fastlistProcess.on('close', () => {
      if (!responseSent) {
        responseSent = true;
        if (processes.length > 0) {
          const processList = processes.map(p => `PID: ${p.pid}, 名称: ${p.name}`).join('\n');
          sendResponse(res, request, { content: [{ type: 'text', text: `找到 ${processes.length} 个进程：\n\n${processList}` }] });
        } else {
          sendResponse(res, request, { content: [{ type: 'text', text: filter ? `未找到匹配的进程：${filter}` : '未找到进程' }] });
        }
      }
    });
    fastlistProcess.on('error', (error) => {
      if (!responseSent) {
        responseSent = true;
        sendErrorResponse(res, request, `获取进程列表失败：${error.message}`);
      }
    });
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        fastlistProcess.kill('SIGTERM');
        sendErrorResponse(res, request, '获取进程列表超时（90000毫秒=1分半钟）');
      }
    }, 90000);
  }

  function handleRunFridaCode(res, request) {
    if (!checkFridaWindow()) { sendErrorResponse(res, request, '错误：Frida IDE窗口未打开'); return; }
    let responseSent = false;
    windows.frida.webContents.send('run-frida-code');
    const timeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        sendErrorResponse(res, request, '运行代码请求超时（90000毫秒=1分半钟）');
      }
    }, 90000);
    ipcMain.once('run-frida-code-response', (event, response) => {
      if (!responseSent) {
        responseSent = true;
        clearTimeout(timeout);
        response.success ? sendResponse(res, request, { content: [{ type: 'text', text: response.message }] }) : sendErrorResponse(res, request, `错误：${response.message}`);
      }
    });
  }

  function handleGetFridaTerminalOutput(res, request, args) {
    const { lines = 50 } = args;
    if (!checkFridaWindow()) { sendErrorResponse(res, request, '错误：Frida IDE窗口未打开'); return; }
    let responseSent = false;
    new Promise((resolve) => {
      windows.frida.webContents.send('get-terminal-output', { lines });
      const timeout = setTimeout(() => resolve(null), 90000);
      ipcMain.once('terminal-output-response', (event, data) => { clearTimeout(timeout); resolve(data); });
    }).then((output) => {
      if (!responseSent) {
        responseSent = true;
        output ? sendResponse(res, request, { content: [{ type: 'text', text: output.content || '终端无输出' }] }) : sendErrorResponse(res, request, '获取终端输出超时（90000毫秒=1分半钟）');
      }
    }).catch((error) => {
      if (!responseSent) {
        responseSent = true;
        sendErrorResponse(res, request, `获取终端输出失败：${error.message}`);
      }
    });
  }

  function handleGetFridaCode(res, request) {
    if (!checkFridaWindow()) { sendErrorResponse(res, request, '错误：Frida IDE窗口未打开'); return; }
    let responseSent = false;
    new Promise((resolve) => {
      windows.frida.webContents.send('get-frida-code');
      const timeout = setTimeout(() => resolve(null), 90000);
      ipcMain.once('get-frida-code-response', (event, data) => { clearTimeout(timeout); resolve(data); });
    }).then((codeResult) => {
      if (!responseSent) {
        responseSent = true;
        codeResult ? sendResponse(res, request, { content: [{ type: 'text', text: codeResult.code || '编辑器中无代码' }] }) : sendErrorResponse(res, request, '获取代码超时（90000毫秒=1分半钟）');
      }
    }).catch((error) => {
      if (!responseSent) {
        responseSent = true;
        sendErrorResponse(res, request, `获取代码失败：${error.message}`);
      }
    });
  }

  function getDirectoryStructure(dir, prefix = '') {
    let result = '';
    if (fs.existsSync(dir)) {
      const items = fs.readdirSync(dir);
      items.forEach((item, index) => {
        const itemPath = path.join(dir, item);
        const isLast = index === items.length - 1;
        const itemPrefix = isLast ? '└── ' : '├── ';
        result += `${prefix}${itemPrefix}${item}\n`;
        if (fs.statSync(itemPath).isDirectory()) {
          result += getDirectoryStructure(itemPath, prefix + (isLast ? '    ' : '│   '));
        }
      });
    }
    return result;
  }

  function handleUsePluginTools(res, request) {
    try {
      const mcpToolsDir = path.join(__dirname, '..', 'Plugins', 'McpTools');
      const structure = getDirectoryStructure(mcpToolsDir);
      sendResponse(res, request, { content: [{ type: 'text', text: `目录路径：${mcpToolsDir}\n目录结构：\n${structure}\n（请使用 Powershell 调用工具）` }] });
    } catch (error) {
      sendErrorResponse(res, request, `获取McpTools目录失败：${error.message}`);
    }
  }

  function handleSwapToolsBoxTool(args) { return handleSwapTools(args); }
  function handleMoveToolsBoxTool(args) { return handleMoveTool(args); }
  function handleRunToolsBoxTool(args) { return handleRunTool(args); }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST' && req.url === '/mcp') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let request;
        try {
          request = JSON.parse(body);
          const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
          let result;
          switch (request.method) {
            case 'initialize':
              result = { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'MetaSword', version: '1.0.0' } };
              break;
            case 'tools/list':
              result = {
                tools: [
                  { name: 'getFridaCode', description: '获取 Frida IDE 编辑器代码', inputSchema: { type: 'object', properties: {} } },
                  { name: 'getFridaProcesses', description: '获取 Frida IDE 进程列表', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: '进程名称过滤关键字（可选）' } } } },
                  { name: 'getFridaTerminalOutput', description: '获取 Frida IDE 终端输出', inputSchema: { type: 'object', properties: { lines: { type: 'number', description: '获取最后几行（默认50行）' } } } },
                  { name: 'getToolsBoxlist', description: '获取工具箱内置工具列表', inputSchema: { type: 'object', properties: {} } },
                  { name: 'getWindowsProcesses', description: '获取 Windows 进程列表', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: '进程名称过滤关键字（可选）' } } } },
                  { name: 'runPythonScript', description: '运行 Python 脚本', inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'Python脚本内容' }, scriptPath: { type: 'string', description: 'Python脚本文件路径（可选）' } }, required: ['script'] } },
                  { name: 'writeFile', description: '写入文件', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件路径' }, content: { type: 'string', description: '文件内容' }, overwrite: { type: 'boolean', description: '是否覆盖现有文件（默认为true）' } }, required: ['filePath', 'content'] } },
                  { name: 'readFile', description: '读取文件', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件路径' } }, required: ['filePath'] } },
                  { name: 'deleteFile', description: '删除文件', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件路径' }, force: { type: 'boolean', description: '是否强制删除（默认为false）' } }, required: ['filePath'] } },
                  { name: 'runPowerShellCommand', description: '运行 PowerShell 命令', inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'PowerShell命令' }, timeout: { type: 'number', description: '执行超时时间（毫秒，默认90000=1分半钟）' } }, required: ['command'] } },
                  { name: 'moveToolsBoxTool', description: '移动工具到指定位置', inputSchema: { type: 'object', properties: { toolName: { type: 'string', description: '要移动的工具名称' }, targetPosition: { type: 'integer', description: '目标位置' }, targetCategory: { type: 'string', description: '目标分类' } }, required: ['toolName', 'targetPosition'] } },
                  { name: 'openFridaIDE', description: '打开 Frida IDE 窗口', inputSchema: { type: 'object', properties: {} } },
                  { name: 'runFridaCode', description: '运行 Frida IDE 编辑器代码', inputSchema: { type: 'object', properties: {} } },
                  { name: 'runToolsBoxTool', description: '运行工具箱内置工具', inputSchema: { type: 'object', properties: { toolName: { type: 'string', description: '工具名称' }, forceUAC: { type: 'boolean', description: '是否强制以管理员身份运行' } }, required: ['toolName'] } },
                  { name: 'setFridaProcess', description: '设置 Frida IDE 目标进程 PID', inputSchema: { type: 'object', properties: { pid: { type: 'number', description: '进程 PID' }, processName: { type: 'string', description: '进程名称（可选，用于显示）' } }, required: ['pid'] } },
                  { name: 'swapToolsBoxTool', description: '交换两个工具的位置', inputSchema: { type: 'object', properties: { tool1: { type: 'string', description: '第一个工具名称' }, tool2: { type: 'string', description: '第二个工具名称' } }, required: ['tool1', 'tool2'] } },
                  { name: 'writeToFridaEditor', description: '向 Frida IDE 编辑器写入代码', inputSchema: { type: 'object', properties: { code: { type: 'string', description: '要写入的代码' }, replace: { type: 'boolean', description: '是否替换现有代码（默认为true）' } }, required: ['code'] } },
                  { name: 'usePluginTools', description: '使用内置插件进行操作', inputSchema: { type: 'object', properties: {} } }
                ]
              };
              break;
            case 'tools/call':
              const { name, arguments: args } = request.params;
              switch (name) {
                case 'getToolsBoxlist': {
                  const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
                  const tools = parseXMLSimple(xmlContent);
                  result = { content: [{ type: 'text', text: `工具箱共有 ${tools.length} 个工具:\n\n` + tools.map((t, i) => `${i + 1}. [${t.category}] ${t.name}`).join('\n') }] };
                  break;
                }
                case 'swapToolsBoxTool': result = handleSwapToolsBoxTool(args); break;
                case 'moveToolsBoxTool': result = handleMoveToolsBoxTool(args); break;
                case 'runToolsBoxTool': result = handleRunToolsBoxTool(args); break;
                case 'getWindowsProcesses': handleGetWindowsProcesses(res, request, args); return;
                case 'runPythonScript': handleRunPythonScript(res, request, args); return;
                case 'readFile': handleReadFile(res, request, args); return;
                case 'deleteFile': handleDeleteFile(res, request, args); return;
                case 'runPowerShellCommand': handleRunPowerShellCommand(res, request, args); return;
                case 'writeFile': handleWriteFile(res, request, args); return;
                case 'writeToFridaEditor': handleWriteToFridaEditor(res, request, args); return;
                case 'setFridaProcess': result = handleSetFridaProcess(args); break;
                case 'openFridaIDE': result = handleOpenFridaIDE(); break;
                case 'getFridaProcesses': handleGetFridaProcesses(res, request, args); return;
                case 'runFridaCode': handleRunFridaCode(res, request); return;
                case 'getFridaTerminalOutput': handleGetFridaTerminalOutput(res, request, args); return;
                case 'getFridaCode': handleGetFridaCode(res, request); return;
                case 'usePluginTools': handleUsePluginTools(res, request); return;
                default: result = { content: [{ type: 'text', text: '未知工具' }], isError: true }; break;
              }
              break;
            default:
              result = { error: { code: -32601, message: `方法未找到：${request.method}` } };
          }
          sendResponse(res, request, result);
        } catch (error) {
          console.error('[MCP HTTP] Error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: request?.id || null, error: { code: -32603, message: error.message } }));
        }
      });
    } else {
      res.writeHead(404); res.end();
    }
  });

  function checkPort(port, callback) {
    const net = require('net');
    const tester = net.createServer();
    tester.once('error', (err) => callback(false));
    tester.once('listening', () => { tester.close(); callback(true); });
    tester.listen(port, '127.0.0.1');
  }

  const defaultPort = 2085;
  let actualPort = defaultPort;

  checkPort(defaultPort, (isAvailable) => {
    const port = isAvailable ? defaultPort : Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
    server.listen(port, '127.0.0.1', () => {
      actualPort = port;
      console.log(`[MCP HTTP] Server running at http://127.0.0.1:${actualPort}/mcp`);
    });
  });

  return { getPort: () => actualPort };
}

module.exports = { startMCPHttpServer };
