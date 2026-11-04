# How LLMs Work · LLM 是怎么工作的

LLM 交互教学网站的本地运行项目，包含中英文课程、教学演示、浏览器端模型推理，以及注册与登录功能。

## 本地启动

需要 Node.js 22.13 或更新版本，无需安装 npm 依赖。

```bash
git clone https://github.com/lamp-cat/how-LLM-works.git
cd how-LLM-works/how-llms-work
npm start
```

打开 <http://localhost:5173/zh/chapters/overview>，先注册账号再登录。macOS 用户也可以双击 `how-llms-work/启动网站.command`。

## 下载模型权重

仓库包含模型配置、分词器、WASM 内核及网站运行资源。约 1.7 GB 的 `model.safetensors` 权重不提交到 Git，可使用项目自带的 Python 3 脚本下载：

```bash
cd how-llms-work # 从仓库根目录执行
npm run download:model
```

若当前已在 `how-llms-work` 目录，直接运行 `npm run download:model`。下载工具支持分块续传，完成后保存至 `how-llms-work/model/model.safetensors`。模型推理需要支持 WebGPU 的浏览器；详见[项目运行说明](how-llms-work/README.md)。

## 项目内容

- [how-llms-work/](how-llms-work/)：网站运行文件、服务端、鉴权界面及模型下载工具。
- [技术实施文档](LLM教学平台-技术实施文档.md)
- [阿里云部署手册](LLM教学平台-阿里云部署手册.md)
- [验证记录](how-llms-work/验证记录.md)

## 来源说明

本项目使用参考站 <https://mlx.void.app/zh/chapters/overview> 公开发布的前端构建产物。原站内容、构建资源与模型的来源及修改范围见[项目说明](how-llms-work/README.md#实现来源与修改范围)；本仓库不声明拥有原站源码或发布许可。
