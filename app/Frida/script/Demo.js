var pattern = "50 FF 77 04 FF 74 24 24 FF 37 FF ?? ?? ?? ?? ??";

var ranges = Process.enumerateRangesSync({
    protection: 'r--', // 可读的区域
    coalesce: true
});

ranges.forEach(function(range) {
    Memory.scan(range.base, range.size, pattern, {
        onMatch: function(address, size) {
            console.log("在 " + address.toString() + " 发现匹配, 大小: " + size);
        },
        onError: function(reason) {
            console.log("扫描错误: " + reason);
        },
        onComplete: function() {
            // 此范围的扫描完成
        }
    });
});