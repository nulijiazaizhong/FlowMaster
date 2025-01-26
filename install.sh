#!/bin/bash

# 定义颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}请使用 root 权限运行此脚本${NC}"
    exit 1
fi

# 打印横幅
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}    FlowMaster 安装脚本${NC}"
echo -e "${GREEN}================================${NC}"

# 函数：检查并安装依赖
check_and_install() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${YELLOW}正在安装 $1...${NC}"
        if [ -x "$(command -v apt-get)" ]; then
            apt-get install -y $1
        elif [ -x "$(command -v yum)" ]; then
            yum install -y $1
        else
            echo -e "${RED}无法确定包管理器，请手动安装 $1${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}$1 已安装${NC}"
    fi
}

# 安装基本依赖
install_dependencies() {
    echo -e "\n${GREEN}[1/6] 检查并安装系统依赖...${NC}"
    
    # 更新包管理器
    if [ -x "$(command -v apt-get)" ]; then
        apt-get update
    elif [ -x "$(command -v yum)" ]; then
        yum update -y
    fi
    
    # 检查并安装必要的包
    check_and_install "curl"
    check_and_install "vnstat"
    check_and_install "nodejs"
    check_and_install "npm"
    
    # 启动并启用 vnstat 服务
    systemctl start vnstat
    systemctl enable vnstat

    detect_network_interface
}

# 在 install_dependencies 函数中添加以下内容
detect_network_interface() {
    echo -e "\n${GREEN}检测网络接口...${NC}"
    ACTIVE_INTERFACE=$(ip -o link show up | grep -v "lo:" | awk -F': ' '{print $2}' | head -n 1)
    
    if [ -n "$ACTIVE_INTERFACE" ]; then
        echo -e "${GREEN}检测到网络接口: ${ACTIVE_INTERFACE}${NC}"
        
        # 停止 vnstat 服务
        systemctl stop vnstat
        
        # 删除旧数据库
        rm -f /var/lib/vnstat/*
        
        # 初始化数据库
        vnstat -u -i $ACTIVE_INTERFACE
        
        # 修改配置文件以加快数据收集
        sed -i 's/UpdateInterval .*/UpdateInterval 30/' /etc/vnstat.conf
        sed -i 's/SaveInterval .*/SaveInterval 60/' /etc/vnstat.conf
        
        # 重启服务
        systemctl restart vnstat
        
        # 等待初始数据收集
        echo -e "${YELLOW}等待初始数据收集（约1分钟）...${NC}"
        sleep 60
        
        # 再次更新数据库
        vnstat -u -i $ACTIVE_INTERFACE
    else
        echo -e "${RED}未检测到活动的网络接口${NC}"
        exit 1
    fi
}

# 安装 PM2
install_pm2() {
    echo -e "\n${GREEN}[2/6] 安装 PM2...${NC}"
    if ! command -v pm2 &> /dev/null; then
        npm install -g pm2
    else
        echo -e "${GREEN}PM2 已安装${NC}"
    fi
}

# 安装 FlowMaster
install_flowmaster() {
    echo -e "\n${GREEN}[3/6] 安装 FlowMaster...${NC}"
    
    # 创建安装目录
    mkdir -p /opt/flowmaster
    cd /opt/flowmaster
    
    # 下载项目文件
    echo -e "${YELLOW}下载项目文件...${NC}"
    curl -L https://github.com/vbskycn/FlowMaster/archive/main.tar.gz | tar xz --strip-components=1
    
    # 安装依赖
    echo -e "${YELLOW}安装项目依赖...${NC}"
    npm install
}

# 配置 PM2
setup_pm2() {
    echo -e "\n${GREEN}[4/6] 配置 PM2...${NC}"
    
    # 停止已存在的实例
    pm2 stop flowmaster 2>/dev/null || true
    pm2 delete flowmaster 2>/dev/null || true
    
    # 启动新实例
    cd /opt/flowmaster
    pm2 start server.js --name flowmaster
    
    # 保存 PM2 配置
    pm2 save
    
    # 设置开机自启
    pm2 startup
}

# 创建服务控制脚本
create_control_script() {
    echo -e "\n${GREEN}[5/6] 创建控制脚本...${NC}"
    
    cat > /usr/local/bin/flowmaster << 'EOF'
#!/bin/bash
case "$1" in
    start)
        pm2 start flowmaster
        ;;
    stop)
        pm2 stop flowmaster
        ;;
    restart)
        pm2 restart flowmaster
        ;;
    status)
        pm2 show flowmaster
        ;;
    uninstall)
        pm2 stop flowmaster
        pm2 delete flowmaster
        rm -rf /opt/flowmaster
        rm -f /usr/local/bin/flowmaster
        echo "FlowMaster 已卸载"
        ;;
    *)
        echo "用法: flowmaster {start|stop|restart|status|uninstall}"
        exit 1
        ;;
esac
EOF
    
    chmod +x /usr/local/bin/flowmaster
}

# 完成安装
finish_installation() {
    echo -e "\n${GREEN}[6/6] 完成安装...${NC}"
    echo -e "\n${GREEN}FlowMaster 安装完成！${NC}"
    echo -e "\n使用方法:"
    echo -e "${YELLOW}启动: ${NC}flowmaster start"
    echo -e "${YELLOW}停止: ${NC}flowmaster stop"
    echo -e "${YELLOW}重启: ${NC}flowmaster restart"
    echo -e "${YELLOW}状态: ${NC}flowmaster status"
    echo -e "${YELLOW}卸载: ${NC}flowmaster uninstall"
    echo -e "\n${GREEN}访问地址: http://您的服务器IP:10088${NC}"
}

# 主安装流程
main() {
    install_dependencies
    install_pm2
    install_flowmaster
    setup_pm2
    create_control_script
    finish_installation
}

# 执行安装
main 