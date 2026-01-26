<!--
============================================================================
SYNC IMPACT REPORT
============================================================================
Version change: N/A → 1.0.0 (Initial adoption)
Modified principles: N/A (New constitution)
Added sections:
  - Core Principles (4 principles)
  - Technical Standards
  - Development Workflow
  - Governance
Removed sections: N/A
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ (Compatible - Constitution Check section exists)
  - .specify/templates/spec-template.md ✅ (Compatible - No conflicts)
  - .specify/templates/tasks-template.md ✅ (Compatible - No conflicts)
  - .specify/templates/checklist-template.md ✅ (Compatible - No conflicts)
  - .specify/templates/agent-file-template.md ✅ (Compatible - No conflicts)
Follow-up TODOs: None
============================================================================
-->

# AI Video Maker Constitution

## Core Principles

### I. Code Simplicity (代码简洁)

代码 MUST 保持简洁明了，遵循以下规则：

- 每个函数/方法 MUST 只做一件事，函数体不超过 50 行
- 变量和函数命名 MUST 清晰表达意图，禁止使用无意义的缩写
- 禁止过度抽象：如果一段逻辑只被使用一次，MUST NOT 创建独立函数
- 注释只在逻辑不明显时添加，代码本身 SHOULD 是自解释的
- 遵循 DRY 原则，但重复优于错误的抽象

**理由**: 简洁的代码更易理解、维护和调试，降低长期开发成本。

### II. Structured Architecture (结构化)

项目结构 MUST 清晰分层，遵循以下规则：

- 目录结构 MUST 按功能模块划分：`tools/`、`services/`、`models/`、`utils/`
- 每个模块 MUST 有明确的职责边界，禁止循环依赖
- 配置与代码分离：所有可配置项 MUST 通过配置文件或环境变量管理
- 输入/输出 MUST 有明确的数据格式定义（如 JSON Schema、Pydantic Model）
- CLI 工具 MUST 遵循标准输入/输出协议：参数→处理→结果

**理由**: 结构化的架构使团队协作更高效，新成员能快速上手。

### III. Extensibility (可扩展)

系统设计 MUST 支持扩展而不修改核心代码：

- 新功能 SHOULD 通过添加新模块实现，而非修改已有模块
- 关键组件 MUST 支持插件式扩展（如视频处理器、检测器）
- 接口设计 MUST 使用抽象基类或协议，便于替换实现
- 配置驱动：行为变更 SHOULD 优先通过配置而非代码修改
- 向后兼容：公共 API 变更 MUST 遵循语义化版本控制

**理由**: 可扩展性确保项目能持续演进而不积累技术债务。

### IV. Rapid Development (快速开发)

开发流程 MUST 优化效率，遵循以下规则：

- 优先使用成熟的第三方库，禁止重复造轮子
- 新功能 MUST 先有可运行的最小实现（MVP），再迭代优化
- 自动化优先：重复性任务 MUST 通过脚本或工具自动完成
- 快速反馈循环：代码修改后 MUST 能在 30 秒内验证结果
- 文档即代码：关键用法 MUST 有可执行的示例代码

**理由**: 快速开发能力使项目能快速响应需求变化，保持竞争力。

## Technical Standards

### 技术栈要求

- **语言**: Python 3.10+
- **依赖管理**: pip + requirements.txt 或 pyproject.toml
- **代码风格**: 遵循 PEP 8，使用 black 格式化，ruff 或 flake8 检查
- **类型提示**: 公共 API MUST 包含完整的类型注解

### 代码质量标准

- 公共函数 MUST 有 docstring 说明功能、参数和返回值
- 错误处理 MUST 提供有意义的错误信息，便于调试
- 敏感信息（API Key、密码）MUST NOT 硬编码在代码中

## Development Workflow

### 开发流程

1. **需求确认**: 明确功能范围和验收标准
2. **快速原型**: 24 小时内产出可演示的 MVP
3. **迭代优化**: 根据反馈逐步完善
4. **代码审查**: 重大变更需要审查

### 提交规范

- 提交信息 MUST 清晰描述变更内容
- 格式: `<type>: <description>` (type: feat/fix/refactor/docs/chore)
- 每次提交 SHOULD 是一个完整的逻辑单元

## Governance

### 宪法管理

- 本宪法是项目的最高指导原则，所有开发活动 MUST 遵循
- 宪法修订 MUST 记录修订原因、版本变更和影响范围
- 版本控制遵循语义化版本：
  - MAJOR: 原则删除或根本性重新定义
  - MINOR: 新增原则或重大扩展
  - PATCH: 措辞澄清、格式修正

### 合规检查

- 每次 PR/代码审查 MUST 验证是否符合核心原则
- 复杂性超出原则约束时 MUST 在 plan.md 中记录理由
- 使用 `.specify/templates/plan-template.md` 中的 Constitution Check 进行验证

**Version**: 1.0.0 | **Ratified**: 2026-01-26 | **Last Amended**: 2026-01-26
