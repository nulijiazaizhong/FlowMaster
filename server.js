const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const app = express();
const packageJson = require('./package.json');

// 从环境变量获取端口，如果没有则使用10089
const port = process.env.PORT || 10089;

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
    'bits/s': '比特/秒',
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

// 翻译函数
function translateOutput(text) {
    let lines = text.split('\n');
    lines = lines.map(line => {
        // 特殊处理采样信息
        if (line.includes('Sampling')) {
            return line
                .replace(/Sampling ([^ ]+) \((\d+) seconds average\)/, '正在采样 $1 ($2秒平均值)')
                .replace(/(\d+) packets sampled in (\d+) seconds/, '$1 个数据包采样于 $2 秒');
        }
        
        // 特殊处理流量平均值
        if (line.includes('Traffic average for')) {
            return line.replace(/Traffic average for (.+)/, '流量平均值 - $1');
        }

        // 替换其他常规文本
        Object.keys(translations).forEach(key => {
            const regex = new RegExp(`\\b${key}\\b`, 'gi');
            line = line.replace(regex, translations[key]);
        });

        return line;
    });
    return lines.join('\n');
}

// 修改时间处理函数
function filterStatsByTime(lines, period) {
    let isHeader = true; // 用于标记表头部分
    let headers = []; // 存储表头行

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
        let currentTime = new Date();
        
        switch(period) {
            case 'minutes':
                // 匹配时间格式 HH:mm
                match = line.match(/(\d{2}):(\d{2})/);
                if (match) {
                    const [hours, minutes] = match.slice(1).map(Number);
                    let lineTime = new Date();
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
                    let lineTime = new Date();
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

        res.json({ interfaces: validInterfaces });
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

        res.json({ data: lines });
    });
});

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

    const cmd = `vnstat -i ${interface} --begin ${startDate} --end ${endDate} -d`;
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }

        let translatedOutput = translateOutput(stdout);
        let lines = translatedOutput.split('\n');

        res.json({ data: lines });
    });
});

// 添加获取版本号的路由
app.get('/api/version', (req, res) => {
    res.json({ version: packageJson.version });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const server = app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
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