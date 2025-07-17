const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const app = express();
const packageJson = require('./package.json');

// 从环境变量获取端口，如果没有则使用10089
const port = process.env.PORT || 10089;

// 缓存配置
const cacheConfig = {
    maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 100,
    maxMemoryMB: parseInt(process.env.CACHE_MAX_MEMORY_MB) || 50,
    cleanupInterval: parseInt(process.env.CACHE_CLEANUP_INTERVAL) || 60000, // 1分钟
    memoryMonitorInterval: parseInt(process.env.MEMORY_MONITOR_INTERVAL) || 300000 // 5分钟
};

// 缓存管理器类
class CacheManager {
    constructor(maxSize = 100, maxMemoryMB = 50) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
        
        // 定期清理过期缓存
        setInterval(() => this.cleanup(), cacheConfig.cleanupInterval);
    }

    // 生成缓存键
    generateKey(prefix, ...params) {
        return `${prefix}:${params.join(':')}`;
    }

    // 获取缓存
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            this.stats.misses++;
            return null;
        }

        // 检查是否过期
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            this.stats.misses++;
            return null;
        }

        // 更新访问时间（LRU）
        item.lastAccessed = Date.now();
        this.stats.hits++;
        return item.data;
    }

    // 设置缓存
    set(key, data, ttlMs = 60000) {
        // 检查内存使用
        if (this.shouldEvict()) {
            this.evictLRU();
        }

        const item = {
            data,
            expiresAt: Date.now() + ttlMs,
            lastAccessed: Date.now(),
            size: this.estimateSize(data)
        };

        this.cache.set(key, item);
        this.stats.sets++;
    }

    // 删除缓存
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.stats.deletes++;
        }
        return deleted;
    }

    // 清理过期缓存
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.cache.delete(key);
            }
        }
    }

    // 检查是否需要清理
    shouldEvict() {
        return this.cache.size >= this.maxSize || this.getCurrentMemoryUsage() > this.maxMemoryBytes;
    }

    // 清理LRU项目
    evictLRU() {
        let oldestKey = null;
        let oldestTime = Date.now();

        for (const [key, item] of this.cache.entries()) {
            if (item.lastAccessed < oldestTime) {
                oldestTime = item.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    // 估算数据大小（字节）
    estimateSize(data) {
        if (typeof data === 'string') {
            return Buffer.byteLength(data, 'utf8');
        }
        if (typeof data === 'object') {
            return Buffer.byteLength(JSON.stringify(data), 'utf8');
        }
        return 8; // 基本类型估算
    }

    // 获取当前内存使用
    getCurrentMemoryUsage() {
        let totalSize = 0;
        for (const item of this.cache.values()) {
            totalSize += item.size;
        }
        return totalSize;
    }

    // 获取缓存统计
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0;
        
        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            size: this.cache.size,
            maxSize: this.maxSize,
            memoryUsage: `${(this.getCurrentMemoryUsage() / 1024 / 1024).toFixed(2)}MB`,
            maxMemory: `${(this.maxMemoryBytes / 1024 / 1024).toFixed(2)}MB`
        };
    }

    // 清空所有缓存
    clear() {
        this.cache.clear();
    }
}

// 创建全局缓存实例
const cacheManager = new CacheManager(cacheConfig.maxSize, cacheConfig.maxMemoryMB);

// 翻译映射
const translations = {
    'month': '月份',
    'day': '日期',
    'hour': '小时',
    'rx': '接收',
    'tx': '发送',
    'total': '总计',
    'avg. rate': '平均速率',
    'estimated': '预计',
    'daily': '每日',
    'monthly': '每月',
    'hourly': '每小时',
    'yearly': '每年',
    'year': '年份',
    'time': '时间',
    'Available interfaces': '可用接口',
    'received': '接收',
    'transmitted': '发送',
    'Sampling': '正在采样',
    'seconds average': '秒平均值',
    'packets sampled in': '个数据包采样于',
    'seconds': '秒',
    'Traffic average for': '流量平均值 -',
    'current rate': '当前速率',
    'bytes': '字节',
    'packets': '数据包',
    'packets/s': '包/秒',
    'bits/s': 'b/秒',
    'kbit/s': 'kb/秒',
    'Mbit/s': 'Mb/秒',
    'Gbit/s': 'Gb/秒',
    'KiB/s': 'KB/秒',
    'MiB/s': 'MB/秒',
    'GiB/s': 'GB/秒',
    'yesterday': '昨天',
    'today': '今天',
    'last 5 minutes': '最近5分钟',
    'last hour': '最近1小时',
    'last day': '最近24小时',
    'last month': '最近30天'
};

// 预编译正则表达式以提高性能
const compiledTranslations = Object.entries(translations).map(([key, value]) => ({
    regex: new RegExp(`\\b${key}\\b`, 'gi'),
    value
}));

// 预编译特殊处理正则表达式
const samplingRegex = /Sampling ([^ ]+) \((\d+) seconds average\)/;
const packetsSampledRegex = /(\d+) packets sampled in (\d+) seconds/;
const trafficAverageRegex = /Traffic average for (.+)/;

// 周期到单位的映射表
const periodUnitMap = {
    '5': 'MiB',   // 5分钟
    'h': 'MiB',  // 小时
    'd': 'GiB',  // 天
    'm': 'GiB',  // 月
    'y': 'TiB'   // 年
};

// 翻译函数
function translateOutput(text) {
    const lines = text.split('\n');
    return lines.map(line => {
        // 特殊处理采样信息
        if (line.includes('Sampling')) {
            return line
                .replace(samplingRegex, '正在采样 $1 ($2秒平均值)')
                .replace(packetsSampledRegex, '$1 个数据包采样于 $2 秒');
        }
        
        // 特殊处理流量平均值
        if (line.includes('Traffic average for')) {
            return line.replace(trafficAverageRegex, '流量平均值 - $1');
        }

        // 使用预编译正则表达式替换其他常规文本
        for (const { regex, value } of compiledTranslations) {
            line = line.replace(regex, value);
        }

        return line;
    }).join('\n');
}

// 修改时间处理函数
function filterStatsByTime(lines, period) {
    const isHeader = true; // 用于标记表头部分
    const headers = []; // 存储表头行
    const currentTime = new Date();

    return lines.filter(line => {
        // 保存表头信息
        if (isHeader) {
            if (line.includes('---')) {
                headers.push(line);
                isHeader = false; // 遇到分隔线后结束表头部分
                return true;
            }
            headers.push(line);
            return true;
        }

        // 空行保留
        if (!line.trim()) {
            return true;
        }

        let match;
        
        switch(period) {
            case 'minutes':
                // 匹配时间格式 HH:mm
                match = line.match(/(\d{2}):(\d{2})/);
                if (match) {
                    const [hours, minutes] = match.slice(1).map(Number);
                    const lineTime = new Date();
                    lineTime.setHours(hours, minutes, 0, 0);
                    
                    // 如果时间大于当前时间，说明是前一天的数据
                    if (lineTime > currentTime) {
                        lineTime.setDate(lineTime.getDate() - 1);
                    }
                    
                    // 检查是否在最近60分钟内
                    return (currentTime - lineTime) <= 60 * 60 * 1000;
                }
                return false;
                
            case 'hours':
                // 匹配时间格式 HH:mm
                match = line.match(/(\d{2}):(\d{2})/);
                if (match) {
                    const [hours] = match.slice(1).map(Number);
                    const lineTime = new Date();
                    lineTime.setHours(hours, 0, 0, 0);
                    
                    // 如果时间大于当前时间，说明是前一天的数据
                    if (lineTime > currentTime) {
                        lineTime.setDate(lineTime.getDate() - 1);
                    }
                    
                    // 检查是否在最近12小时内
                    return (currentTime - lineTime) <= 12 * 60 * 60 * 1000;
                }
                return false;
                
            case 'days':
                // 匹配日期格式 MM/DD/YY 或 YYYY-MM-DD
                match = line.match(/(\d{2})\/(\d{2})\/(\d{2})/) || line.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (match) {
                    let lineTime;
                    if (match[0].includes('/')) {
                        // MM/DD/YY 格式
                        const [month, day, year] = match.slice(1).map(Number);
                        lineTime = new Date(2000 + year, month - 1, day);
                    } else {
                        // YYYY-MM-DD 格式
                        const [year, month, day] = match.slice(1).map(Number);
                        lineTime = new Date(year, month - 1, day);
                    }
                    
                    // 检查是否在最近12天内
                    const diffTime = currentTime - lineTime;
                    return diffTime <= 12 * 24 * 60 * 60 * 1000 && diffTime >= 0;
                }
                return false;
        }
        return false;
    });
}

// 启用CORS和JSON解析
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 获取网络接口列表
app.get('/api/interfaces', async (req, res) => {
    try {
        // 检查缓存
        const cacheKey = cacheManager.generateKey('interfaces');
        const cachedData = cacheManager.get(cacheKey);
        
        if (cachedData) {
            return res.json(cachedData);
        }

        // 获取所有接口列表
        const iflistResult = await new Promise((resolve, reject) => {
            exec('vnstat --iflist', (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });

        // 解析接口列表
        const allInterfaces = iflistResult
            .split('\n')
            .find(line => line.includes('Available interfaces:'))
            ?.replace('Available interfaces:', '')
            .trim()
            .split(' ')
            .filter(Boolean) || [];

        // 验证每个接口是否有效
        const validInterfaces = [];
        for (const interface of allInterfaces) {
            try {
                await new Promise((resolve, reject) => {
                    exec(`vnstat -i ${interface} --oneline`, (error, stdout, stderr) => {
                        if (!error && stdout.trim()) {
                            validInterfaces.push(interface);
                        }
                        resolve();
                    });
                });
            } catch (error) {
                console.error(`检查接口 ${interface} 时出错:`, error);
            }
        }

        // 如果没有找到有效接口，默认返回 eth0
        if (validInterfaces.length === 0) {
            validInterfaces.push('eth0');
        }

        const result = { interfaces: validInterfaces };
        
        // 缓存结果（5分钟）
        cacheManager.set(cacheKey, result, 5 * 60 * 1000);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: `获取网络接口列表失败: ${error.message}` });
    }
});

// 获取统计数据
app.get('/api/stats/:interface/:period', (req, res) => {
    const { interface, period } = req.params;
    const validPeriods = ['l', '5', 'h', 'd', 'm', 'y'];
    
    if (!interface.match(/^[a-zA-Z0-9]+[a-zA-Z0-9:._-]*$/)) {
        return res.status(400).json({ error: '无效的接口名称' });
    }
    
    if (!validPeriods.includes(period)) {
        return res.status(400).json({ error: '无效的时间周期' });
    }

    // 实时数据不缓存
    if (period === 'l') {
        return getStatsWithoutCache(interface, period, res);
    }

    // 检查缓存
    const cacheKey = cacheManager.generateKey('stats', interface, period);
    const cachedData = cacheManager.get(cacheKey);
    
    if (cachedData) {
        return res.json(cachedData);
    }

    // 获取缓存时间
    const cacheTime = getCacheTimeForPeriod(period);
    
    // 执行命令并处理结果
    getStatsWithoutCache(interface, period, res, (result) => {
        // 缓存结果
        cacheManager.set(cacheKey, result, cacheTime);
    });
});

// 获取缓存时间
function getCacheTimeForPeriod(period) {
    const cacheTimes = {
        '5': 30 * 1000,    // 30秒
        'h': 60 * 1000,    // 1分钟
        'd': 2 * 60 * 1000, // 2分钟
        'm': 5 * 60 * 1000, // 5分钟
        'y': 10 * 60 * 1000 // 10分钟
    };
    return cacheTimes[period] || 60 * 1000;
}

// 获取统计数据（无缓存）
function getStatsWithoutCache(interface, period, res, callback) {
    let cmd;
    switch(period) {
        case 'l':
            cmd = `vnstat -tr -i ${interface}`;
            break;
        case '5':
            cmd = `vnstat -5 -i ${interface}`;
            break;
        default:
            cmd = `vnstat -${period} -i ${interface}`;
    }
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }

        let translatedOutput = translateOutput(stdout);
        let lines = translatedOutput.split('\n');

        // 根据不同时间周期过滤数据
        switch(period) {
            case '5':
                lines = filterStatsByTime(lines, 'minutes');
                break;
            case 'h':
                lines = filterStatsByTime(lines, 'hours');
                break;
            case 'd':
                lines = filterStatsByTime(lines, 'days');
                break;
        }

        // 单位归一化辅助函数
        function normalizeValue(val, targetUnit) {
            if (!val) return val;
            const match = val.match(/([\d.]+)\s*(MiB|GiB|TiB)?/i);
            if (!match) return val;
            const num = parseFloat(match[1]);
            const unit = (match[2] || 'MiB').toUpperCase();
            
            // 统一换算为MiB
            let normalizedNum = num;
            if (unit === 'GIB') normalizedNum *= 1024;
            if (unit === 'TIB') normalizedNum *= 1024 * 1024;
            
            // 目标单位
            if (targetUnit === 'GiB') {
                normalizedNum = normalizedNum / 1024;
                return `${normalizedNum.toFixed(2)} GiB`;
            } else if (targetUnit === 'TiB') {
                normalizedNum = normalizedNum / (1024 * 1024);
                return `${normalizedNum.toFixed(2)} TiB`;
            } else {
                return `${normalizedNum.toFixed(2)} MiB`;
            }
        }

        // 获取当前周期目标单位
        const targetUnit = periodUnitMap[period] || 'MiB';

        // 强制生成标准表头（不依赖原始内容）
        function forceHeader(line) {
            // 判断表头类型
            if (line.includes('时间')) {
                return `时间\t| 接收(${targetUnit})\t| 发送(${targetUnit})\t| 总计(${targetUnit})\t| 平均速率`;
            } else if (line.includes('小时')) {
                return `小时\t| 接收(${targetUnit})\t| 发送(${targetUnit})\t| 总计(${targetUnit})\t| 平均速率`;
            } else if (line.includes('日期')) {
                return `日期\t| 接收(${targetUnit})\t| 发送(${targetUnit})\t| 总计(${targetUnit})\t| 平均速率`;
            } else if (line.includes('月份')) {
                return `月份\t| 接收(${targetUnit})\t| 发送(${targetUnit})\t| 总计(${targetUnit})\t| 平均速率`;
            } else if (line.includes('年份')) {
                return `年份\t| 接收(${targetUnit})\t| 发送(${targetUnit})\t| 总计(${targetUnit})\t| 平均速率`;
            }
            return line;
        }

        lines = lines.map((line, idx) => {
            // 跳过分隔线、空行
            if (line.includes('---') || !line.trim()) return line;
            // 月/年卡片去掉"预计"行
            if ((period === 'm' || period === 'y') && line.includes('预计')) return null;
            // 强制修正表头
            if (line.includes('接收') &&
                (line.includes('时间') || line.includes('小时') || line.includes('日期') || line.includes('月份') || line.includes('年份'))
            ) {
                return forceHeader(line);
            }
            // 处理数据行分隔符
            // 时间（分钟/小时）
            line = line.replace(/^(\s*\d{2}(:\d{2})?)(\s+)/, '$1 |$3');
            // 日期（YYYY-MM-DD）
            line = line.replace(/^(\s*\d{4}-\d{2}-\d{2})(\s+)/, '$1 |$2');
            // 月份（YYYY-MM）
            line = line.replace(/^(\s*\d{4}-\d{2})(\s+)/, '$1 |$2');
            // 年份（YYYY）
            line = line.replace(/^(\s*\d{4})(\s+)/, '$1 |$2');

            // 单位归一化处理
            if (['5', 'h', 'd', 'm', 'y'].includes(period)) {
                // 用 | 分割，找到接收/发送/总计字段
                let parts = line.split('|');
                if (parts.length < 5) return line; // 不处理异常行
                // 只处理数据部分（去除首尾空格）
                let rx = parts[1].trim();
                let tx = parts[2].trim();
                let total = parts[3].trim();
                parts[1] = ' ' + normalizeValue(rx, targetUnit);
                parts[2] = ' ' + normalizeValue(tx, targetUnit);
                parts[3] = ' ' + normalizeValue(total, targetUnit);
                return parts.join('|');
            }
            return line;
        }).filter(Boolean);

        const result = { data: lines };
        
        // 如果有回调函数，执行回调
        if (callback) {
            callback(result);
        }
        
        res.json(result);
    });
}

// 添加日期范围查询API
app.get('/api/stats/:interface/range/:startDate/:endDate', (req, res) => {
    const { interface, startDate, endDate } = req.params;
    
    if (!interface.match(/^[a-zA-Z0-9]+[a-zA-Z0-9:._-]*$/)) {
        return res.status(400).json({ error: '无效的接口名称' });
    }

    // 验证日期格式 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({ error: '无效的日期格式' });
    }

    // 检查缓存
    const cacheKey = cacheManager.generateKey('range', interface, startDate, endDate);
    const cachedData = cacheManager.get(cacheKey);
    
    if (cachedData) {
        return res.json(cachedData);
    }

    const cmd = `vnstat -i ${interface} --begin ${startDate} --end ${endDate} -d`;
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }

        let translatedOutput = translateOutput(stdout);
        let lines = translatedOutput.split('\n');

        const result = { data: lines };
        
        // 缓存结果（10分钟）
        cacheManager.set(cacheKey, result, 10 * 60 * 1000);
        
        res.json(result);
    });
});

// 添加获取版本号的路由
app.get('/api/version', (req, res) => {
    res.json({ version: packageJson.version });
});

// 添加缓存统计API
app.get('/api/cache/stats', (req, res) => {
    res.json(cacheManager.getStats());
});

// 添加缓存清理API
app.post('/api/cache/clear', (req, res) => {
    cacheManager.clear();
    res.json({ message: '缓存已清空' });
});

// 添加内存使用监控API
app.get('/api/system/memory', (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
        cacheMemory: cacheManager.getStats().memoryUsage
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err.stack);
    
    // 如果是缓存相关错误，记录详细信息
    if (err.message && err.message.includes('cache')) {
        console.error('缓存错误详情:', {
            url: req.url,
            method: req.method,
            cacheStats: cacheManager.getStats()
        });
    }
    
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const server = app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`缓存配置: 最大条目=${cacheConfig.maxSize}, 最大内存=${cacheConfig.maxMemoryMB}MB`);
    
    // 启动内存监控
    setInterval(() => {
        const memUsage = process.memoryUsage();
        const cacheStats = cacheManager.getStats();
        console.log(`内存使用: RSS=${(memUsage.rss / 1024 / 1024).toFixed(2)}MB, 缓存=${cacheStats.memoryUsage}, 命中率=${cacheStats.hitRate}`);
    }, cacheConfig.memoryMonitorInterval);
    
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 已被占用，请尝试使用其他端口`);
        console.error('你可以通过设置环境变量 PORT 来指定其他端口，例如：');
        console.error('PORT=8080 npm start');
    } else {
        console.error('启动服务器时发生错误:', err);
    }
    process.exit(1);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
}); 