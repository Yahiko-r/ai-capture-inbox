# 设置功能测试清单

## 前置条件

确保Rust工具链已安装：
```bash
# 检查
cargo --version
rustc --version

# 如果没有，安装
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 启动应用

```bash
cd /Users/mac/Documents/personal/ai-capture-inbox
npm run tauri:dev
```

## 测试步骤

### 1. UI检查 ✓
- [ ] 应用正常启动
- [ ] 左下角能看到齿轮⚙️图标（在刷新按钮旁边）
- [ ] 点击齿轮后显示设置页面
- [ ] 设置页面是两栏布局（左侧导航，右侧表单）

### 2. 表单功能 ✓
- [ ] Provider下拉框有DeepSeek和OpenAI选项
- [ ] API Key输入框是密码类型（不显示明文）
- [ ] Base URL和Model输入框可以留空
- [ ] 有"测试连接"和"保存设置"两个按钮

### 3. 测试连接功能 ✓
使用真实的API Key测试：
- [ ] 填写Provider（选择deepseek）
- [ ] 填写有效的API Key
- [ ] 点击"测试连接"
- [ ] 应该显示绿色成功提示："Connection successful! Model: deepseek-flash"
- [ ] 填写无效API Key，应该显示红色错误提示

### 4. 保存配置 ✓
- [ ] 填写完整信息
- [ ] 点击"保存设置"
- [ ] 显示成功提示："Settings saved successfully!"
- [ ] 页面自动刷新，provider标签更新

### 5. 配置持久化 ✓
- [ ] 保存配置后关闭应用
- [ ] 重新启动应用
- [ ] 点击齿轮图标打开设置
- [ ] 配置应该自动填充（API Key会显示为密码）

### 6. 配置文件位置 ✓
macOS配置文件位置：
```bash
# Store配置文件（加密）
~/Library/Application Support/com.yahiko.ai-capture-inbox/settings.json
```
- [ ] 文件存在
- [ ] 内容是加密的（不是明文JSON）

### 7. 配置优先级测试 ✓
- [ ] 保存用户配置（DeepSeek）
- [ ] .env文件仍然存在（可能配置的是OpenAI）
- [ ] 创建新的note，查看AI分析
- [ ] 应该使用用户配置的DeepSeek，而不是.env的OpenAI

### 8. API Key使用测试 ✓
- [ ] 配置DeepSeek API Key并保存
- [ ] 创建一条文本note："今天天气真好"
- [ ] 应该能成功调用DeepSeek API进行分析
- [ ] 查看sidebar顶部的provider标签，应该显示"deepseek-flash"

## 预期行为

### 成功场景
1. **首次使用**：点击齿轮→配置→保存→正常使用
2. **切换Provider**：可以随时从DeepSeek切换到OpenAI
3. **测试连接**：立即验证API Key有效性
4. **加密存储**：配置文件不是明文

### 错误处理
1. **空表单**：应该提示"Please fill in provider and API key"
2. **无效API Key**：测试连接失败，显示具体错误信息
3. **网络错误**：显示"Network error: ..."

## 调试技巧

### 查看Tauri控制台日志
按F12打开开发者工具，查看Console

### 查看Rust日志
```bash
# 在terminal窗口会看到Rust后端的日志
```

### 手动查看Store配置
```bash
cat ~/Library/Application\ Support/com.yahiko.ai-capture-inbox/settings.json
# 内容应该是加密的
```

### 测试配置读取
在浏览器Console中执行：
```javascript
await window.__TAURI__.core.invoke("get_llm_settings")
// 应该返回当前配置
```

## 常见问题

### Q: 点击齿轮没反应
A: 检查Console是否有JavaScript错误

### Q: 保存配置失败
A: 检查Rust后端日志，可能是权限问题

### Q: 配置保存了但没生效
A: 刷新页面或重启应用

### Q: 测试连接一直loading
A: 检查网络连接，可能被防火墙拦截

### Q: API Key显示明文
A: 检查HTML中input type是否是password

## 代码检查点

如果遇到问题，检查这些文件：

### Rust后端
- `src-tauri/Cargo.toml` - 依赖是否正确
- `src-tauri/src/settings.rs` - 配置逻辑
- `src-tauri/src/llm.rs` - API调用逻辑
- `src-tauri/src/lib.rs` - 命令注册

### 前端
- `public/index.html` - 模板和按钮
- `public/styles.css` - 样式
- `public/app.js` - 交互逻辑

## 成功标志

✅ 所有测试项都打勾
✅ 可以不修改.env文件就使用应用
✅ 可以打包给其他人使用
✅ API Key安全存储，不会泄露
