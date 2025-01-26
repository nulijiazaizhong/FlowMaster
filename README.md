# FlowMaster - 专业的网络流量监控系统

[![license](https://img.shields.io/github/license/vbskycn/FlowMaster)](https://github.com/vbskycn/FlowMaster/blob/main/LICENSE)[![stars](https://img.shields.io/github/stars/vbskycn/FlowMaster)](https://github.com/vbskycn/FlowMaster/stargazers)[![issues](https://img.shields.io/github/issues/vbskycn/FlowMaster)](https://github.com/vbskycn/FlowMaster/issues)

## 📝 项目介绍

FlowMaster 是一个基于 vnstat 的专业网络流量监控系统，提供实时流量统计、历史数据分析等功能。系统采用现代化的 Web 界面，支持多网卡监控，让网络流量监控变得简单而强大。

### ✨ 主要特性

- 🚀 实时流量监控
- 📊 多维度数据统计（分钟、小时、日、月、年）
- 🌐 多网卡支持
- 🎯 自动刷新功能
- 📱 响应式设计，支持移动端
- 🌙 现代深色主题
- 🔄 数据自动更新

## 🛠️ 技术栈

| 组件 | 技术 |
|-----------|------------|
| 后端框架 | Node.js + Express |
| 前端框架 | Vue 3 + Bootstrap 5 |
| 监控工具 | vnstat |
| 接口类型 | RESTful API |

## 📦 安装部署

### 环境要求

| 组件 | 版本 |
|-----------|---------|
| Node.js | 14.0.0 或更高版本 |
| vnstat | 2.0.0 或更高版本 |
| 包管理器 | npm 或 yarn |

### 自动安装(推荐)

```
curl -fsSL https://raw.githubusercontent.com/vbskycn/FlowMaster/main/install.sh | sudo bash
```

```
##### 启动服务

flowmaster start

##### 2停止服务

flowmaster stop

##### 3重启服务

flowmaster restart

##### 4查看状态

flowmaster status

##### 5卸载服务

flowmaster uninstall
```





### 手动安装步骤

#### 1. 安装 vnstat

```bash
# Debian/Ubuntu
sudo apt-get install vnstat

# CentOS
sudo yum install vnstat
```

#### 2. 克隆项目

```bash
git clone https://github.com/vbskycn/FlowMaster.git
cd FlowMaster
```

#### 3. 安装依赖

```bash
npm install
# 或
yarn install
```

#### 4. 启动服务

```bash
npm start
# 或
yarn start
```

默认访问地址：`http://localhost:10088`

### 🔧 配置说明

可通过环境变量配置端口：

```bash
PORT=8080 npm start
```

## 📖 使用说明

1. 系统启动后，自动检测可用网卡
2. 在界面上选择要监控的网卡
3. 查看实时流量和历史统计数据
4. 可开启自动刷新功能，实时更新数据

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建新分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'Add some AmazingFeature'`
4. 推送分支：`git push origin feature/AmazingFeature`
5. 提交 Pull Request

## 📄 开源协议

本项目采用 MIT 协议开源，详见 [LICENSE](LICENSE) 文件。

## 👨‍💻 作者

**vbskycn**

- GitHub: [@vbskycn](https://github.com/vbskycn)

## 🙏 致谢

- [vnstat](https://github.com/vergoh/vnstat) - 强大的网络流量监控工具
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Bootstrap](https://getbootstrap.com/) - 流行的前端组件库

## 📞 联系方式

如有问题或建议，欢迎通过以下方式联系：

- 提交 [Issue](https://github.com/vbskycn/FlowMaster/issues)
- 访问我的 [GitHub 主页](https://github.com/vbskycn)

---

如果这个项目对你有帮助，欢迎 star ⭐️