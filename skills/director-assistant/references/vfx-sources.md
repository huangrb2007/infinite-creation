# 特效升级：依据、转译与适用范围

检索核验：2026-10-17；整合验收：2026-10-18。用于技能维护，日常出稿不必加载。研究横跨电影制作方、制作者访谈、3A 开发团队和官方技术文档；不是穷尽互联网，也不是对全部影片/游戏逐帧分析。只使用实际读到的网页/摘要，未观看的嵌入视频、未取得的完整论文不算已通读。

用户报告气流、粒子、能量束、物理破坏等观感廉价，本轮未提供成片。因而不能确定某个单词或单一模块就是实际失败原因。新增 vfx-design.md、vfx-families.md 和质量闸是根据资料与用户偏好形成的导演规则；文本试写与结构校验不等于已验证 H3 成片提升。

## 电影制作：确证事实与采用方向

| 一手来源与阅读范围 | 资料明确支持的内容 | 本技能的应用推导 |
|---|---|---|
| [ACM SIGGRAPH：The Special and Visual Effects Behind Twisters](https://blog.siggraph.org/2024/12/the-special-and-visual-effects-behind-twisters.html/)；ILM 制作者问答正文，2024-12-20 | 龙卷由漏斗、尘幕、地表尘土/碎片和云层等组合；动画与连续性、美术控制及尺度/速度约束共同工作，云/大气散射参与照明 | 气流以适用介质和环境响应显形，主形与次级运动共同保持方向/尺度；不强制每镜具备全部风暴组件 |
| [DNEG：Return to Arrakis — Dune: Part Two](https://www.dneg.com/news/return-to-arrakis-for-a-closer-look-at-our-work-on-dune-part-two)；官方正文，2025-01-24 | 沙虫尾迹表达巨大尺度；脚步扬尘与大沙流接续；飞行器爆炸、残骸坠地和后续火/沙冲击相继组织 | 地标与环境痕迹共同说明尺度；一次爆发可产生跨镜发展的后续接触，不用所有层同帧结束 |
| [DNEG：Anatomy of a Shot — The Gorge: Building the Blast](https://www.dneg.com/news/anatomy-of-a-shot-or-the-gorge-building-the-blast)；FX 负责人制作说明正文，2025-04-15 | 参考实拍爆炸后为银幕阅读调整曝光；尘土、树木受压、阴影与环境高光使冲击嵌入场景 | 将强度写成传播、局部光照和环境响应，保留高亮峰值与可读性；电影美术选择不当作严格物理定律 |
| [Framestore：Project Power](https://www.framestore.com/work/project-power)；官方案例正文 | 火焰角色的闪动光照影响沿途墙面/对手；使用真实燃烧参考；冲击背景扭曲、烟汽后果和冰晶成长均参与效果 | 特效光跟随源点与遮挡，热扰动局部化；冰/烟有表面或空间依附，光色不改变角色固有肤色 |
| [Framestore：Thor: Ragnarok](https://www.framestore.com/work/thor-ragnarok)；官方案例正文 | 水体规模与角色动作可见性需要平衡；巨型火焰细节与尺度匹配；雷电参考实际放电并调整运动 | 大场面保留表演和接触窗口；巨物不一律慢放；分层水体与电弧形状服务当前镜头 |
| [Framestore：Doctor Strange](https://www.framestore.com/work/doctor-strange)；官方案例正文 | 早期长曝光式火花/弯曲耀斑过于虚幻，团队逐步缩短火花并逐镜调节；灵体利用背光和负空间获得对比 | 火花长短、强度、疏密与寿命受控；透明度、暗部与留白也提供能量效果的结构，不能只追求更密更长 |
| [Wētā 作者：Pahi — A Unified Water Pipeline and Toolset](https://alexey.stomakhin.com/research/pahi.html)；作者网页与可见论文摘要，DigiPro 2023，未通读完整 PDF | 覆盖主体水体、飞沫、水雾、泡沫、气泡、涟漪、薄膜和滴流，整合不同现象而非单一方法包办 | 先有连续水量，再按接触/流动组织适用次级层；只据摘要采用覆盖范围，不编造内部算法或参数 |

## 3A 游戏：确证事实与采用方向

| 一手来源与阅读范围 | 资料明确支持的内容 | 本技能的应用推导 |
|---|---|---|
| [Blizzard：Diablo IV Quarterly Update — December 2021](https://news.blizzard.com/en-us/article/23746639/diablo-iv-quarterly-updatedecember-2021)；VFX 主管章节全文 | 主次阅读与视觉强度分配；命中位置/受力方向对应动画；特效接受环境光并用发光辅助阅读；放大技能不统一等比放大所有层 | 主形、局部运动、微粒分别承担职责；强度有峰值，威力增长可调整范围/运动/密度等不同维度，保留接触证据 |
| [PlayStation / Sucker Punch：How stunning visual effects bring Ghost of Tsushima to life](https://blog.playstation.com/?p=345372)；VFX 主管正文 | 风统一影响烟、火星、植被、布与绳；人物扰动草叶，草阻尼回弹，叶片可落地/落水；强调风格化运动美感 | 同一风场下不同材料有不同响应；允许美术夸张，环境不能各按互不相关的方向和节奏运行 |
| [EA / DICE / Frostbite：How Battlefield 6 reimagines destruction](https://www.ea.com/en-gb/amp/news/how-battlefield-6-redefined-destruction)；官方正文，2025-11-10 | 系统性破坏与控制并存；残骸改变空间，裂缝/表面效果按冲击与碎块状态触发，按视觉材质选效果并同步声音 | 接触点、材料、结构失效和后续残骸分开设计；下一镜继承场地变化，声画来自同一事件 |
| [Naughty Dog at GDC 2012](https://www.naughtydog.com/blog/naughty_dog_at_gdc_2012)；官方讲座介绍正文，未观看全部讲座 | 烟的翻卷/自遮阴、建筑内火焰深度、沙粒环境交互、主体洪水表面与补充粒子、粒子照明分别解决 | 主体介质与体积先成立，细粒补材质；成熟质量来自组织与照明，不取决于在提示词里点名新引擎 |
| [PlayStation / Square Enix：How Final Fantasy XVI harnesses PS5's power](https://blog.playstation.com/2023/03/30/ps5-creators-how-final-fantasy-xvi-harnesses-ps5s-power/)；主导演访谈正文 | 角色、环境、灯光/阴影共同提升精度；涵盖高速战斗和大型召唤兽场面 | 大技能与角色/场景保持质量和尺度一致；该文不支持任何特定技能的模拟配方，也不要求替换 FF7RE 人物设计 |

补充边界资料：

- [Guerrilla：The Real-Time Volumetric Cloudscapes of Horizon Zero Dawn](https://www.guerrilla-games.com/read/the-real-time-volumetric-cloudscapes-of-horizon-zero-dawn)、[Nubis, Evolved](https://www.guerrilla-games.com/read/nubis-evolved)：本轮网页打开超时，采用搜索可见的官方摘要，仅支持云的形态、演化、光照协同以及近距离可穿行云/内部闪光的设计问题；不声称通读讲义。
- [GDC / Remedy：Destructible Environments in Control](https://gdcvault.com/play/1030643/Destructible-Environments-in-Control-Lessons)：只读课程页摘要，支持“超自然但有现实基础的风格及制作取舍”；未观看完整讲座，不将具体破坏算法归给 Remedy。

## 介质与材质的技术补充

| 官方文档 | 可确证的技术关系 | 转为画面时的边界 |
|---|---|---|
| [SideFX：Pyro look development](https://www.sidefx.com/docs/houdini/pyro/pyro_look.html) | 源形状、时变供给、外力共同塑形；大尺度卷动与高频细节有不同控制；细节过强可变无序噪声 | 提示词描述主翻卷、局部边缘和供给变化，不写求解器参数；平顺层流也是有效设计，不强加湍流 |
| [SideFX：Shading and rendering](https://www.sidefx.com/docs/houdini/pyro/shading.html) | 烟密度/吸收与发光分开；内部光散射、烟对发光的遮蔽能形成层次 | 烟的厚薄、内光与暗部按现象选择，非发光介质不用强加亮芯；不把所有烟都做成火球 |
| [SideFX：Whitewater](https://www.sidefx.com/docs/houdini/fluid/whitewater.html) | 喷溅、泡沫、气泡作为主体流体的次级现象，流动/浮力/表面条件和寿命共同影响 | 主水体、表面泡沫、离水飞滴和细雾分工；不向 H3 输出 FLIP 或粒子寿命参数 |
| [SideFX：RBD Material Fracture](https://www.sidefx.com/docs/houdini/nodes/sop/rbdmaterialfracture-.html) | 混凝土、玻璃与木材有不同断裂模式；冲击点、木纹、破片簇和细碎剥落影响形态 | 按材料和构造写断裂、厚度及残留；金属屈曲、玻璃具体种类等进一步区分是本技能的材料设计应用，不冒称该页覆盖全部材料 |
| [Epic：Volumetric Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-fog-in-unreal-engine) | 参与介质的散射、消光、局部密度和灯光/阴影相互作用 | 写清局部浓淡、遮挡和受光，避免把雾当统一灰滤镜；不把文档中的性能/体素/渲染设置迁入视频提示词 |

## 采用原则与验证范围

vfx-design.md 的总体规则和 vfx-families.md 的十类策略是综合后的提示词设计，包含材料常识、导演选择与用户偏好，不是任何厂商的完整流程复刻。魔法、人工规则几何、无热/无烟/无破坏等设定拥有优先权；不将“物理可信”误写成所有效果都必须产尘、发热或持续残留。

电影/游戏常用贴片、缓存、程序化噪声和艺术调整；这些技术本身不廉价。本技能验收的是可见的深度、材料、时间、光照及剧情关系。不得把“所有东西必须真实模拟”或“全片低饱和、全片慢放”设为唯一合格标准。

本轮可验证：入口与引用可达、原有身份/动作规则保留、文本案例能遵守设定并表达作用/残留。需要真实视频才能验证：粒子时间稳定、实际细节质量、曝光、材质/形体生成、完整动作和最终观看效果。若取得成片，按 quality-gate.md 定位具体失败，保持其余条件尽量一致做针对性复测。
