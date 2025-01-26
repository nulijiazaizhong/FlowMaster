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

# 检查是否已安装
check_installation() {
    if [ -d "/opt/flowmaster" ] || command -v flowmaster &> /dev/null; then
        return 0 # 已安装
    else
        return 1 # 未安装
    fi
}

# 显示菜单
show_menu() {
    local is_installed=$1
    
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}    FlowMaster 管理菜单${NC}"
    echo -e "${GREEN}================================${NC}"
    
    if [ "$is_installed" = "true" ]; then
        echo -e "1) 重新安装 FlowMaster"
        echo -e "2) 卸载 FlowMaster"
        echo -e "3) 退出"
        echo
        echo -e "检测到系统已安装 FlowMaster"
    else
        echo -e "1) 安装 FlowMaster"
        echo -e "2) 退出"
        echo
        echo -e "系统未安装 FlowMaster"
    fi
    
    echo -e "请选择操作: "
    
    # 创建临时脚本来处理用户输入
    TMP_SCRIPT=$(mktemp)
    cat > "$TMP_SCRIPT" << 'EOF'
#!/bin/bash
read -t 10 choice
echo "$choice"
EOF
    chmod +x "$TMP_SCRIPT"
    
    # 使用新的终端执行读取操作
    if [ -t 1 ] && command -v script >/dev/null 2>&1; then
        choice=$(script -q /dev/null -c "$TMP_SCRIPT")
    else
        choice=$(bash "$TMP_SCRIPT")
    fi
    
    # 清理临时脚本
    rm -f "$TMP_SCRIPT"
    
    # 处理选择结果
    if [ -z "$choice" ]; then
        echo -e "\n${YELLOW}未检测到输入，默认选择安装/重新安装...${NC}"
        echo "1"
    else
        echo "$choice"
    fi
}

# 卸载函数
uninstall() {
    echo -e "\n${YELLOW}正在卸载 FlowMaster...${NC}"
    
    # 停止和删除 PM2 实例
    if command -v pm2 &> /dev/null; then
        pm2 stop flowmaster 2>/dev/null || true
        pm2 delete flowmaster 2>/dev/null || true
        pm2 save
    fi
    
    # 删除安装目录
    rm -rf /opt/flowmaster
    
    # 删除控制脚本
    rm -f /usr/local/bin/flowmaster
    
    # 清理 vnstat 数据库（可选）
    systemctl stop vnstat
    rm -f /var/lib/vnstat/*
    
    echo -e "${GREEN}FlowMaster 已成功卸载！${NC}"
}

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
    check_and_install "bc"
    
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
        
        # 获取 vnstat 版本
        VNSTAT_VERSION=$(vnstat --version | head -n1 | awk '{print $2}')
        echo -e "${GREEN}检测到 vnstat 版本: ${VNSTAT_VERSION}${NC}"
        
        # 初始化数据库
        if vnstat --add -i "$ACTIVE_INTERFACE" &>/dev/null; then
            echo -e "${GREEN}使用新版本命令初始化接口${NC}"
        elif vnstat -u -i "$ACTIVE_INTERFACE" &>/dev/null; then
            echo -e "${GREEN}使用旧版本命令初始化接口${NC}"
        else
            echo -e "${GREEN}尝试直接创建接口${NC}"
            # 某些版本可能不需要显式初始化
            systemctl restart vnstat
        fi
        
        # 修改配置文件以加快数据收集
        if [ -f "/etc/vnstat.conf" ]; then
            cp /etc/vnstat.conf /etc/vnstat.conf.bak
            echo -e "${GREEN}备份原配置文件到 /etc/vnstat.conf.bak${NC}"
            
            # 更新配置
            sed -i 's/^UpdateInterval.*/UpdateInterval 30/' /etc/vnstat.conf
            sed -i 's/^SaveInterval.*/SaveInterval 60/' /etc/vnstat.conf
            
            # 确保接口在配置文件中
            if ! grep -q "^Interface \"$ACTIVE_INTERFACE\"" /etc/vnstat.conf; then
                echo "Interface \"$ACTIVE_INTERFACE\"" >> /etc/vnstat.conf
            fi
            
            echo -e "${GREEN}已更新配置文件${NC}"
        fi
        
        # 重启服务
        systemctl restart vnstat
        
        # 等待初始数据收集
        echo -e "${YELLOW}等待初始数据收集（约1分钟）...${NC}"
        sleep 60
        
        # 验证接口是否正常工作
        if vnstat -i "$ACTIVE_INTERFACE" &>/dev/null; then
            echo -e "${GREEN}接口 $ACTIVE_INTERFACE 已成功初始化${NC}"
        else
            echo -e "${RED}警告：接口初始化可能不完整，但这不影响继续安装${NC}"
        fi
        
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
    
    # 获取服务器IP地址
    # 首先尝试获取外网IP
    PUBLIC_IP=$(curl -s -4 ip.sb || curl -s -4 ifconfig.me || curl -s -4 api.ipify.org)
    
    if [ -n "$PUBLIC_IP" ]; then
        echo -e "\n${GREEN}访问地址: http://${PUBLIC_IP}:10088${NC}"
    else
        # 如果无法获取外网IP，则尝试获取内网IP
        INTERNAL_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | head -n 1)
        if [ -n "$INTERNAL_IP" ]; then
            echo -e "\n${GREEN}访问地址: http://${INTERNAL_IP}:10088${NC}"
            echo -e "${YELLOW}注意：这是内网地址，如需外网访问请使用服务器公网IP${NC}"
        else
            echo -e "\n${RED}无法获取服务器IP地址，请手动使用服务器IP访问端口10088${NC}"
        fi
    fi
}

# 修改主程序入口
main() {
    local is_installed=false
    if check_installation; then
        is_installed=true
    fi
    
    # 检查是否通过管道运行
    if [ ! -t 0 ]; then
        echo -e "${YELLOW}检测到通过管道运行安装脚本${NC}"
        echo -e "${YELLOW}请使用以下命令来管理 FlowMaster：${NC}"
        echo -e "\n${GREEN}1. 安装/重新安装：${NC}"
        echo "wget -O flowmaster_install.sh https://raw.githubusercontent.com/vbskycn/FlowMaster/main/install.sh && bash flowmaster_install.sh"
        echo -e "\n${GREEN}2. 卸载：${NC}"
        echo "flowmaster uninstall"
        echo -e "\n${YELLOW}退出安装...${NC}"
        exit 0
    fi
    
    choice=$(show_menu $is_installed)
    
    if [ "$is_installed" = "true" ]; then
        case $choice in
            1)
                echo -e "\n${YELLOW}准备重新安装 FlowMaster...${NC}"
                uninstall
                echo -e "\n${GREEN}开始新安装...${NC}"
                sleep 2
                install_dependencies
                install_pm2
                install_flowmaster
                setup_pm2
                create_control_script
                finish_installation
                ;;
            2)
                uninstall
                ;;
            3)
                echo -e "\n${GREEN}退出程序${NC}"
                exit 0
                ;;
            *)
                echo -e "\n${YELLOW}无效的选择，请重新运行脚本${NC}"
                exit 1
                ;;
        esac
    else
        case $choice in
            1)
                echo -e "\n${GREEN}开始安装 FlowMaster...${NC}"
                install_dependencies
                install_pm2
                install_flowmaster
                setup_pm2
                create_control_script
                finish_installation
                ;;
            2)
                echo -e "\n${GREEN}退出程序${NC}"
                exit 0
                ;;
            *)
                echo -e "\n${YELLOW}无效的选择，请重新运行脚本${NC}"
                exit 1
                ;;
        esac
    fi
}

# 执行主程序
main 