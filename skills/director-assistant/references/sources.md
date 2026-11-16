# 依据与适用范围

用于维护和查证，不在日常出稿时默认加载。CG 基础整理：2026-10-14；面部与光影修订：2026-10-17；特效升级整合：2026-10-18。特效专项的一手来源、阅读范围和提示词推导见 [vfx-sources.md](vfx-sources.md)。旧有通用剪辑来源保留其依据用途。规则是面向生成视频的导演/美术应用；下列来源不构成 H3 能力、帧级准确性或生成质量保证。

## 面部与光影修订的依据和边界

- 本轮针对用户报告的腮红过重、说话/表情转为真人观感修订，未提供可供本轮逐帧查看的成片。底色/妆容/受光分离、普通对白局部 CG 锚是本技能的修正策略，不能把失败归因于单个词，或宣称已经过视频生成对照验证。
- [Midjourney 官方：Style Reference](https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference) 将色彩、媒介、纹理和光照列为可参考的风格属性。此处仅支持分开描述光影属性的做法；不证明 H3 具备相同功能。本技能按用户要求只取光影，并用可见文字表达，不迁移 MJ 参数或真人角色材质。
- 无样图时的方向主光、柔和过渡、可读暗部、平顺高光与空间分离，是为本用户偏好选定的美术默认，不是 MJ 官方唯一风格或 FF7RE 官方灯光配方。有指定样图时以该图与用户要求为准。
- 本轮复核下列 CGWORLD 第 1、3 篇：前者描述面部变形与法线/细纹修正的配合，后者描述为世界观和演出调整灯光。本技能据此保留合理表情形变、年龄细节与美术化布光，不将“防真人化”误写为零皱纹、冻脸或取消光色变化。

## 本次加强的依据：事实与提示词推导分开

| 一手来源 | 资料明确支持的制作事实 | 本技能采用的视觉推导与边界 |
|---|---|---|
| [Epic：FFVII REMAKE 开发者访谈](https://www.unrealengine.com/developer-interviews/how-square-enix-leveraged-unreal-engine-to-modernize-final-fantasy-vii-remake?lang=en-US) | 角色目标并非完全照片写实；Bonamik 以 PBD 为核心处理角色衣发/软体，强调电影动作可控性；过场另做布光 | CG 身份与设计优先，衣发写锚点、滞后、碰撞和落定；不能声称视频模型会运行 Bonamik |
| [CGWORLD：开发团队访谈，第 1 篇](https://cgworld.jp/feature/202012-ffvll-01.html) | 发型使用板片、透明/法线贴图与 bent normal；皮肤、眼、发、布采用不同着色模型；面部变形配合法线与细纹修正 | 写主发束与细丝层次、不同材料响应、随表情变化的体积/褶皱；不虚构逐根解算、全脸解剖肌肉仿真或 UE5 管线 |
| [CGWORLD：开发团队访谈，第 2 篇](https://cgworld.jp/feature/202012-ffvll-02.html) | 保留角色性和原作夸张；激烈动作可从动捕大量手调至近乎全关键帧；复杂衣发接触可混合手工动画 | 明确动作幅度、关键姿态、发力与收势，不用统一真人幅度；碰撞和轮廓必须同时成立，不把“完全物理”当唯一审美 |
| [CGWORLD：开发团队访谈，第 3 篇，灯光部分](https://cgworld.jp/feature/202012-ffvll-03.html) | 照搬现实灯光不一定适合 FFVII；场所保留多色灯特点，过场按镜管理演出灯与后期 | 允许动机明确的美术化补光和戏剧塑形，保持世界光源连续；不强制每镜三灯、青橙调色或恒定轮廓光 |
| [Adobe：角色/环境材质团队访谈](https://blog.adobe.com/en/publish/2020/09/17/discover-substance-3d-workflow-for-square-enix-final-fantasy-vii-remake) | 强调设计和 PBR 的共同作用；角色皮肤有毛孔；材质、模型与灯光协同 | 保留细微纹理并控制尺度，不能“零毛孔”磨成塑料，也不能用粗糙真人纹理替代 CG 设计 |
| [CEDEC 2020 官方：角色动画技术](https://cedec.cesa.or.jp/2020/session/detail/s5e58c8811bc98.html) | 介绍动画分层、程序化处理；面部包括语音口型、情感与自然视线 | 提示词写眼睑/眼球、唇颌与表情的可见协调；简介不提供通用肌肉参数，不能据此编造 |
| [ScreenSkills：场记职责](https://www.screenskills.com/job-profiles/browse/film-and-tv-drama/technical/script-supervisor-film-and-tv-drama/) | 制作前分解人物、动作、服装、道具与故事日，拍摄中监测动作、视线和连续性 | 采用固定场景关系、逐镜初末态和逐切点核对；这是提示词工作流设计，不是 H3 官方协议 |

上述来源的“物理可信”与“艺术控制”并存。`cg-look.md` 的 12 项约束及 `continuity-ledger.md` 的状态交接是本技能据此制定的应用规则，不是原作团队公布的生成提示模板。作品名和引擎名不能代替可见描述，也不能保证完美复刻。

此前“加强至少一倍”的要求落实为相较原有概括性指导的**全局约束 + 风险镜局部约束**双层写入，以及独立的 CG/表演与切点/空间验收；本次特效升级再加入独立特效质感一轮。12 项 CG 覆盖用于查缺，不是效果提升倍数。没有同条件生成对照时，不报告“成功率翻倍”或“已完全一致”。

## 版本补充与场面设计

- [Epic：INTERGRADE 渲染团队访谈](https://www.unrealengine.com/developer-interviews/how-square-enix-impressively-optimized-final-fantasy-vii-remake-intergrade-for-next-gen?lang=en-gb)：灯光、反射、阴影、雾及画面稳定性改进。用于支持切镜间光影/材质稳定的目标，不把该版本技术等同原版全部流程。
- [Square Enix：Revisited 第 12 章](https://www.square-enix-games.com/en_GB/news/final-fantasy-vii-remake-revisited-chapter-12)：从分镜与预演调整场面、镜头运动、切镜和节奏。支持以剧情危机驱动视觉强度，而非固定快切配额。

## 剪辑与连续性

- [Adobe：180°规则，含导演/摄影师访谈](https://www.adobe.com/uk/creativecloud/video/discover/what-is-the-180-degree-rule.html)：同轴同侧机位维持空间关系，有意破坏需要目的。本技能依据用户偏好进一步限定为“用户明确要求时才设计连续性破坏”，不是宣称电影永远不能越轴。
- [Adobe 官方：J-cut 与 L-cut](https://helpx.adobe.com/premiere/desktop/edit-projects/trim-clips/perform-j-cuts-and-l-cuts.html)：下镜声音先入为 J，上镜声音延续为 L。用于声画切点时序，不能只贴术语。
- [BFI：爱森斯坦与蒙太奇](https://www.bfi.org.uk/features/where-begin-sergei-eisenstein)：镜头并置可以产生单镜没有的意义，介绍不同蒙太奇组织方式。用于观念/节奏层面；不是每次切镜须具备全部类型的依据。

理论命名会因教材传统略异；实际验收以观众能读懂的时空、因果、声画和语义关系为准。30°参考、节奏策略与各题材示例是实践指导，不是成功率公式。遇到具体技术/物理不确定性时只查对应问题，避免把资料扩写成教科书。

## 真人电影档与 FACS 微表情控制的理论及摄影依据（2026-11 升级）

| 领域与核心来源 | 资料明确支持的机制与事实 | 本技能转化为真人电影档的硬性规则 |
|---|---|---|
| [Paul Ekman：Facial Action Coding System (FACS)](https://www.paulekman.com/facial-action-coding-system/) 及 [PMC 解剖分类研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC3008166/) | 面部表情由 46 个独立动作单元（AUs）及 A–E 五级强度构成；AU10（上唇提肌）、AU11（鼻唇沟加深肌）、AU12（颧大肌）的强收缩直接加深鼻唇沟（法令纹）；真笑（Duchenne smile）依赖眼轮匝肌（AU6）与极轻口角联动而非单纯拉扯嘴角 | **阻断法令纹与防用力过猛：** 真人特写将 AU 强度锁在 A–B 级（Trace/Slight）；通过抑制中下脸 AU10/AU11/AU12/AU20 的剧烈拉扯，从解剖学根源消除 AI 动态深法令纹，将 70% 情绪交给眼睑微张力（AU5/AU7）、视线焦点与呼吸 |
| [ARRI Alexa 35 REVEAL Color Science & Textures](https://www.arri.com/resource/blob/277388/bf133c4a8673934c385a8afbb830acf4/2024-01-arri-textures-data.pdf) | 院线数字摄影机（如 K445 Default / L345 Shadow）通过极宽动态范围、对数高光柔和压缩滚降（smooth highlight roll-off）与去饱和暗部颗粒，实现宽容、温润且不油腻的自然肤色还原 | **去油腻、去高对比高饱和：** 提示词强制锁定 `smooth logarithmic highlight roll-off`、`natural matte skin finish with zero oily sheen`、`soft low-to-medium filmic contrast` 与 `restrained desaturated cinema color palette` |
