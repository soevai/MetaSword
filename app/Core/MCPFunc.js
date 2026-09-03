/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2026-03-15
 * @LastUpdated 2026-09-01
 * @Description MCP HTTP 服务接口模块（MCPFunc）
 * @License     MIT
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { ipcMain, app } = require('electron');

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
      return { content: [{ type: 'text', text: `已交换 "${tool1}" ↔ "${tool2}"` }] };
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
        return { content: [{ type: 'text', text: `已移动 "${toolName}" → ${targetCategory} #${targetPosition}` }] };
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
          return { content: [{ type: 'text', text: `已移动 "${toolName}" → ${targetCategoryName} #${insertIndex + 1}` }] };
        }
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `移动工具失败：${error.message}` }], isError: true };
    }
  }

  function handleReadFile(res, request, args) {
    if (!args || typeof args.filePath !== 'string') { sendErrorResponse(res, request, '缺少参数：filePath'); return; }
    const { filePath } = args;
    try {
      if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      sendResponse(res, request, { content: [{ type: 'text', text: content }] });
    } catch (error) {
      console.error('读取文件失败:', error);
      sendErrorResponse(res, request, `读取文件失败：${error.message}`);
    }
  }

  function handleRunPowerShellCommand(res, request, args) {
    if (!args || typeof args.command !== 'string') { sendErrorResponse(res, request, '缺少参数：command'); return; }
    const { command, timeout = 90000 } = args;
    let stdout = '', stderr = '';
    let responseSent = false;
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + command], { encoding: 'utf-8', env: { ...process.env, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' } });
    ps.stdout.on('data', (data) => { stdout += data; });
    ps.stderr.on('data', (data) => { stderr += data; });
    ps.on('close', (code) => {
      if (!responseSent) {
        responseSent = true;
        sendResponse(res, request, { content: [{ type: 'text', text: stdout + (stderr ? '\n' + stderr : '') }] });
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
        sendResponse(res, request, { content: [{ type: 'text', text: `超时 ${timeout}ms\n${stdout}${stderr ? '\n' + stderr : ''}` }] });
      }
    }, timeout);
  }

  function handleDeleteFile(res, request, args) {
    if (!args || typeof args.filePath !== 'string') { sendErrorResponse(res, request, '缺少参数：filePath'); return; }
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
    if (!args || typeof args.filePath !== 'string' || typeof args.content !== 'string') { sendErrorResponse(res, request, '缺少参数：filePath 和 content'); return; }
    const { filePath, content, overwrite = true } = args;
    try {
      if (fs.existsSync(filePath) && !overwrite) throw new Error(`文件已存在且设置为不覆盖: ${filePath}`);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      sendResponse(res, request, { content: [{ type: 'text', text: `已写入 ${filePath}` }] });
    } catch (error) {
      console.error('写入文件失败:', error);
      sendErrorResponse(res, request, `写入文件失败：${error.message}`);
    }
  }

  function handleRunPythonScript(res, request, args) {
    if (!args || typeof args.script !== 'string') { sendErrorResponse(res, request, '缺少参数：script'); return; }
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
          sendResponse(res, request, { content: [{ type: 'text', text: stdout + (stderr ? '\n' + stderr : '') }] });
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
          sendResponse(res, request, { content: [{ type: 'text', text: `超时 90s\n${stdout}${stderr ? '\n' + stderr : ''}` }] });
        }
      }, 90000);
    } catch (error) {
      console.error('运行Python脚本失败:', error);
      sendErrorResponse(res, request, `运行Python脚本失败：${error.message}`);
    }
  }

  function handleRunJava(res, request, args) {
    if (!args) { sendErrorResponse(res, request, '缺少参数：script 或 scriptPath'); return; }
    const { script, scriptPath, jarArgs = [] } = args;
    try {
      const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
      const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
      const tools = parseXMLSimple(xmlContent);
      const javaTool = tools.find(tool => tool.category === 'Language' && tool.name.toLowerCase().includes('java'));
      if (!javaTool || !javaTool.path) throw new Error('未找到Java环境');
      let javaPath = javaTool.path;
      if (!/^[a-zA-Z]:\\/.test(javaTool.path)) javaPath = path.join(__dirname, '..', '..', '..', javaTool.path);
      if (fs.statSync(javaPath).isDirectory()) {
        javaPath = path.join(javaPath, 'java.exe');
        if (!fs.existsSync(javaPath)) throw new Error(`Java可执行文件不存在: ${javaPath}`);
      }
      let tempScriptPath;
      if (!scriptPath) {
        const classMatch = (script || '').match(/class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : ('Java_' + Date.now());
        tempScriptPath = path.join(os.tmpdir(), className + '.java');
      }
      let resolvedPath = scriptPath;
      if (scriptPath && !path.isAbsolute(scriptPath)) {
        resolvedPath = path.join(__dirname, '..', 'Plugins', scriptPath);
      }
      const useScriptPath = resolvedPath && fs.existsSync(resolvedPath);
      const srcFile = useScriptPath ? resolvedPath : tempScriptPath;
      if (!useScriptPath) {
        if (!script) throw new Error('请提供 Java 代码或 jar 路径');
        fs.writeFileSync(tempScriptPath, script);
      }
      const isJar = srcFile.toLowerCase().endsWith('.jar');
      if (isJar) {
        const spawnArgs = ['-jar', srcFile, ...jarArgs];
        runProcess(javaPath, spawnArgs, srcFile, !useScriptPath, tempScriptPath, res, request);
      } else {
        const javacPath = javaPath.replace(/java\.exe$/i, 'javac.exe');
        if (!fs.existsSync(javacPath)) throw new Error('javac.exe 不存在，请安装 JDK');
        const classDir = path.dirname(srcFile);
        const className = path.basename(srcFile, '.java');
        const compile = spawn(javacPath, ['-encoding', 'utf-8', srcFile, '-d', classDir], { encoding: 'utf-8' });
        let compileErr = '';
        compile.stderr.on('data', (data) => { compileErr += data; });
        compile.on('close', (code) => {
          if (code !== 0) {
            if (!useScriptPath && fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
            sendResponse(res, request, { content: [{ type: 'text', text: '编译失败：\n' + compileErr }], isError: true });
            return;
          }
          runProcess(javaPath, ['-cp', classDir, className], srcFile, !useScriptPath, tempScriptPath, res, request);
        });
        compile.on('error', (error) => {
          if (!useScriptPath && fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
          sendErrorResponse(res, request, '编译失败：' + error.message);
        });
      }
      return;
    } catch (error) {
      console.error('运行Java失败:', error);
      sendErrorResponse(res, request, `运行Java失败：${error.message}`);
    }
  }

  function runProcess(exePath, exeArgs, srcFile, needsCleanup, tempPath, res, request) {
    let stdout = '', stderr = '';
    let responseSent = false;
    const ps = spawn(exePath, exeArgs, { encoding: 'utf-8' });
    ps.stdout.on('data', (data) => { stdout += data; });
    ps.stderr.on('data', (data) => { stderr += data; });
    ps.on('close', (code) => {
      if (!responseSent) {
        responseSent = true;
        if (needsCleanup && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        sendResponse(res, request, { content: [{ type: 'text', text: stdout + (stderr ? '\n' + stderr : '') }] });
      }
    });
    ps.on('error', (error) => {
      if (!responseSent) {
        responseSent = true;
        if (needsCleanup && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        sendErrorResponse(res, request, `运行失败：${error.message}`);
      }
    });
    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        ps.kill('SIGTERM');
        if (needsCleanup && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        sendResponse(res, request, { content: [{ type: 'text', text: `超时 90s\n${stdout}${stderr ? '\n' + stderr : ''}` }] });
      }
    }, 90000);
  }

  function handleRunC(res, request, args) {
    if (!args || typeof args.script !== 'string') { sendErrorResponse(res, request, '缺少参数：script'); return; }
    const { script, scriptPath } = args;
    try {
      const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
      const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
      const tools = parseXMLSimple(xmlContent);
      const cTool = tools.find(tool => tool.category === 'Language' && tool.name.toLowerCase().includes('c'));
      if (!cTool || !cTool.path) throw new Error('未找到C环境');
      let ccPath = cTool.path;
      if (!/^[a-zA-Z]:\\/.test(cTool.path)) ccPath = path.join(__dirname, '..', '..', '..', cTool.path);
      if (fs.statSync(ccPath).isDirectory()) {
        ccPath = path.join(ccPath, 'gcc.exe');
        if (!fs.existsSync(ccPath)) throw new Error(`C编译器不存在: ${ccPath}`);
      }
      const tempDir = path.join(os.tmpdir(), 'c_' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      const tempSrc = path.join(tempDir, 'code.c');
      const tempExe = path.join(tempDir, 'code.exe');
      const useScriptPath = scriptPath && fs.existsSync(scriptPath);
      if (!useScriptPath) fs.writeFileSync(tempSrc, script);
      const srcFile = useScriptPath ? scriptPath : tempSrc;
      let stdout = '', stderr = '';
      let responseSent = false;

      const compile = spawn(ccPath, [srcFile, '-o', tempExe], { encoding: 'utf-8' });
      compile.stderr.on('data', (data) => { stderr += data; });
      compile.on('close', (code) => {
        if (code !== 0) {
          if (!responseSent) { responseSent = true; cleanup(); sendErrorResponse(res, request, `编译失败：\n${stderr}`); }
          return;
        }
        const run = spawn(tempExe, [], { encoding: 'utf-8' });
        run.stdout.on('data', (data) => { stdout += data; });
        run.stderr.on('data', (data) => { stderr += data; });
        run.on('close', (code) => {
          if (!responseSent) {
            responseSent = true;
            cleanup();
            sendResponse(res, request, { content: [{ type: 'text', text: stdout + (stderr ? '\n' + stderr : '') }] });
          }
        });
        run.on('error', (error) => {
          if (!responseSent) {
            responseSent = true; cleanup();
            sendErrorResponse(res, request, `运行失败：${error.message}`);
          }
        });
      });
      compile.on('error', (error) => {
        if (!responseSent) {
          responseSent = true; cleanup();
          sendErrorResponse(res, request, `编译失败：${error.message}`);
        }
      });
      function cleanup() { try { if (!useScriptPath) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) { } }
      setTimeout(() => {
        if (!responseSent) {
          responseSent = true;
          try { compile.kill('SIGTERM'); } catch (_) { }
          cleanup();
          sendResponse(res, request, { content: [{ type: 'text', text: `C执行超时 90s\n${stdout}${stderr ? '\n' + stderr : ''}` }] });
        }
      }, 90000);
    } catch (error) {
      console.error('运行C失败:', error);
      sendErrorResponse(res, request, `运行C失败：${error.message}`);
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
          sendResponse(res, request, { content: [{ type: 'text', text: JSON.stringify(processes, null, 2) }] });
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
        exec(`start "" "${executablePath}"`, (err) => { if (err) console.error('打开目录失败:', err.message); });
      } else {
        const ext = path.extname(executablePath).toLowerCase();
        let command;
        if (ext === '.vbs') {
          command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process wscript -ArgumentList '${executablePath}' -WindowStyle Normal"`;
        } else {
          command = requiresUAC ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${executablePath}' -Verb RunAs}"` : `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${executablePath}'}"`;
        }
        exec(command, { encoding: 'utf-8' }, () => { });
      }
      return { content: [{ type: 'text', text: `已启动 ${toolName}` }] };
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
      const timeout = setTimeout(() => resolve({ cancelled: false, timeout: true }), 90000);
      ipcMain.once('write-to-editor-complete', (_event, result) => {
        clearTimeout(timeout);
        resolve(result || { cancelled: false });
      });
    }).then((result) => {
      if (!responseSent) {
        responseSent = true;
        if (result.cancelled) {
          sendErrorResponse(res, request, '写入已被用户取消（Esc）');
        } else if (result.timeout) {
          sendErrorResponse(res, request, '写入代码超时（90000毫秒=1分半钟）');
        } else {
          sendResponse(res, request, { content: [{ type: 'text', text: '成功向Frida IDE编辑器写入代码' }] });
        }
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
    return { content: [{ type: 'text', text: `PID=${pid}${processName ? ' ' + processName : ''}` }] };
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

  function handleCloseFridaIDE() {
    try {
      if (!checkFridaWindow()) {
        return { content: [{ type: 'text', text: 'Frida IDE 窗口未打开' }], isError: true };
      }
      windows.frida.close();
      return { content: [{ type: 'text', text: '已关闭Frida IDE窗口' }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `关闭Frida IDE失败：${error.message}` }], isError: true };
    }
  }

  function handleHideWindow() {
    try {
      if (!windows.main || windows.main.isDestroyed()) {
        return { content: [{ type: 'text', text: '主窗口未打开' }], isError: true };
      }
      if (!windows.main.isVisible()) {
        return { content: [{ type: 'text', text: '主窗口已经隐藏' }] };
      }
      windows.main.webContents.send('play-close-anim');
      if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
        windows.agentlogs.webContents.send('close-agentlogs');
      }
      setTimeout(() => {
        if (windows.main && !windows.main.isDestroyed()) {
          windows.main.hide();
        }
        if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
          windows.agentlogs.hide();
        }
      }, 220);
      return { content: [{ type: 'text', text: '主窗口已隐藏' }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `隐藏窗口失败：${error.message}` }], isError: true };
    }
  }

  function handleShowWindow() {
    try {
      if (!windows.main || windows.main.isDestroyed()) {
        return { content: [{ type: 'text', text: '主窗口未打开' }], isError: true };
      }
      if (windows.main.isVisible()) {
        return { content: [{ type: 'text', text: '主窗口已经显示' }] };
      }
      windows.main.show();
      windows.main.webContents.send('window-restored');
      if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
        windows.agentlogs.show();
        windows.agentlogs.webContents.send('window-restored');
      }
      return { content: [{ type: 'text', text: '主窗口已显示' }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `显示窗口失败：${error.message}` }], isError: true };
    }
  }

  let bHelper = null;
  let bReqId = 0;
  const bCallbacks = new Map();
  let buf = '';

  const ceMcpDir = path.join(__dirname, '..', 'Plugins', 'ce_mcp');
  const ceMcpExists = fs.existsSync(path.join(ceMcpDir, 'src', 'tool-registry.js'));
  let ceBridge = null;
  let ceQueue = Promise.resolve();

  const browserBridgeExists = (() => {
    try { return fs.existsSync(path.join(__dirname, 'BrowserBridge.js')); } catch { return false; }
  })();

  const enikkDir = path.join(__dirname, '..', 'Plugins', 'Enikk');
  const enikkBridgePath = path.join(enikkDir, 'bridge.py');
  const enikkExists = fs.existsSync(enikkBridgePath);
  let enikkHelper = null;
  let enikkReqId = 0;
  const enikkCallbacks = new Map();
  let enikkBuf = '';

  function getEnikkPythonPath() {
    const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
    const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
    const tools = parseXMLSimple(xmlContent);
    const pythonTool = tools.find(tool => tool.category === 'Language' && tool.name.includes('Python'));
    if (!pythonTool || !pythonTool.path) throw new Error('未找到Python环境');
    let pythonPath = pythonTool.path;
    if (!/^[a-zA-Z]:\\/.test(pythonTool.path)) pythonPath = path.join(__dirname, '..', '..', '..', pythonTool.path);
    if (fs.statSync(pythonPath).isDirectory()) pythonPath = path.join(pythonPath, 'python.exe');
    if (!fs.existsSync(pythonPath)) throw new Error(`Python路径不存在: ${pythonPath}`);
    return pythonPath;
  }

  function getEnikkBridge() {
    if (enikkHelper && !enikkHelper.killed) return enikkHelper;
    if (!enikkExists) throw new Error('Enikk 插件缺失：Plugins/Enikk 目录未找到');
    const pythonPath = getEnikkPythonPath();
    enikkHelper = spawn(pythonPath, [enikkBridgePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: enikkDir,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    enikkHelper.stdout.on('data', (chunk) => {
      enikkBuf += chunk.toString('utf-8');
      let idx;
      while ((idx = enikkBuf.indexOf('\n')) >= 0) {
        const line = enikkBuf.slice(0, idx);
        enikkBuf = enikkBuf.slice(idx + 1);
        try {
          const r = JSON.parse(line);
          const cb = enikkCallbacks.get(r.id);
          if (cb) {
            clearTimeout(cb.timer);
            enikkCallbacks.delete(r.id);
            cb.resolve(r.result !== undefined ? r.result : r.error !== undefined ? { isError: true, text: r.error.message } : r);
          }
        } catch { }
      }
    });
    enikkHelper.stderr.on('data', (d) => { console.error('[EnikkBridge]', d.toString('utf-8').trim()); });
    enikkHelper.on('exit', (code) => {
      console.error(`[EnikkBridge] 进程退出，退出码 ${code}`);
      enikkHelper = null;
      enikkBuf = '';
      for (const [id, cb] of enikkCallbacks) { clearTimeout(cb.timer); cb.reject(new Error('Enikk 进程意外退出')); }
      enikkCallbacks.clear();
    });
    return enikkHelper;
  }

  function sendToEnikk(method, args, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      try {
        const helper = getEnikkBridge();
        const id = ++enikkReqId;
        const timer = setTimeout(() => {
          enikkCallbacks.delete(id);
          reject(new Error(`Enikk 操作超时（${timeoutMs / 1000}秒）`));
        }, timeoutMs);
        enikkCallbacks.set(id, { resolve, reject, timer });
        helper.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: args || {} }) + '\n');
      } catch (e) { reject(e); }
    });
  }

  function getBrowserHelper() {
    if (bHelper && !bHelper.killed) return bHelper;
    const helperPath = path.join(__dirname, 'BrowserBridge.js');
    if (!fs.existsSync(helperPath)) throw new Error('浏览器组件缺失：BrowserBridge.js 未找到');
    const userDataDir = (app && typeof app.getPath === 'function') ? app.getPath('userData') : (process.env.APPDATA || require('os').tmpdir()) + '\\MetaSword';
    bHelper = spawn(process.execPath, [helperPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', METASWORD_USER_DATA: userDataDir },
    });
    setupHelperIO(bHelper);
    return bHelper;
  }

  function setupHelperIO(bHelper) {
    bHelper.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        try {
          const r = JSON.parse(line);
          const cb = bCallbacks.get(r.id);
          if (cb) {
            clearTimeout(cb.timer);
            bCallbacks.delete(r.id);
            cb.resolve(r.result);
          }
        } catch { }
      }
    });
    bHelper.stderr.on('data', (d) => { console.error('[BrowserBridge]', d.toString().trim()); });
    bHelper.on('exit', (code) => {
      console.error(`[BrowserBridge] 进程退出，退出码 ${code}`);
      bHelper = null;

      for (const [id, cb] of bCallbacks) { clearTimeout(cb.timer); cb.reject(new Error('浏览器进程意外退出')); }
      bCallbacks.clear();
    });
    return bHelper;
  }

  function sendToBrowser(method, args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      try {
        const helper = getBrowserHelper();
        const id = ++bReqId;
        const timer = setTimeout(() => {
          bCallbacks.delete(id);
          reject(new Error(`浏览器操作超时（${timeoutMs / 1000}秒）`));
        }, timeoutMs);
        bCallbacks.set(id, { resolve, reject, timer });
        helper.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: args || {} }) + '\n');
      } catch (e) {
        reject(e);
      }
    });
  }

  const BROWSER_ACTIONS = [
    { method: 'navigate', label: '打开网页', timeout: 120000 },
    { method: 'snapshot', label: '获取页面快照', timeout: 30000 },
    { method: 'click', label: '点击', timeout: 30000 },
    { method: 'type', label: '输入', timeout: 30000 },
    { method: 'screenshot', label: '截图', timeout: 30000 },
    { method: 'close', label: '关闭浏览器', timeout: 15000 },
    { method: 'scroll', label: '滚动', timeout: 30000 },
    { method: 'press_key', label: '按键', timeout: 15000 },
    { method: 'select_option', label: '选择', timeout: 15000 },
    { method: 'wait', label: '等待', timeout: 60000 },
    { method: 'evaluate', label: '执行脚本', timeout: 15000 },
    { method: 'back', label: '后退', timeout: 30000 },
    { method: 'forward', label: '前进', timeout: 30000 },
    { method: 'hide_window', label: '隐藏浏览器窗口', timeout: 15000 },
    { method: 'show_window', label: '显示浏览器窗口', timeout: 15000 },
    { method: 'hover', label: '悬停', timeout: 15000 },
    { method: 'double_click', label: '双击', timeout: 15000 },
    { method: 'drag', label: '拖拽', timeout: 30000 },
    { method: 'new_tab', label: '打开新标签页', timeout: 15000 },
    { method: 'switch_tab', label: '切换标签页', timeout: 15000 },
    { method: 'network_requests', label: '获取网络请求', timeout: 15000 },
  ];
  const browserHandlers = {};
  for (const { method, label, timeout } of BROWSER_ACTIONS) {
    browserHandlers[`browser_${method}`] = async (res, request, args) => {
      try {
        const result = await sendToBrowser(method, args || {}, timeout);
        sendResponse(res, request, result);
      } catch (e) { sendErrorResponse(res, request, `${label}失败：${e.message}`); }
    };
  }

  function getCEBridge() {
    if (ceBridge) return ceBridge;
    const { ToolRegistry } = require(path.join(ceMcpDir, 'src', 'tool-registry'));
    const { PipeClient } = require(path.join(ceMcpDir, 'src', 'pipe-client'));
    const { TimeoutManager } = require(path.join(ceMcpDir, 'src', 'base'));
    ceBridge = { registry: new ToolRegistry(), timeouts: new TimeoutManager(), pipeClient: new PipeClient() };
    return ceBridge;
  }

  function isCEBridgeAlive() {
    try { return fs.readdirSync('\\\\.\\pipe\\').some(n => n === 'ce_mcp_bridge'); } catch { return false; }
  }

  function handleCEToolCall(res, request, toolName, args) {
    if (!ceMcpExists) { sendErrorResponse(res, request, 'CE 组件缺失：未找到 Plugins/ce_mcp 目录'); return; }
    try {
      const { registry, timeouts, pipeClient } = getCEBridge();
      const luaCmd = registry.getLuaCommand(toolName);
      if (!luaCmd) { sendErrorResponse(res, request, `未知的 Cheat Engine 工具：${toolName}`); return; }
      const timeoutMs = timeouts.getTimeout(toolName) * 1000;
      ceQueue = ceQueue.then(async () => {
        try {
          const resp = await pipeClient.sendReceive({ command: luaCmd, params: args || {} }, timeoutMs, toolName);
          if (resp && resp.error !== undefined) {
            sendErrorResponse(res, request, String(resp.error));
          } else {
            const payload = (resp && resp.result !== undefined) ? resp.result : resp;
            sendResponse(res, request, {
              content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
            });
          }
        } catch (e) {
          sendErrorResponse(res, request, `Cheat Engine 调用失败：${e.message}`);
        }
      });
    } catch (e) {
      sendErrorResponse(res, request, `CE 组件加载失败：${e.message}`);
    }
  }

  function handleGetFridaProcesses(res, request, args) {
    const { filter = '' } = args;
    if (!checkFridaWindow()) { sendErrorResponse(res, request, '错误：Frida IDE窗口未打开'); return; }
    const Fridapath = path.join(__dirname, '..', 'Plugins', 'frida');
    const fastlistProcess = spawn(path.join(Fridapath, 'exten', 'Fastlist'));
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
          sendResponse(res, request, { content: [{ type: 'text', text: processList || '(empty)' }] });
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
      const cliDir = path.join(__dirname, '..', 'Plugins', 'cli');
      const structure = getDirectoryStructure(cliDir);
      sendResponse(res, request, { content: [{ type: 'text', text: structure }] });
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

    const host = (req.headers.host || '').split(':')[0];
    if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      res.writeHead(302, { 'Location': '/mcp' }); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/favicon.ico') {
      const iconPath = path.join(__dirname, '..', 'Nexus', 'Assets', 'Image', 'icon.ico');
      try {
        const stat = fs.statSync(iconPath);
        if (stat.isFile()) {
          res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'no-cache' });
          fs.createReadStream(iconPath).pipe(res);
          return;
        }
      } catch (e) { }
      res.writeHead(404); res.end(); return;
    }
    if (req.method === 'GET' && req.url.startsWith('/Assets/')) {
      const filePath = path.join(__dirname, '..', 'Nexus', req.url);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const types = { '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript' };
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      } catch (e) { }
      res.writeHead(404); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/mcp') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const htmlPath = path.join(__dirname, '..', 'Nexus', 'Views', 'MCPStatus.html');
      const html = fs.readFileSync(htmlPath, 'utf-8').replace('${PORT}', actualPort);
      res.end(html);
      return;
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      let body = '';
      let bodyLen = 0;
      const MAX_BODY = 2 * 1024 * 1024;
      req.on('data', chunk => {
        bodyLen += chunk.length;
        if (bodyLen <= MAX_BODY) body += chunk;
      });
      req.on('end', () => {
        if (bodyLen > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: '请求体过大' } }));
          return;
        }
        let request;
        try {
          request = JSON.parse(body);
          const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
          let result;
          switch (request.method) {
            case 'initialize':
              result = { protocolVersion: request.params?.protocolVersion || '2026-06-26', capabilities: { tools: {} }, serverInfo: { name: '次元剑', version: '1.0.0' } };
              break;
            case 'tools/list': {
                const baseTools = [
                  { name: 'getFridaCode', description: '获取 Frida IDE 编辑器代码', inputSchema: { type: 'object', properties: {} } },
                  { name: 'getFridaProcesses', description: '获取 Frida IDE 进程列表', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: '进程名称过滤关键字（可选）' } } } },
                  { name: 'getFridaTerminalOutput', description: '获取 Frida IDE 终端输出', inputSchema: { type: 'object', properties: { lines: { type: 'number', description: '获取最后几行（默认50行）' } } } },
                  { name: 'getToolboxList', description: '获取工具箱内置工具列表', inputSchema: { type: 'object', properties: {} } },
                  { name: 'getWindowsProcesses', description: '获取 Windows 进程列表（返回 JSON 格式，比 Get-Process 更结构化）', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: '进程名称过滤关键字（可选）' } } } },
                  { name: 'runPython', description: '运行 Python 脚本', inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'Python脚本内容' }, scriptPath: { type: 'string', description: 'Python脚本文件路径（可选）' } }, required: ['script'] } },
                  { name: 'runJava', description: '运行 Java 代码或 jar 包', inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'Java 源代码' }, scriptPath: { type: 'string', description: 'jar 文件路径' }, jarArgs: { type: 'array', items: { type: 'string' }, description: '传给 jar 的命令行参数，如 ["d","app.apk","-o","out/"]' } }, required: [] } },
                  { name: 'runC', description: '编译并运行 C 代码', inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'C代码内容' }, scriptPath: { type: 'string', description: 'C文件路径（可选）' } }, required: ['script'] } },
                  { name: 'readFile', description: '读取文件内容（UTF-8 文本）', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件绝对路径' } }, required: ['filePath'] } },
                  { name: 'writeFile', description: '写入文件（自动创建目录，默认覆盖）', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件绝对路径' }, content: { type: 'string', description: '文件内容' }, overwrite: { type: 'boolean', description: '是否覆盖已存在文件（默认 true）' } }, required: ['filePath', 'content'] } },
                  { name: 'deleteFile', description: '删除文件', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件绝对路径' }, force: { type: 'boolean', description: '文件不存在时是否视为成功（默认 false）' } }, required: ['filePath'] } },
                  { name: 'runPowerShellCommand', description: '执行 PowerShell 命令（默认超时 90 秒）', inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'PowerShell 命令' }, timeout: { type: 'number', description: '超时毫秒数（默认 90000）' } }, required: ['command'] } },
                  { name: 'moveToolboxTool', description: '移动工具到指定位置', inputSchema: { type: 'object', properties: { toolName: { type: 'string', description: '要移动的工具名称' }, targetPosition: { type: 'integer', description: '目标位置' }, targetCategory: { type: 'string', description: '目标分类' } }, required: ['toolName', 'targetPosition'] } },
                  { name: 'openFridaIDE', description: '打开 Frida IDE 窗口', inputSchema: { type: 'object', properties: {} } },
                  { name: 'closeFridaIDE', description: '关闭 Frida IDE 窗口', inputSchema: { type: 'object', properties: {} } },
                  { name: 'runFridaCode', description: '运行 Frida IDE 编辑器代码', inputSchema: { type: 'object', properties: {} } },
                  { name: 'runToolboxTool', description: '运行次元剑工具箱中的快捷工具（GUI 或非 CLI 程序）', inputSchema: { type: 'object', properties: { toolName: { type: 'string', description: '工具名称' }, forceUAC: { type: 'boolean', description: '是否强制以管理员身份运行' } }, required: ['toolName'] } },
                  { name: 'setFridaProcess', description: '设置 Frida IDE 目标进程 PID', inputSchema: { type: 'object', properties: { pid: { type: 'number', description: '进程 PID' }, processName: { type: 'string', description: '进程名称（可选，用于显示）' } }, required: ['pid'] } },
                  { name: 'swapToolboxTool', description: '交换两个工具的位置', inputSchema: { type: 'object', properties: { tool1: { type: 'string', description: '第一个工具名称' }, tool2: { type: 'string', description: '第二个工具名称' } }, required: ['tool1', 'tool2'] } },
                  { name: 'writeToFridaEditor', description: '向 Frida IDE 编辑器写入代码', inputSchema: { type: 'object', properties: { code: { type: 'string', description: '要写入的代码' }, replace: { type: 'boolean', description: '是否替换现有代码（默认为true）' } }, required: ['code'] } },
                  { name: 'usePluginTools', description: '次元剑/Frida IDE 内部工具目录，仅供 IDE 使用，AI 对话请用 PowerShell 代替', inputSchema: { type: 'object', properties: {} } },
                  { name: 'hideWindow', description: '隐藏次元剑主窗口（相当于按 F1 隐藏）', inputSchema: { type: 'object', properties: {} } },
                  { name: 'showWindow', description: '显示次元剑主窗口（相当于按 F1 显示）', inputSchema: { type: 'object', properties: {} } },
                ];
                if (browserBridgeExists) {
                  baseTools.push(
                    { name: 'browser_navigate', description: '打开网页（可见 Edge 窗口，首次调用会启动浏览器，约需数秒）。waitUntil 可选 "networkidle"（等待网络空闲，适合复杂页面）或默认 "domcontentloaded"', inputSchema: { type: 'object', properties: { url: { type: 'string', description: '网址，可省略 https://' }, waitUntil: { type: 'string', enum: ['domcontentloaded', 'networkidle'], description: '等待策略：domcontentloaded（默认，快速）或 networkidle（等网络空闲）' } }, required: ['url'] } },
                    { name: 'browser_snapshot', description: '获取当前页面的交互元素快照（按钮/链接/输入框/标题等），用于了解页面有哪些可操作元素', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_click', description: '点击页面元素，selector（CSS 选择器）/ role（角色，如 button，可配 name）/ text（按文本匹配）三种定位方式三选一。button 可选 left/right/middle', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS 选择器' }, role: { type: 'string', description: 'ARIA 角色，如 button、link、textbox' }, name: { type: 'string', description: '配合 role 使用的元素名称' }, text: { type: 'string', description: '按可见文本匹配' }, button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键（默认 left）' } } } },
                    { name: 'browser_type', description: '向输入框填入文本，定位方式同 browser_click；submit 为 true 时输入后回车提交', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS 选择器' }, role: { type: 'string', description: 'ARIA 角色，如 textbox、searchbox' }, name: { type: 'string', description: '配合 role 使用的元素名称' }, text: { type: 'string', description: '要输入的文本' }, submit: { type: 'boolean', description: '输入后是否按回车提交' } }, required: ['text'] } },
                    { name: 'browser_screenshot', description: '截取页面保存为 PNG 到 images 目录，返回文件路径。fullPage 为 true 时截取全页', inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean', description: '是否截取整页（默认 false，仅视口）' } } } },
                    { name: 'browser_close', description: '关闭自动化浏览器（登录态保留在专用配置目录）', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_scroll', description: '滚动页面：提供 delta 按像素滚动（正数向下），或提供 selector/role/text 滚动到指定元素', inputSchema: { type: 'object', properties: { delta: { type: 'number', description: '滚动像素量（正=向下）' }, selector: { type: 'string', description: '滚动到指定 CSS 选择器' }, role: { type: 'string', description: '滚动到指定 ARIA 角色' }, text: { type: 'string', description: '滚动到指定文本元素' } } } },
                    { name: 'browser_press_key', description: '按下键盘按键，如 Enter、Escape、Tab、ArrowDown、Backspace 等', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '按键名称' } }, required: ['key'] } },
                    { name: 'browser_select_option', description: '选择下拉框（select）中的选项，按 value / label / index 三选一', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'select 元素的 CSS 选择器' }, role: { type: 'string', description: 'select 元素的 ARIA 角色' }, name: { type: 'string', description: '配合 role 使用的元素名称' }, text: { type: 'string', description: '按可见文本匹配 select 元素' }, value: { type: 'string', description: '按 option 的 value 属性选择' }, label: { type: 'string', description: '按 option 的显示文本选择' }, index: { type: 'number', description: '按 option 的索引选择（从 0 开始）' } } } },
                    { name: 'browser_wait', description: '等待指定元素出现或等待指定毫秒数（ms 默认 5000）', inputSchema: { type: 'object', properties: { ms: { type: 'number', description: '等待毫秒数（默认 5000）' }, selector: { type: 'string', description: '等待此 CSS 选择器出现' }, role: { type: 'string', description: '等待此 ARIA 角色出现' }, text: { type: 'string', description: '等待包含此文本的元素出现' } } } },
                    { name: 'browser_evaluate', description: '在页面中执行 JavaScript 代码并返回结果', inputSchema: { type: 'object', properties: { script: { type: 'string', description: '要执行的 JavaScript 代码' } }, required: ['script'] } },
                    { name: 'browser_back', description: '浏览器后退到上一页', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_forward', description: '浏览器前进到下一页', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_hide_window', description: '隐藏（最小化）浏览器窗口，页面操作在后台继续进行，适合不想让自动化过程打扰桌面时使用', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_show_window', description: '显示（恢复）浏览器窗口，用于查看自动化操作过程或需要人工介入时', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_hover', description: '鼠标悬停在元素上（触发 tooltip、下拉菜单等），定位方式同 browser_click', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS 选择器' }, role: { type: 'string', description: 'ARIA 角色' }, name: { type: 'string', description: '配合 role 使用的元素名称' }, text: { type: 'string', description: '按可见文本匹配' } } } },
                    { name: 'browser_double_click', description: '双击页面元素，定位方式同 browser_click', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS 选择器' }, role: { type: 'string', description: 'ARIA 角色' }, name: { type: 'string', description: '配合 role 使用的元素名称' }, text: { type: 'string', description: '按可见文本匹配' } } } },
                    { name: 'browser_drag', description: '拖拽元素从起点到终点，起点定位同 browser_click，终点通过 to.selector / to.role / to.text 指定', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: '拖拽起点的 CSS 选择器' }, role: { type: 'string', description: '拖拽起点的 ARIA 角色' }, name: { type: 'string', description: '配合 role 使用的元素名称' }, text: { type: 'string', description: '拖拽起点的可见文本' }, to: { type: 'object', properties: { selector: { type: 'string', description: '拖拽终点的 CSS 选择器' }, role: { type: 'string', description: '拖拽终点的 ARIA 角色' }, name: { type: 'string', description: '配合 role 的元素名称' }, text: { type: 'string', description: '拖拽终点的可见文本' } }, description: '拖拽目标位置' } } } },
                    { name: 'browser_new_tab', description: '打开一个新的空白标签页并切换到该标签页', inputSchema: { type: 'object', properties: {} } },
                    { name: 'browser_switch_tab', description: '切换到指定索引的标签页（索引从 0 开始）', inputSchema: { type: 'object', properties: { index: { type: 'number', description: '标签页索引（0 起始）' } } } },
                    { name: 'browser_network_requests', description: '获取当前页面的网络请求列表（仅 XHR/Fetch 接口 + JS 文件，不含图片/CSS 等静态资源）。clear 为 true 时获取后清空记录', inputSchema: { type: 'object', properties: { clear: { type: 'boolean', description: '获取后是否清空记录（默认 true）' } } } }
                  );
                }
                if (ceMcpExists && isCEBridgeAlive()) {
                  try {
                    baseTools.push(...getCEBridge().registry.getAllSchemas());
                  } catch (e) {
                    console.error('[MCP] 加载 Cheat Engine 工具失败:', e.message);
                  }
                }
                if (enikkExists) {
                  baseTools.push(
                    { name: 'enikk_parse_image_file', description: '解析本地图片，返回 UI 元素（YOLO 图标检测 + OCR 文字识别）。所有坐标归一化到 [0,1000]', inputSchema: { type: 'object', properties: { image_path: { type: 'string', description: '图片绝对路径' } }, required: ['image_path'] } },
                    { name: 'enikk_parse_image_base64', description: '解析 base64 编码的图片，返回 UI 元素', inputSchema: { type: 'object', properties: { image_base64: { type: 'string', description: 'base64 图片数据（可含 data URI 前缀）' }, mime: { type: 'string', description: '图片类型：jpeg/png/bmp/webp（默认 jpeg）' } }, required: ['image_base64'] } },
                    { name: 'enikk_list_windows', description: '列出所有可见顶层窗口（过滤掉最小化和小窗口）', inputSchema: { type: 'object', properties: {} } },
                    { name: 'enikk_find_window_by_title', description: '按标题关键字查找窗口（不区分大小写，返回前 10 个匹配）', inputSchema: { type: 'object', properties: { keyword: { type: 'string', description: '窗口标题关键字' } }, required: ['keyword'] } },
                    { name: 'enikk_force_foreground', description: '将窗口激活到前台（绕过 Windows 前台锁定）', inputSchema: { type: 'object', properties: { hwnd: { type: 'number', description: '窗口句柄' } }, required: ['hwnd'] } },
                    { name: 'enikk_launch', description: '启动一个应用程序并自动等待窗口出现（最多 30 秒）。如果已经在运行则直接激活。app 用 Windows App Paths 查找（chrome/notepad/calculator 都行），exe 传完整路径', inputSchema: { type: 'object', properties: { app: { type: 'string', description: '应用名如 "chrome"、"notepad"（App Paths 注册表查找）' }, exe: { type: 'string', description: 'exe 完整路径（优先于 app）' }, title_keyword: { type: 'string', description: '窗口标题匹配关键字（默认 = app 名或 exe 文件名）' }, timeout: { type: 'number', description: '等待窗口出现的最大秒数（默认 30）' } } } },
                    { name: 'enikk_wait_for_window', description: '轮询等待一个窗口出现（最多 15 秒），找到后自动激活到前台', inputSchema: { type: 'object', properties: { keyword: { type: 'string', description: '窗口标题包含的关键字（大小写不敏感）' }, timeout: { type: 'number', description: '最大等待秒数（默认 15）' } }, required: ['keyword'] } },
                    { name: 'enikk_wait', description: '等待/睡眠指定秒数（纯 time.sleep，不会启动任何浏览器）。页面加载、动画完成等场景用这个，不要用 browser_wait', inputSchema: { type: 'object', properties: { seconds: { type: 'number', description: '等待秒数（小数也可以，比如 0.5 或 3）' }, reason: { type: 'string', description: '等待原因（可选，仅用于日志）' } }, required: ['seconds'] } },
                    { name: 'enikk_click_normalized', description: '在窗口内用归一化坐标 [0,1000] 点击，鼠标沿贝塞尔曲线拟人移动（推荐）', inputSchema: { type: 'object', properties: { hwnd: { type: 'number', description: '窗口句柄' }, x: { type: 'number', description: '归一化 X [0,1000]' }, y: { type: 'number', description: '归一化 Y [0,1000]' }, clicks: { type: 'number', description: '点击次数（默认 1，双击用 2）' }, activate: { type: 'boolean', description: '是否先激活窗口（默认 true）' } }, required: ['hwnd', 'x', 'y'] } },
                    { name: 'enikk_click_screen', description: '在屏幕绝对坐标（物理像素）拟人点击', inputSchema: { type: 'object', properties: { x: { type: 'number', description: '屏幕 X 像素' }, y: { type: 'number', description: '屏幕 Y 像素' }, clicks: { type: 'number', description: '点击次数（默认 1）' } }, required: ['x', 'y'] } },
                    { name: 'enikk_click_desktop_normalized', description: '[推荐] 用桌面归一化坐标 [0,1000] 点击主屏任意位置 — 直接用 capture_desktop 返回的 element.center，不需要自己转像素，内部自动处理 DPI 和分辨率', inputSchema: { type: 'object', properties: { x: { type: 'number', description: '归一化 X [0,1000]' }, y: { type: 'number', description: '归一化 Y [0,1000]' }, clicks: { type: 'number', description: '点击次数（默认 1）' } }, required: ['x', 'y'] } },
                    { name: 'enikk_move_mouse', description: '将鼠标光标拟人移动到屏幕绝对坐标', inputSchema: { type: 'object', properties: { x: { type: 'number', description: '屏幕 X 像素' }, y: { type: 'number', description: '屏幕 Y 像素' } }, required: ['x', 'y'] } },
                    { name: 'enikk_move_mouse_desktop_normalized', description: '用桌面归一化坐标 [0,1000] 移动鼠标到主屏位置 — 直接用 capture_desktop 返回的 element.center', inputSchema: { type: 'object', properties: { x: { type: 'number', description: '归一化 X [0,1000]' }, y: { type: 'number', description: '归一化 Y [0,1000]' } }, required: ['x', 'y'] } },
                    { name: 'enikk_type_text', description: '通过剪贴板粘贴输入文本（Ctrl+V），支持中文/日文/韩文等 Unicode。传 hwnd 可自动激活目标窗口再粘贴', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要输入的文本' }, hwnd: { type: 'number', description: '窗口句柄（可选，传入则先激活该窗口）' } }, required: ['text'] } },
                    { name: 'enikk_press_key', description: '按下单个键（pyautogui 命名）：enter/tab/esc/backspace/space/up/down/left/right/f1-f12/home/end/pageup/pagedown。传 hwnd 可自动激活目标窗口', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '按键名称' }, wait_time: { type: 'number', description: '按住时间秒数（默认 0.2）' }, hwnd: { type: 'number', description: '窗口句柄（可选，传入则先激活该窗口）' } }, required: ['key'] } },
                    { name: 'enikk_hotkey', description: '同时按下多个键（组合快捷键），如 ["ctrl","c"] 复制、["ctrl","shift","t"] 重开标签页。传 hwnd 可自动激活目标窗口', inputSchema: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string' }, description: '按键名数组' }, hwnd: { type: 'number', description: '窗口句柄（可选，传入则先激活该窗口）' } }, required: ['keys'] } },
                    { name: 'enikk_scroll', description: '在屏幕绝对坐标处滚轮滚动，人类式分块滚动（2-6 条/次）', inputSchema: { type: 'object', properties: { x: { type: 'number', description: '屏幕 X 像素' }, y: { type: 'number', description: '屏幕 Y 像素' }, clicks: { type: 'number', description: '正数向上，负数向下' }, direction: { type: 'string', description: 'vertical（默认）或 horizontal' } }, required: ['x', 'y', 'clicks'] } },
                    { name: 'enikk_scroll_normalized', description: '在窗口内归一化坐标处滚动', inputSchema: { type: 'object', properties: { hwnd: { type: 'number', description: '窗口句柄' }, x: { type: 'number', description: '归一化 X [0,1000]' }, y: { type: 'number', description: '归一化 Y [0,1000]' }, clicks: { type: 'number', description: '正数向上，负数向下' }, direction: { type: 'string', description: 'vertical（默认）或 horizontal' } }, required: ['hwnd', 'x', 'y', 'clicks'] } },
                    { name: 'enikk_swipe', description: '从 (x1,y1) 拖拽滑动到 (x2,y2)，拟人贝塞尔曲线 + smoothstep', inputSchema: { type: 'object', properties: { x1: { type: 'number', description: '起点 X' }, y1: { type: 'number', description: '起点 Y' }, x2: { type: 'number', description: '终点 X' }, y2: { type: 'number', description: '终点 Y' }, speed: { type: 'number', description: '1.0 正常，2.0 快速，0.5 慢速（默认 1.0）' } }, required: ['x1', 'y1', 'x2', 'y2'] } },
                    { name: 'enikk_capture_desktop', description: '截屏整个桌面 → YOLO+OCR 识别 UI 元素（归一化坐标 [0,1000]），返回结构化 JSON', inputSchema: { type: 'object', properties: {} } },
                    { name: 'enikk_capture_window', description: '截取指定窗口 → YOLO+OCR 识别 UI 元素，返回结构化 JSON', inputSchema: { type: 'object', properties: { hwnd: { type: 'number', description: '窗口句柄' } }, required: ['hwnd'] } },
                  );
                }
                result = {
                  tools: baseTools
                };
                break;
            }
            case 'tools/call':
              const { name, arguments: args } = request.params;
              switch (name) {
                case 'getToolboxList': {
                  const xmlContent = fs.readFileSync(toolsListPath, 'utf-8');
                  const tools = parseXMLSimple(xmlContent);
                  result = { content: [{ type: 'text', text: tools.map((t, i) => `${i + 1}. [${t.category}] ${t.name}`).join('\n') }] };
                  break;
                }
                case 'swapToolboxTool': result = handleSwapToolsBoxTool(args); break;
                case 'moveToolboxTool': result = handleMoveToolsBoxTool(args); break;
                case 'runToolboxTool': result = handleRunToolsBoxTool(args); break;
                case 'getWindowsProcesses': handleGetWindowsProcesses(res, request, args); return;
                case 'runPython': handleRunPythonScript(res, request, args); return;
                case 'runJava': handleRunJava(res, request, args); return;
                case 'runC': handleRunC(res, request, args); return;
                case 'readFile': handleReadFile(res, request, args); return;
                case 'deleteFile': handleDeleteFile(res, request, args); return;
                case 'runPowerShellCommand': handleRunPowerShellCommand(res, request, args); return;
                case 'writeFile': handleWriteFile(res, request, args); return;
                case 'writeToFridaEditor': handleWriteToFridaEditor(res, request, args); return;
                case 'setFridaProcess': result = handleSetFridaProcess(args); break;
                case 'openFridaIDE': result = handleOpenFridaIDE(); break;
                case 'closeFridaIDE': result = handleCloseFridaIDE(); break;
                case 'hideWindow': result = handleHideWindow(); break;
                case 'showWindow': result = handleShowWindow(); break;
                case 'getFridaProcesses': handleGetFridaProcesses(res, request, args); return;
                case 'runFridaCode': handleRunFridaCode(res, request); return;
                case 'getFridaTerminalOutput': handleGetFridaTerminalOutput(res, request, args); return;
                case 'getFridaCode': handleGetFridaCode(res, request); return;
                case 'usePluginTools': handleUsePluginTools(res, request); return;
                default:
                  if (name && name.startsWith('ce_')) { handleCEToolCall(res, request, name, args); return; }
                  if (name && name.startsWith('browser_')) {
                    const handler = browserHandlers[name];
                    if (handler) { handler(res, request, args); return; }
                  }
                  if (name && (name.startsWith('enikk_') || name.startsWith('mcp_enikk_'))) {
                    if (!enikkExists) { sendErrorResponse(res, request, 'Enikk 插件缺失：未找到 Plugins/Enikk 目录'); return; }
                    const method = name.startsWith('mcp_enikk_') ? name.slice(10) : name.slice(6);
                    const isHeavy = method.startsWith('parse') || method.startsWith('capture') || method.startsWith('desktop') || method.startsWith('scroll') || method.startsWith('swipe');
                    sendToEnikk(method, args || {}, isHeavy ? 120000 : 60000)
                      .then(result => {
                        if (result && result.isError) {
                          sendErrorResponse(res, request, result.text || 'Enikk 调用失败');
                        } else {
                          let data = result;
                          if (typeof data === 'string') {
                            try { data = JSON.parse(data); } catch { data = null; }
                          }
                          const isObj = typeof data === 'object' && data !== null;
                          const imageB64 = isObj ? (data.image_base64 || null) : null;
                          const mime = isObj ? (data.mime || 'image/png') : 'image/png';
                          const displayObj = { ...data };
                          if (displayObj.image_base64) delete displayObj.image_base64;
                          if (displayObj.mime) delete displayObj.mime;
                          const text = typeof data === 'object' && data !== null
                            ? JSON.stringify(displayObj)
                            : (typeof result === 'string' ? result : String(result));
                          const content = [{ type: 'text', text }];
                          if (imageB64) {
                            const mimeShort = (mime || 'image/png').replace('image/', '');
                            content.push({
                              type: 'image',
                              mimeType: mime,
                              data: imageB64,
                            });
                          }
                          sendResponse(res, request, { content });
                        }
                      })
                      .catch(e => sendErrorResponse(res, request, `Enikk 调用失败：${e.message}`));
                    return;
                  }
                  result = { content: [{ type: 'text', text: '未知工具' }], isError: true }; break;
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
      const nyeliDir = path.join(__dirname, '..', 'Plugins', 'Nyeli', '.Nyeli');
      const mcpPath = path.join(nyeliDir, 'mcp.json');
      try {
        if (!fs.existsSync(nyeliDir)) fs.mkdirSync(nyeliDir, { recursive: true });
        let config = {};
        if (fs.existsSync(mcpPath)) {
          config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        }
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers['次元剑'] = { type: 'http', url: `http://127.0.0.1:${actualPort}/mcp` };
        fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[MCP HTTP] Server running at http://127.0.0.1:${actualPort}/mcp`);
        console.log(`[MCP HTTP] Config saved to ${mcpPath}`);
      } catch (e) {
        console.error('[MCP HTTP] Failed to save config:', e.message);
      }
    });
  });

  function closeBrowser() {
    try {
      if (bHelper && !bHelper.killed) {
        sendToBrowser('close', {}, 10000).catch(() => { });
        setTimeout(() => {
          try { if (bHelper && !bHelper.killed) bHelper.kill(); } catch { }
        }, 12000);
      }
    } catch { }
  }

  return { getPort: () => actualPort, closeBrowser };
}

module.exports = { startMCPHttpServer };