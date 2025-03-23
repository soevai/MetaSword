var editor = ace.edit("editor");
editor.session.setMode("ace/mode/javascript");

var currentFontSize = 20;
var minFontSize = 15;
var maxFontSize = 35;

editor.setOptions({
    fontSize: currentFontSize + "px",
    enableBasicAutocompletion: true,
    enableSnippets: true,
    enableLiveAutocompletion: true,
    showPrintMargin: false
});

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            currentFontSize = Math.min(currentFontSize + 1, maxFontSize);
            editor.setOptions({
                fontSize: currentFontSize + "px"
            });
        }

        if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            currentFontSize = Math.max(currentFontSize - 1, minFontSize);
            editor.setOptions({
                fontSize: currentFontSize + "px"
            });
        }
    }
});


editor.setShowPrintMargin(false);
var fridaCompletions = [
    // Interceptor
    { value: 'Interceptor.attach', meta: 'function' },
    { value: 'Interceptor.detachAll', meta: 'function' },
    { value: 'Interceptor.flush', meta: 'function' },
    { value: 'Interceptor.replace', meta: 'function' },
    { value: 'Interceptor.revert', meta: 'function' },

    // Memory
    { value: 'Memory.alloc', meta: 'function' },
    { value: 'Memory.allocUtf8String', meta: 'function' },
    { value: 'Memory.allocUtf16String', meta: 'function' },
    { value: 'Memory.protect', meta: 'function' },
    { value: 'Memory.scan', meta: 'function' },
    { value: 'Memory.scanSync', meta: 'function' },
    { value: 'Memory.readByteArray', meta: 'function' },
    { value: 'Memory.readCString', meta: 'function' },
    { value: 'Memory.readDouble', meta: 'function' },
    { value: 'Memory.readFloat', meta: 'function' },
    { value: 'Memory.readInt', meta: 'function' },
    { value: 'Memory.readS16', meta: 'function' },
    { value: 'Memory.readS32', meta: 'function' },
    { value: 'Memory.readS64', meta: 'function' },
    { value: 'Memory.readS8', meta: 'function' },
    { value: 'Memory.readShort', meta: 'function' },
    { value: 'Memory.readUInt', meta: 'function' },
    { value: 'Memory.readU16', meta: 'function' },
    { value: 'Memory.readU32', meta: 'function' },
    { value: 'Memory.readU64', meta: 'function' },
    { value: 'Memory.readU8', meta: 'function' },
    { value: 'Memory.readUtf16String', meta: 'function' },
    { value: 'Memory.readUtf8String', meta: 'function' },
    { value: 'Memory.writeByteArray', meta: 'function' },
    { value: 'Memory.writeCString', meta: 'function' },
    { value: 'Memory.writeDouble', meta: 'function' },
    { value: 'Memory.writeFloat', meta: 'function' },
    { value: 'Memory.writeInt', meta: 'function' },
    { value: 'Memory.writeS16', meta: 'function' },
    { value: 'Memory.writeS32', meta: 'function' },
    { value: 'Memory.writeS64', meta: 'function' },
    { value: 'Memory.writeS8', meta: 'function' },
    { value: 'Memory.writeShort', meta: 'function' },
    { value: 'Memory.writeUInt', meta: 'function' },
    { value: 'Memory.writeU16', meta: 'function' },
    { value: 'Memory.writeU32', meta: 'function' },
    { value: 'Memory.writeU64', meta: 'function' },
    { value: 'Memory.writeU8', meta: 'function' },
    { value: 'Memory.writeUtf16String', meta: 'function' },
    { value: 'Memory.writeUtf8String', meta: 'function' },
    { value: 'Memory.writePointer', meta: 'function' },

    // Module
    { value: 'Module.ensureInitialized', meta: 'function' },
    { value: 'Module.enumerateExports', meta: 'function' },
    { value: 'Module.enumerateImports', meta: 'function' },
    { value: 'Module.enumerateRanges', meta: 'function' },
    { value: 'Module.findBaseAddress', meta: 'function' },
    { value: 'Module.findExportByName', meta: 'function' },
    { value: 'Module.findImportByName', meta: 'function' },
    { value: 'Module.getExportByName', meta: 'function' },
    { value: 'Module.getImportByName', meta: 'function' },
    { value: 'Module.load', meta: 'function' },
    { value: 'Module.loadFromMemory', meta: 'function' },

    // Native
    { value: 'NativeCallback', meta: 'function' },
    { value: 'NativeFunction', meta: 'function' },
    { value: 'NativePointer', meta: 'class' },
    { value: 'NativeStruct', meta: 'class' },
    { value: 'NativeStruct.extend', meta: 'function' },

    // ObjC
    { value: 'ObjC.classes', meta: 'object' },
    { value: 'ObjC.choose', meta: 'function' },
    { value: 'ObjC.enumerateLoadedClasses', meta: 'function' },
    { value: 'ObjC.enumerateLoadedModules', meta: 'function' },
    { value: 'ObjC.registerClass', meta: 'function' },
    { value: 'ObjC.schedule', meta: 'function' },
    { value: 'ObjC.selector', meta: 'function' },
    { value: 'ObjC.bindings', meta: 'object' },

    // Process
    { value: 'Process.enumerateModules', meta: 'function' },
    { value: 'Process.enumerateThreads', meta: 'function' },
    { value: 'Process.getCurrentThreadId', meta: 'function' },
    { value: 'Process.getModuleByAddress', meta: 'function' },
    { value: 'Process.getModuleByName', meta: 'function' },
    { value: 'Process.getModuleRangeByName', meta: 'function' },
    { value: 'Process.getThreadById', meta: 'function' },
    { value: 'Process.isDebuggerAttached', meta: 'function' },
    { value: 'Process.pointerSize', meta: 'property' },
    { value: 'Process.arch', meta: 'property' },
    { value: 'Process.platform', meta: 'property' },
    { value: 'Process.pageSize', meta: 'property' },
    { value: 'Process.findRangeByAddress', meta: 'function' },
    { value: 'Process.getScriptContext', meta: 'function' },

    // Stalker
    { value: 'Stalker.follow', meta: 'function' },
    { value: 'Stalker.unfollow', meta: 'function' },
    { value: 'Stalker.garbageCollect', meta: 'function' },
    { value: 'Stalker.queueCapacity', meta: 'property' },
    { value: 'Stalker.setCallback', meta: 'function' },
    { value: 'Stalker.wait', meta: 'function' },
    { value: 'Stalker.flush', meta: 'function' },
    { value: 'Stalker.exclude', meta: 'function' },
    { value: 'Stalker.queueDrain', meta: 'function' },
    { value: 'Stalker.queueUsage', meta: 'function' },
    { value: 'Stalker.queueOverflowed', meta: 'function' },

    // Thread
    { value: 'Thread.backtrace', meta: 'function' },
    { value: 'Thread.sleep', meta: 'function' },
    { value: 'Thread.suspend', meta: 'function' },
    { value: 'Thread.resume', meta: 'function' },
    { value: 'Thread.getThreadContext', meta: 'function' },
    { value: 'Thread.setThreadContext', meta: 'function' },

    // Java
    { value: 'Java.perform', meta: 'function' },
    { value: 'Java.choose', meta: 'function' },
    { value: 'Java.use', meta: 'function' },
    { value: 'Java.openClassFile', meta: 'function' },
    { value: 'Java.enumerateLoadedClasses', meta: 'function' },
    { value: 'Java.enumerateClassLoaders', meta: 'function' },
    { value: 'Java.enumerateMethods', meta: 'function' },
    { value: 'Java.enumerateFields', meta: 'function' },
    { value: 'Java.retain', meta: 'function' },
    { value: 'Java.scheduleOnMainThread', meta: 'function' },
    { value: 'Java.registerClass', meta: 'function' },
    { value: 'Java.cast', meta: 'function' },

    // Unix
    { value: 'Unix.readlink', meta: 'function' },
    { value: 'Unix.symlink', meta: 'function' },
    { value: 'Unix.getenv', meta: 'function' },
    { value: 'Unix.setenv', meta: 'function' },
    { value: 'Unix.unsetenv', meta: 'function' },
    { value: 'Unix.getenvlist', meta: 'function' },

    // Utils
    { value: 'Utils.tryEval', meta: 'function' },
    { value: 'Utils.isLittleEndian', meta: 'function' },
    { value: 'Utils.deoptimizeFunction', meta: 'function' },
    { value: 'Utils.optimizeFunction', meta: 'function' },

    // basic
    
    { value: "console.info", meta: "function" },
    { value: "console.log", meta: "function" },
];

var myCompleter = {
    getCompletions: function (editor, session, pos, prefix, callback) {
        var completions = [
            { value: "console", meta: "var console: Console" },
        ];
        var line = session.getLine(pos.row);
        var beforePrefix = line.slice(0, pos.column - prefix.length);
        if (beforePrefix.endsWith('console.')) {
            completions.push({ value: 'log', meta: 'method' });
            completions.push({ value: 'info', meta: 'method' });
        }
        completions = completions.concat(fridaCompletions);
        callback(null, completions);
    }
};

ace.require("ace/theme/one_dark");
editor.setTheme("ace/theme/one_dark");
editor.completers.push(myCompleter);

function formatCode() {
    var code = editor.getValue();
    var formattedCode = js_beautify(code, {
        indent_size: 4,
        space_in_empty_paren: true
    });
    editor.setValue(formattedCode, 1);
}

editor.commands.addCommand({
    name: 'formatCode',
    bindKey: { win: 'Shift-Alt-F'},
    exec: formatCode
});