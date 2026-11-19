# BoostAPI 生产升级与卡密充值操作手册

更新日期：2026-11-19（Asia/Shanghai）。

适用项目：`/Users/happy/Projects/api/sub2api`。  
第 1 节记录生产基线；后续更新按日期追加在文末，待发布的候选版本不计入生产状态。

## 1. 当前生产状态与入口

| 项目 | 当前值 |
| --- | --- |
| 站点 | `https://boostapi.top` |
| 应用版本 | `0.2.18-boostapi.3` |
| 发布标签 | `boostapi-v0.2.18-r3` |
| 对应提交 | `21de46a983e6e1da58ca5999f00cfa00d0c4daa5` |
| 生产镜像 | `ghcr.io/shanyu1314/sub2api:boostapi-v0.2.18-r3` |
| 工作分支 | `boostapi/card-recharge-fixes` |
| GitHub 仓库 | `Shanyu1314/sub2api` |
| 服务器 | `107.172.79.109`，本机 SSH 别名 `3cpu4g` |
| 服务器规格 | 3 CPU / 4 GB 内存，发布时不进行生产编译 |
| 数据目录 | `/opt/sub2api` |
| 服务 | `sub2api` 应用、`sub2api-postgres`、`sub2api-redis` |
| 部署脚本 | `/usr/local/sbin/boostapi-deploy` |
| Nginx 配置 | `/etc/nginx/sites-enabled/boostapi.top` |

用户功能分为两个独立入口：

- **充值** `/recharge`：显示账户、余额、充值说明和「点击购买卡密」，链接到 `https://wzyp.cn/shop/CCZ33PW7`；提供「已有卡密，前往兑换」。
- **兑换** `/redeem`：输入卡密兑换，显示余额/并发及兑换历史。
- 管理员的「兑换码」`/admin/redeem` 用于生成、查询、导出卡密，不是用户充值页面。

这两个用户入口不受在线支付开关 `payment_enabled` 影响。当前没有接入支付宝、微信或店铺订单回调，用户在店铺付款后需要复制卡密并回到兑换页操作。

## 2. 本次升级内容

### 应用功能

1. 新增 `frontend/src/views/user/RechargeView.vue`，作为独立的充值说明页。
2. `frontend/src/router/index.ts` 增加 `/recharge` 认证路由，不增加 `requiresPayment`。
3. `frontend/src/components/layout/AppSidebar.vue` 同时显示「充值」和「兑换」，普通用户和管理员个人区共用。
4. `frontend/src/i18n/locales/zh/dashboard.ts`、`en/dashboard.ts` 增加 `rechargeGuide` 文案。
5. 保留既有 `/redeem` 兑换、错误分类、余额刷新、历史记录功能；没有修改兑换记账逻辑。
6. 保留模型操练场、客户端配置、图片适配器等已有定制功能。
7. 店铺地址使用公共设置 `payment_card_shop_url`，后台持久化键为 `PAYMENT_CARD_SHOP_URL`，默认店铺即上面的地址；前端使用专用 HTTPS URL 校验。

### 发布与回滚

- 工作流：`.github/workflows/boostapi-release.yml`。
- 推送 `boostapi/**` 分支：运行验证并构建 `boostapi-<提交前9位>` 镜像，不部署。
- 推送 `boostapi-v*` 标签：重新验证、构建 `linux/amd64` 镜像，自动部署生产并做公网健康检查。
- 部署脚本：`deploy/boostapi/deploy.sh`，服务器安装路径 `/usr/local/sbin/boostapi-deploy`。
- 服务器只拉取镜像并重建应用容器；PostgreSQL 和 Redis 不随发布重启。
- 每次部署覆盖更新一份备份：`/opt/sub2api/backups/predeploy-latest/db.sql.gz`，当前约 78 MB。
- 仅清理本项目未被当前版、上一版或其他容器使用的旧镜像；不执行全局 `docker image prune`，不碰其他业务、数据库或卷。
- 拉取或备份失败不切换；应用重建/健康检查失败尝试回退镜像。即使回退成功，本次发布仍报告失败。

## 3. 这次最重要的故障：容器新版本，网页旧版本

### 现象

侧边栏版本号已经是 `v0.2.18-boostapi.2`，但个人区没有「充值」。服务器容器健康、公共设置也正常。

### 实际根因

Nginx 没有将前端请求交给应用容器，而是直接读取旧目录：

```nginx
location ^~ /assets/ {
    root /opt/sub2api/frontend-dist;
    # ...
}
location / {
    root /opt/sub2api/frontend-dist;
    try_files $uri $uri/ /index.html;
}
```

新前端已嵌入新的应用镜像，但这个旧目录没有更新。此外，`sites-enabled/` 中旧备份 `boostapi.top.bak.20260804_173223` 也会被 Nginx 加载，产生重复 `server_name`。所以此前只检查容器健康和版本号并不足以证明用户拿到了新页面。

### 已实施的修复

- 将 `location /` 改为 `proxy_pass http://127.0.0.1:8080;`，由运行中的应用统一提供内嵌前端、公共设置注入和静态资源缓存头。
- 将旧备份移出 `sites-enabled/`，放到 `/etc/nginx/sites-available/boostapi.top.bak.20260804_173223`。
- API、图像接口、`fuck.boostapi.top` 专用 API 域名及其他项目配置未改动。
- 2026-10-25 公网已确认加载 `/assets/index-BsPpbl_U.js`，其懒加载侧边栏资源含 `/recharge` 和 `nav.recharge`；2026-10-28 再核实仍是此脚本且应用健康。

仓库中的 `deploy/boostapi/nginx-boostapi.top.conf` 是当时的生产 Nginx 配置记录。**SSL 指令依赖服务器已有证书路径；新服务器不能直接复制后启动。** 恢复/迁移前检查证书、上游端口、域名和其他站点配置。

## 4. 日常检查：确认用户实际拿到的版本

在本机终端执行：

```bash
cd /Users/happy/Projects/api/sub2api
ssh 3cpu4g 'docker inspect sub2api --format "{{.Config.Image}} {{.Image}} {{.State.Health.Status}}"'
curl -fsS https://boostapi.top/health
curl -fsS https://boostapi.top/api/v1/settings/public
```

公共设置只应公开站点配置，确认其中 `version` 和 `payment_card_shop_url` 正确，不要在聊天记录中粘贴任何 `.env`、数据库密码、SSH 私钥、访问令牌或真实卡密。

检查公网 HTML 引用的主脚本：

```bash
curl -fsS https://boostapi.top/ | \
  python3 -c 'import sys,re; print(re.findall(r"<script[^>]+src=\"([^\"]+)\"",sys.stdin.read()))'
```

检查服务器源站 HTML 引用的主脚本：

```bash
ssh 3cpu4g 'curl -fsS http://127.0.0.1:8080/ | \
  python3 -c '\''import sys,re; print(re.findall(r"<script[^>]+src=\"([^\"]+)\"",sys.stdin.read()))'\'''
```

如果公网与源站主脚本名称不同，先检查 Nginx/CDN/旧静态目录，不要只让用户刷新。静态 JS 使用内容摘要命名，HTML 必须获得新的脚本引用。

检查实际侧边栏资源是否含充值菜单（用实际 `AppLayout...js` 文件名替换路径）：

```bash
ssh 3cpu4g 'curl -fsS http://127.0.0.1:8080/assets/AppLayout.vue_vue_type_script_setup_true_lang-C4M9nagP.js' \
  | python3 -c 'import sys; s=sys.stdin.read(); print({k:s.count(k) for k in ["nav.recharge", "/recharge", "nav.redeem"]})'
```

期望 `nav.recharge`、`/recharge`、`nav.redeem` 均存在。该检查只验证产物；仍需在普通用户和管理员账号的「我的账户」菜单中点击验收。

资源和备份检查：

```bash
ssh 3cpu4g 'free -m; df -h /; docker stats --no-stream sub2api; du -h /opt/sub2api/backups/predeploy-latest/db.sql.gz'
ssh 3cpu4g 'docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -E "^(sub2api-boostapi|ghcr.io/shanyu1314/sub2api):"'
```

## 5. 标准发布流程

### 发布前

1. 在正确仓库与定制分支工作，检查 `git status`、`git log` 和远程差异，不覆盖其他人的未提交工作。
2. `.workbuddy/`、`.playwright-cli/`、生产源码压缩包、`.env`、私钥、真实卡密不要提交。
3. 阅读目标版本的新数据库迁移。若涉及删除、清洗或重建数据，先单独评估和做可恢复性验证；不能默认上游迁移无风险。
4. 运行与改动相符的测试。前端小改动至少执行类型检查、相关组件/路由/i18n 测试；部署脚本执行 `bash deploy/tests/boostapi-deploy-test.sh`。
5. 使用 Playwright 验证充值/兑换菜单、购买链接和手机视口。仅 mock 的浏览器验收不能替代真实卡密兑换测试。
6. 发布前检查生产健康、磁盘、可用内存和正在运行的镜像。低资源服务器不执行本地生产编译。

### 推送和候选构建

```bash
cd /Users/happy/Projects/api/sub2api
git push fork boostapi/card-recharge-fixes
gh run list -R Shanyu1314/sub2api --branch boostapi/card-recharge-fixes --limit 5
```

确认 CI、Security Scan、BoostAPI Release 均成功，Release 的 `deploy` 应为 skipped。核对 run 的 `headSha` 等于准备发布的提交。

### 标签自动发布

版本标签示例：`boostapi-v0.2.18-r2` → 应用版本 `0.2.18-boostapi.2`。将 `N` 换成下一个未使用编号，不能移动或复用已发布标签。

```bash
git tag boostapi-v0.2.18-rN <已审核提交SHA>
git push fork refs/tags/boostapi-v0.2.18-rN
gh run list -R Shanyu1314/sub2api --workflow boostapi-release.yml --limit 3
```

标签流水线完成 `verify → build → deploy → Public health check` 后，继续执行第 4 节的公网与源站产物核验。

### 部署脚本同步

脚本只在发生修改时更新，先通过本地隔离测试：

```bash
bash deploy/tests/boostapi-deploy-test.sh
ssh 3cpu4g 'umask 077; cat > /usr/local/sbin/boostapi-deploy.new; bash -n /usr/local/sbin/boostapi-deploy.new && chmod 755 /usr/local/sbin/boostapi-deploy.new && mv /usr/local/sbin/boostapi-deploy.new /usr/local/sbin/boostapi-deploy && sha256sum /usr/local/sbin/boostapi-deploy' < deploy/boostapi/deploy.sh
shasum -a 256 deploy/boostapi/deploy.sh
```

两个 SHA256 必须一致。部署密钥只能执行受限脚本，不能用于任意 SSH 命令；服务器脚本维护使用本机 `3cpu4g` 管理密钥。私钥保存在本机 SSH 目录，绝不写入手册或 Git。

### 紧急手动部署

只有自动部署不可用且镜像已通过相同源码验证时使用：

```bash
ssh -i ~/.ssh/sub2api_github_deploy -o IdentitiesOnly=yes root@107.172.79.109 \
  ghcr.io/shanyu1314/sub2api:boostapi-已验证标签
```

镜像名只接受本项目 GHCR 地址；不要随意修改 SSH 强制命令限制。

## 6. 回滚和故障处理

### 应用回滚

读取上一版镜像：

```bash
ssh 3cpu4g 'cat /opt/sub2api/backups/predeploy-latest/previous-image.txt'
```

使用受限部署命令重新部署上一版镜像。成功后核对运行镜像、健康接口、公网脚本和功能。**镜像回退不等于数据库回退**：若新版已执行数据库迁移，先检查迁移兼容性；数据变更需要按备份恢复方案处理，不能假设旧二进制能还原数据。

### Nginx 前端旧版排查

```bash
ssh 3cpu4g 'nginx -T 2>&1 | grep -nE "server_name boostapi.top|frontend-dist|conflicting server name"'
ssh 3cpu4g 'nginx -t'
```

当前生产前端应由 `location /` 代理到 `127.0.0.1:8080`。不要恢复 `root /opt/sub2api/frontend-dist` 的旧方式，也不要把 `.bak` 文件放回 `sites-enabled/`。

修改前将当前配置暂存到 `/tmp` 或已版本控制的本地文件，修改后先 `nginx -t`，成功才 `nginx -s reload`。其他域名/API 不随前端修复修改。

### 常用日志

```bash
ssh 3cpu4g 'docker logs --tail 100 sub2api'
ssh 3cpu4g 'nginx -t; tail -n 80 /var/log/nginx/error.log'
```

日志可能含账户、请求或敏感配置，分享前先脱敏。

## 7. 卡密生成、店铺销售和兑换

1. 管理员打开「兑换码」`/admin/redeem`，点击「生成兑换码」。
2. 余额充值选择 `balance`，输入要入账的数值；按需要设置数量和过期时间。其他类型（并发、订阅等）不是普通余额充值，不要混用。
3. 在后台筛选刚生成的未使用卡密，点击「导出 CSV」。导出会应用当前筛选条件，先确认类型、状态和搜索条件，避免混入历史或其他面额卡密。
4. 将这些字符串导入店铺 `https://wzyp.cn/shop/CCZ33PW7` 对应商品的自动发货库存。店铺库存必须与 Sub2API 已生成且有效的卡密完全一致。
5. 不要重复使用卡密，不要把未出售库存导出文件公开或提交 Git。已发卡密和导出文件按敏感凭据保管。
6. 用户从「充值」点击购买，付款后复制店铺卡密，回到「兑换」输入并确认；兑换成功后余额和历史应更新。
7. 无效、已使用、过期或限流会显示明确错误；断网/超时提示结果未知时，先查余额和历史，不要立即重复提交。

当前未接店铺库存同步、订单回调或自动到账。店铺管理配置和库存是否正确，需要另行在店铺后台检查。

首次正式销售建议用专门测试商品/测试卡密，验证「生成 → 导入 → 购买发货 → 用户兑换 → 重复兑换被拒绝」完整链路；不要使用真实用户余额做试验。

## 8. 店铺地址与在线支付设置

- 后台「系统设置 → 支付」中的 `payment_card_shop_url` 管理购买入口。
- 留空使用默认店铺 `https://wzyp.cn/shop/CCZ33PW7`，不是关闭购买。
- 自定义地址必须是有效的绝对 HTTPS URL；不要包含用户名/密码。
- 在线支付 `payment_enabled` 可以关闭，充值和兑换仍应可用；`/purchase` 与 `/orders` 继续受在线支付开关控制。
- 修改店铺地址后刷新用户页面，核对公共设置和实际链接。

## 9. 本地验收材料与文档

- 充值说明页截图：`output/playwright/recharge-guide-desktop.png`、`recharge-guide-mobile.png`。
- 兑换页截图：`output/playwright/card-recharge-desktop.png`、`card-recharge-mobile.png`。
- 截图使用模拟测试用户和 API，不是生产账户信息，也不是生产真实充值证明。
- 初次设计：`docs/CARD_RECHARGE_IMPLEMENTATION_PLAN.md`。
- 实施审核：`docs/CARD_RECHARGE_REVIEW_FIX_PROMPT.md`。
- 第一次发布记录：`docs/CARD_RECHARGE_DEPLOYMENT_REVIEW_20261025.md`。

注意：早期文档中把购买和兑换集中在 `/redeem` 是历史方案；最终用户要求并上线的是独立 `/recharge` 加 `/redeem`。第一次发布记录里的生产镜像和版本也是历史快照，当前状态以本手册第 1 节和实际服务器检查为准。

## 10. 后续维护约定

- 上游升级前保留已有定制提交和功能清单，逐条检查模型操练场、客户端配置、图片适配器、充值/兑换。
- 生产源码压缩包不等于正在运行版本的精确源码；以 Git 提交、发布标签和镜像摘要为准。
- 发布产物不可只看版本号或 `healthy`，必须检查公网实际前端脚本和关键用户路径。
- 不在服务器保留多份源码、前端 dist 或冗余镜像。部署脚本保留当前版本及上一版；本次分别为 `boostapi-v0.2.18-r3` 和 `boostapi-v0.2.18-r2`。
- 不在生产环境跑编译、压力测试、充值测试或部署失败演练。
- 生产有任何配置或迁移变化，更新本手册的日期、版本、命令和验收边界。

## 11. 2026-11-19 更新：星空首页与登录页

**发布状态：** 星空首页已在公网验收。星空登录页是候选改动 `a6477ad09`（分支 `boostapi/card-recharge-fixes`），本地验证通过，尚未部署。记录时公网应用版本仍为 `0.2.18-boostapi.2`；拟沿用标签 `boostapi-v0.2.18-r3`，未创建标签。本次不合并上游版本，也不含数据库迁移。

- **首页配置：** 后台「首页内容」替换整个 `/home`，不会修改 `/login`。星空模板中嵌入的 Logo 不随站点 Logo 自动更新。带 Logo 的星空、标语及控制台跳转已在生产验收；后来加入登录、注册入口的模板已在本地生成，不将它记作已发布。
- **登录页代码：** 仅 `LoginView.vue` 启用 `AuthLayout.vue` 的 `starfield` 样式，背景资源为 `frontend/src/assets/login-starfield.webp`。站点 Logo 来自公共设置；副标题为空、为系统默认值或为原拉丁文时显示拉丁文与中文译句，其他自定义副标题原样显示，不附上不匹配的译文。注册、找回密码、验证码和登录处理逻辑未修改。
- **本地验收：** 前端生产构建通过；`make test-frontend` 的 lint、类型检查及 35 个测试文件（663 项）通过。Ego Lite 检查登录页桌面及 390×844 手机视口，注册页未启用星空。截图在 `output/starfield/登录桌面.png` 和 `output/starfield/登录手机.png`（本地材料，不随仓库分发）。未提交真实账号密码，不视为端到端鉴权验收。
- **发布阻塞：** 候选分支推送成功，但该提交无 Actions 运行记录；手动触发 `deploy=false` 返回 HTTP 422，提示仓库 Actions 已禁用。Actions 页面说明该 fork 因 Actions 使用规模暂停运行，需要仓库维护者重新启用。仅看工作流的 `active` 字段不能确认可运行。
- **交接：** 维护者登录 GitHub，在本仓库 Actions 页重新启用工作流。按第 5 节让候选分支触发检查，核对同一 SHA 的 CI、Security Scan、候选镜像构建均成功，再确认下一个标签可用并发布。发布后追加实际 SHA、Actions run、镜像摘要、公网版本，以及未登录会话下 `/login` 的桌面和手机验收结果；之后再更新第 1 节。

### 续记：Actions 恢复与候选安全修复

维护者已重新启用该 fork 的 Actions。原候选 `d7175a001` 的 [安全扫描](https://github.com/Shanyu1314/sub2api/actions/runs/44488952033) 拦截了已有依赖问题，未对该提交打标签。修复提交 `21de46a98` 仅回移上游安全补丁和构建适配：Go 1.27.4、brotli 1.2.7、compress 1.20.2、x/net 0.62.0，以及 vue-i18n 11.4.16、decode-uri-component 0.5.1、follow-redirects 1.16.2。未放宽扫描规则、新增豁免或合并上游业务变更。

该提交的[前后端安全扫描](https://github.com/Shanyu1314/sub2api/actions/runs/44489903714)均通过。其余候选门禁按同一 SHA 核对：[CI](https://github.com/Shanyu1314/sub2api/actions/runs/44489903713)、[候选镜像构建](https://github.com/Shanyu1314/sub2api/actions/runs/44489903708)。发布前源站检查：r2 容器健康，根分区可用 51 GB。

### 正式上线与验收

- **生产切换：** 2026-11-19 17:15:48（北京时间），`r2` → `r3`。[正式发布](https://github.com/Shanyu1314/sub2api/actions/runs/44492009154)的 verify、build、deploy 全部成功。部署日志确认数据库备份约 80 MB，第一次公网健康检查即 HTTP 200。正式镜像摘要为 `sha256:e488adf4790760629bdeaafb8f2aaae3d4c4e4b4bcabb1ffac6a2143d3809007`；回滚镜像标签为 `boostapi-v0.2.18-r2`。
- **质量检查：** 同一 SHA 的候选 CI、安全扫描和候选镜像构建全部通过（候选 deploy 按设计跳过）。[标签安全扫描](https://github.com/Shanyu1314/sub2api/actions/runs/44492009189)通过；[标签独立 CI](https://github.com/Shanyu1314/sub2api/actions/runs/44492009252)首次执行的 macOS `shell` 作业未分配到运行器并被取消；单独重跑后通过，标签 CI 最终结果为 success，未重复部署。
- **公网验收：** 公共设置返回 `0.2.18-boostapi.3`，`/health` 返回 `ok`。Ego Lite 在未登录状态下以 900×634 和 390×844 检查 `/login`，确认实际 1440×900 星空资源和站点 Logo 成功解码、拉丁文及中文译句可见、邮箱密码表单和注册入口存在，两种视口均无横向溢出。点注册到达 `/register`，保留原注册布局。未提交真实凭据。本地截图为 `output/starfield/r3-线上登录桌面.png` 和 `output/starfield/r3-线上登录手机.png`。
