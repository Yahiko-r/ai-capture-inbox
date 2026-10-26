# 设置功能实现文档

## 功能概述

为AI Capture Inbox添加了用户配置界面，允许用户在打包后的应用中配置AI Provider（DeepSeek/OpenAI）的API Key和相关设置。

## 实现的功能

### 1. 安全存储
- 使用 `tauri-plugin-store` 加密存储用户配置
- API Key不会明文存储在文件系统中
- 配置文件：`.local/share/com.yahiko.ai-capture-inbox/settings.json`（加密）

### 2. 配置优先级
```
用户配置（Store） > .env文件 > 默认值
```

### 3. UI组件
- **设置入口**：左下角齿轮⚙️图标
- **设置页面**：macOS风格两栏布局
  - 左侧：设置分类导航
  - 右侧：具体配置表单

### 4. 配置项
- Provider选择（DeepSeek / OpenAI）
- API Key（密码输入框）
- Base URL（可选，留空使用默认）
- Model（可选，留空使用默认）

### 5. 交互功能
- **测试连接**：验证API Key有效性
- **保存设置**：持久化配置
- 实时状态反馈（成功/错误）

## 代码变更

### 后端（Rust）

#### 1. 新增依赖 `src-tauri/Cargo.toml`
```toml
tauri-plugin-store = "2"
```

#### 2. 新增模块 `src-tauri/src/settings.rs`
- `get_llm_settings()` - 读取用户配置
- `save_llm_settings()` - 保存配置
- `test_llm_connection()` - 测试API连接

#### 3. 修改 `src-tauri/src/lib.rs`
- 添加settings模块引用
- 注册store插件
- 注册3个新的Tauri命令

#### 4. 修改 `src-tauri/src/llm.rs`
- `resolve_llm_config(app: Option<&AppHandle>)` - 现在可以从Store读取配置
- `load_user_settings()` - 从Store加载
- `build_config_from_user_settings()` - 从用户配置构建LlmConfig
- 配置优先级：用户配置 > .env > 默认值

#### 5. 修改 `src-tauri/src/commands.rs`
- 更新所有调用 `has_llm_config()` 和 `resolve_llm_config()` 的地方
- 传入 `app` 参数

### 前端（HTML/CSS/JS）

#### 1. HTML `public/index.html`
- 在sidebar-footer添加设置按钮
- 添加设置页面模板 `#settingsTemplate`

#### 2. CSS `public/styles.css`
- 添加设置视图样式（~100行）
- macOS风格的两栏布局
- 表单样式和状态提示样式

#### 3. JavaScript `public/app.js`
- 添加 `settingsButton` 引用
- 添加设置按钮点击事件
- `renderSettings()` - 渲染设置页面
- `saveLlmSettings()` - 保存配置
- `testConnection()` - 测试连接
- `showConnectionStatus()` - 显示状态

## 使用流程

### 首次配置
1. 启动应用
2. 点击左下角齿轮⚙️图标
3. 选择Provider（deepseek或openai）
4. 输入API Key
5. （可选）输入Base URL和Model
6. 点击"测试连接"验证
7. 点击"保存设置"

### 配置更新
- 配置保存后立即生效
- 下次启动自动加载
- 可随时修改

## 默认值

### DeepSeek
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-flash`（支持多模态）

### OpenAI
- Base URL: `https://api.openai.com/v1`
- Model: `gpt-4o-mini`

## 测试步骤

### 1. 编译运行
```bash
cd /Users/mac/Documents/personal/ai-capture-inbox
npm run tauri:dev
```

### 2. 测试UI
- 左下角应该能看到齿轮图标
- 点击后应该显示设置页面
- 表单样式应该正常

### 3. 测试保存
- 填写Provider和API Key
- 点击"保存设置"
- 应该显示成功提示
- 检查配置文件是否生成（加密的）

### 4. 测试连接
- 填写有效的API Key
- 点击"测试连接"
- 应该显示连接成功或失败信息

### 5. 测试优先级
- 保存用户配置
- 检查.env文件是否仍然存在
- 应用应该使用用户配置，而不是.env

### 6. 测试持久化
- 保存配置后关闭应用
- 重新启动应用
- 配置应该自动加载

## 潜在问题和解决方案

### 问题1：Store文件位置
- macOS: `~/Library/Application Support/com.yahiko.ai-capture-inbox/settings.json`
- 打包后路径会改变，但插件会自动处理

### 问题2：迁移现有.env配置
- 现有.env配置会继续作为fallback工作
- 用户首次打开设置页面时，可以提示导入.env配置

### 问题3：首次启动体验
- 如果检测到没有配置，可以自动打开设置页面
- 或在顶部显示横幅提示

## 未来改进

### 1. 首次启动向导
```javascript
async function checkFirstRun() {
  const settings = await tauriInvoke("get_llm_settings");
  if (!settings) {
    state.view = "settings";
    render();
  }
}
```

### 2. 导入.env配置
添加一个"从.env导入"按钮，自动填充表单

### 3. 支持更多Provider
- Gemini
- 自定义OpenAI兼容服务

### 4. 代理配置
代码中已有proxy支持，可以在UI中暴露

### 5. 模型选择下拉框
根据Provider动态显示可用模型列表

## 相关文件

### 修改的文件
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/llm.rs`
- `src-tauri/src/commands.rs`
- `public/index.html`
- `public/styles.css`
- `public/app.js`

### 新增的文件
- `src-tauri/src/settings.rs`

## 安全注意事项

1. **API Key加密存储**
   - 使用tauri-plugin-store的加密功能
   - 不会明文存储在文件系统

2. **测试连接安全**
   - 只发送最小化请求（5 tokens）
   - 不发送敏感数据

3. **密码输入框**
   - API Key使用`type="password"`
   - 防止肩窥攻击

## 编译注意事项

确保Rust工具链已安装：
```bash
# 检查cargo
cargo --version

# 如果没有，安装Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 总结

这个实现提供了完整的用户配置界面，使得应用可以打包分发给其他用户使用。用户不再需要手动编辑.env文件，而是通过友好的GUI界面进行配置。配置被安全地加密存储，并且支持测试连接功能，提升了用户体验。
