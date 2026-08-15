# Chorus UI 状态矩阵

| 区域 | 必须覆盖的状态 | 恢复动作 |
|---|---|---|
| 应用启动 | booting、ready、storage error、server unavailable、offline | 重试、打开诊断 |
| Onboarding | scanning、multiple found、needs auth、none found、adopting、success、error | 重扫、打开登录指引、手动添加 |
| Agent | online、checking、busy、offline、needs auth、stale、disabled、installing、install error | 健康检查、登录、重新检测、编辑 |
| 会话列表 | loading、empty、results、no search result、archived、load error | 新建、清除搜索、重试 |
| 消息 | sending、queued、delivered、thinking、streaming、partial、stopped、done、denied、timeout、error | 停止、重试、复制错误、切换 Agent |
| A2A | off、mention、call、waiting confirm、running、round limit、call timeout、task timeout、depth limit、cancelled、done、error | 修改模式、修改轮次/单次调用超时、允许/拒绝、缩小任务后重试 |
| Relay | not configured、saving、connecting、connected、reconnecting、disconnected、error | 配置、重试、诊断 |
| P2P | disabled、discovering、discovered、awaiting approval、connecting、connected、rejected、error | 开启、批准/拒绝、重试 |
| 配对 | idle、creating、code ready、waiting peer、verifying、trusted、expired、invalid、cancelled | 复制配对包、重新生成、取消 |
| Room 邀请 | pending、accepted、declined、expired、revoked | 接受、拒绝、重新邀请 |
| Room 成员 | loading、empty、active、offline、removing、permission denied、error | 添加自己的 Agent、重试、查看权限原因 |
| 设置 | pristine、dirty、saving、saved、validation error、storage error、connection result | 保存、撤销、重试 |
| 危险操作 | confirmation、pending、success、partial failure、failed | 默认取消、重试、导出诊断 |

## 通用交互约束

- 弹窗初始焦点落在安全动作，Tab 不逃逸，Escape 关闭，关闭后焦点返回触发器。
- 错误使用 `role="alert"`；异步成功使用非打断式状态或 Toast。
- 禁用控件必须有可见或可访问的原因。
- 状态不能只依赖颜色；必须同时有图标或文字。
- 任何取消/中断不得显示为完成。
- “已连接”只用于实时连接成功，“已保存”不等于“已连接”。
