# 三大视觉档位质感词库：3DCG 档、三渲二档 与 真人电影档

这是对用户提供词库的整理，属于提示词美术选择，不是渲染器参数或模型效果保证。按当前选定的视觉档位分别选用词条，三档词库独立使用、互不混杂：
- **默认 3DCG 档（FFVII REMAKE 严格 CG 档）：** 服从 [cg-look.md](cg-look.md) 第一部分，用于默认出稿或用户要求 3DCG。
- **游戏内三渲二实机建模档（《鸣潮》《绝区零》《崩坏：星穹铁道》实机模型档）：** 服从 [cg-look.md](cg-look.md) 第二部分，当用户提及“三渲二”、“3渲2”、“二次元3D建模”或点名上述游戏实机模型风格时采用。
- **真人电影档（院线实拍电影质感档）：** 服从 [cg-look.md](cg-look.md) 第三部分，当用户提及“真人”、“真人电影”、“实拍质感”时采用——核心锁定无深法令纹、无油腻皮肤、低对比度柔和滚降、低饱和度胶片调色与 FACS 内敛微表情演技。

每稿选择与可见材料、场地和情绪有关的短组合，不整库粘贴。

## 一、默认 3DCG 档词库（FFVII REMAKE 严格 CG 档）

优先顺序：完整 CG 模型与身份 → 柔哑皮肤及受控散射 → 方向性柔光 → 各材料独立响应 → 调色与画面稳定。

### 优先保留（3DCG 档）

| 类别 | 精选英文词 | 要写出的画面结果 |
|---|---|---|
| 三维模型 | premium AAA character CG; clean high-fidelity 3D geometry | 同一雕塑角色有清楚轮廓、面部体积及衣层厚度，人物和环境属于同一个 CG 世界；细节不吞没大形 |
| 皮肤 | soft matte CG skin shader; controlled subsurface scattering; fine natural skin microstructure | 柔哑漫反射为主、局部小面积受控高光，薄处在合适逆光下轻微透光，近景细纹理不爬动；保留原有肤色和年龄 |
| 面颊 | even neutral cheek pigmentation | 面颊底色与原肤色协调，不因说话/微笑添加两团粉红；不抹掉指定妆容、伤痕或正常光色 |
| 发型 | clean volumetric hair sections; natural scalp and crown volume; soft continuous anisotropic reflections | 主发束体积、分缝和发际线稳定，次级发丝有间隙；高光顺发向移动，不能变头盔或塑料条 |
| 衣装 | realistic fabric thickness; natural gravity-driven folds; precise structural seams; coherent garment construction | 织纹尺度合景别、缝线附着、边缘有厚度、受力处生成褶皱；布/皮/金属分开，不将全部衣料设为哑光织物 |
| 柔光 | large diffused cinematic key light; gentle ambient fill; soft gradual shadow transitions | 指明场景内主光来源、方向与面积，以柔和过渡塑造体积，补光只保留必要暗部信息，不能抹平明暗 |
| 高光与空间 | smooth filmic highlight roll-off; preserved highlight and shadow detail; soft contact shadows | 亮部平顺收束且不泛白，接触处有合理阴影，前中后景有分离，细节不靠锐化 |
| 调色 | clean neutral color balance; cinematic color separation; realistic skin color reproduction | 同场镜头有一致白平衡和色彩关系，肤色底层稳定，主色与强调色有主次，亮暗保留必要层次 |

### 按条件选用（3DCG 档）

- `subtle warm-cool color contrast`、冷环境加暖主光：场景与叙事支持才用，不固定青橙配方。
- `restrained saturation`、`soft low-contrast cinematic tonality`：适合柔和影调，不强制所有戏低饱和低对比；强情绪、鲜艳魔法和硬光按故事保留。
- `matte woven technical textiles`、尼龙、棉混纺、丝混纺：只用于角色确有的面料，不能改变用户衣装。
- `gentle cinematic rim lighting`、体积雾与光束：要有对应光源和介质，不给每镜添加轮廓灯或烟雾。
- 85mm、平视、居中全身、无影墙、灰/白棚背景：仅角色设定图或用户指定的展示镜。故事分镜按空间、视点、动作和镜头夸张程度选择，85mm 不是全身照或高级 CG 的通用保证；透视还取决于机位距离。
- `MJ-style soft cinematic lighting`：只作审美简称，随后必须落实光向、软硬、明暗和空间层次，不附 MJ 专用参数。

### 改写或不作默认底座

| 原词 | 处理 |
|---|---|
| high-poly digital human; accurate digital human facial anatomy; photorealistic AAA rendering; realistic photography | 改为 sculpted stylized CG character、coherent CG facial volume 和可信 CG 材质，防止滑向真人；用户明确要真人时才切换媒介 |
| UE5 cinematic rendering; physically accurate PBR; high-poly | 可作质量简称，不能替代可见材质、体积和光照描述，不声称视频模型实际调用引擎或物理解算 |
| porcelain-pale skin; natural bare-face appearance | 不自动加入，前者可能改肤色并引发瓷像感，后者可能抹掉既有妆容 |
| matte translucent skin; high skin surface roughness | 改为柔哑表面、局部受控高光和薄处克制透光；不把全脸变半透明，也不统一最高粗糙度 |
| wax-like translucency; luminous skin; glossy/shiny skin | 默认柔哑目标下不选；湿润/油光确由剧情产生时限定部位与时段 |
| ultra-detailed skin microdetails; masterpiece; best quality; 8K | 删去重复质量口号；按景别保留必要细节，避免粗颗粒、过锐和蜡塑观感 |
| large diffused studio softbox; seamless studio cyclorama | 场景照明改写为实际窗、天空或灯具；不把故事背景换成摄影棚 |

### 3DCG 档精简底座

中文写作可直接用：完整三维角色动画，FF7RE 式雕塑模型与精细 CG 材质；保留人物原有身份、年龄和肤色，皮肤柔哑、局部高光受控、薄处轻微散射，立体分束头发具有顺发向高光，衣装厚度与缝线清楚、不同材料各自响应。由场景实际主光塑形，明暗柔和过渡、亮部平顺收束，色彩与空间层次清楚，同场光色与材质跨镜稳定。

英文可裁剪为：`Fully computer-generated stylized AAA character animation with coherent sculpted facial volumes, soft matte CG skin and controlled subsurface scattering, layered volumetric hair clumps with directional highlights, distinct materials and credible garment thickness. A scene-motivated diffused key shapes the forms, with readable shadows, smooth filmic highlight roll-off and coherent color separation.`

---

## 二、游戏内三渲二实机建模词库（用户指定“三渲二”时选用，与 3DCG 区分）

当用户要求“三渲二”时，选用下表中的**游戏内 3D 实机角色模型（In-Game 3D Cel-Shaded Model）**词条，不混用上方 3DCG 档的 `FFVII REMAKE`、`subsurface scattering`、`fine natural skin microstructure` 等半写实词条。

### 优先保留（三渲二档）

| 类别 | 精选英文词 | 要写出的画面结果 |
|---|---|---|
| 游戏内 3D 模型体积 | in-game 3D cel-shaded character model; stylized anime 3D geometry with solid volumetric perspective | 角色具备《鸣潮》《绝区零》《崩坏：星穹铁道》游戏内实机 3D 模型的立体体积与准确透视，转头与大角度机位下保持扎实三维结构，不扁平化为 2D 立绘 |
| SDF 面部二分光影 | clean SDF 2-tone cel-shaded facial lighting; smooth artistic shadow ramp; clean shadow steps across nose and cheeks | 面部受光呈干净利落的二次元二分明暗交界线，明暗交界带柔和色阶（ramp），鼻翼与眼下无杂乱写实黑斑或凹陷阴影 |
| 卡通皮肤与面颊 | smooth poreless matte anime skin shader; restrained neutral cheek color | 纯净哑光无毛孔的二次元三维皮肤，面颊底色均匀克制，说话或大表情不产生写实皱纹、毛孔或油光 |
| 五官与绑定口型 | crisp multi-layered anime iris shader with layered specular highlights; 3D modeled eyelashes; articulated 3D cel-shaded lip-sync and facial blendshapes | 高清多层高光二次元瞳孔与立体眼睫毛，口型与表情由同一 3D 卡通模型连续形变驱动，不切换真人嘴唇 |
| 几何发束与高光环 | sculpted 3D anime hair clumps; clean cel-shaded hair shadow steps; stylized anisotropic angel-ring specular band | 饱满立体的三维几何发束（区别于写实细碎毛发丝），发面明暗色块干净，带顺发束滑动的条带状卡通高光 |
| 混合风格化 PBR 服饰 | hybrid NPR cel-shading and stylized PBR materials; sharp metallic specular facets; sleek high-contrast leather; structured 3D garment folds | 主色块保持清爽卡通色阶，同时鲜明区分锐利金属高光切面、干脆皮革反光、半透明薄纱/丝袜菲涅尔边缘与立体建模衣褶 |
| 描线与硬边轮廓光 | fine variable-width colored inner and outer ink outlines; crisp cel-shaded rim lighting | 极细且粗细受控的本色深化内描线与外轮廓线，配合锐利的卡通硬边轮廓光，将 3D 角色从背景中利落剥离 |

### 三渲二档的改写与区分

| 易混词 | 在三渲二档中的处理 |
|---|---|
| `FFVII REMAKE CG`、`semi-realistic 3D CG`、`soft subsurface scattering`、`fine skin pores` | 在三渲二档中改为 `in-game 3D cel-shaded character model`、`clean SDF 2-tone facial shading`、`smooth poreless anime skin shader`，避免三渲二滑向半写实 3DCG |
| `2D anime illustration`、`splash art`、`flat 2D cel animation`、`hand-drawn 2D frame` | 改为 `volumetric 3D cel-shaded character model with accurate 3D perspective and camera parallax`，避免三维实机建模退化为平面立绘或纯 2D 手绘番剧 |
| `thick black comic outlines`、`heavy manga hatching` | 改为 `fine variable-width colored ink outlines`，保持次世代游戏实机模型的精致边缘 |

### 三渲二档精简底座

以下为通用词例，指定某作品外观时加入对应风格锚。中文可写：采用游戏内三渲二（3D Cel-Shaded）实机角色建模动画：人物为具备扎实三维体积与透视的游戏内 3D 模型，面部采用干净的 SDF 二分卡通光影与柔和色阶过渡，肤质纯净无毛孔、面颊底色克制；三维几何发束分明并带条带状卡通高光；服饰融合风格化 PBR 材质，清晰区分锐利金属高光、挺括皮革与立体衣褶，配以极细本色描线与利落的硬边轮廓光。全片保持游戏内 3D 实机建模质感，与 3DCG 半写实风格明确区分，不退化为 2D 平面立绘或真人观感。

英文可裁剪为：`Stylized in-game 3D cel-shaded character model animation with a high-fidelity anime action RPG aesthetic, featuring solid 3D volumetric geometry, clean SDF 2-tone cel-shaded facial lighting with soft ramp transitions, smooth poreless anime skin with restrained cheek color, sculpted 3D hair clumps with a crisp specular band, fine variable-width colored outlines, crisp rim lighting, and hybrid stylized-PBR materials separating sharp metallic trims, sleek leather and structured 3D cloth folds.`

底座不是全镜必贴模板；全局一次声明，脸部、对白、彩光、急停等风险镜按 [cg-look.md](cg-look.md) 就地补必要锚。先删同义修辞，不删动作、接触、表演与交接证据。

---

## 三、真人电影档词库（用户指定“真人 / 实拍 / 真人电影质感”时选用）

当用户要求“真人”或“真人电影质感”时，选用下表中的**院线级实拍光学电影（Live-Action Cinema Photography）**词条，彻底杜绝 AI 真人常见的“刀刻深法令纹、满脸油光、高对比度死黑、高饱和度糖果色、五官用力过猛”，且不混用 3DCG 或三渲二词条。

### 优先保留（真人电影档）

| 类别 | 精选英文词 | 要写出的画面结果 |
|---|---|---|
| 光学摄影与胶片媒介 | shot on 35mm Kodak Vision3 film / ARRI Alexa 65 large-format cinema camera; Cooke S4 / ARRI Signature Prime optical lens; fine organic film grain | 真实院线大画幅电影摄影机与定焦光学镜头质感，自然的浅景深散景与细腻有机的银盐颗粒，拒绝廉价数码视频感与过度锐化 |
| 去法令纹与饱满面颊 | supple cheek volume; smooth and soft nasolabial transition; relaxed mid-face soft tissue without deep-carved nasolabial folds or harsh marionette creases | 面颊饱满自然，鼻翼至嘴角过渡柔和顺滑，说话、微笑或情绪变化时绝不拉出刀刻般深陷的法令纹、木偶纹或干瘪老态褶皱 |
| 清爽哑光电影肤质（去油光） | natural matte skin finish; soft diffused epidermal reflectance; subtle organic skin micro-texture with fine vellus hair; zero oily sheen or plastic specular glare | 皮肤呈清爽透气的自然哑光微绒漫反射，额头、鼻梁与颧骨绝无油汗反光、蜡像塑料光斑或假人美颜磨皮感 |
| 柔和低对比度与高光滚降 | smooth logarithmic highlight roll-off; soft low-to-medium filmic contrast; gentle shadow fall-off with lifted readable darks; large diffused motivated window/practical key light | 亮部像胶片一样平顺柔和收束不过曝，明暗交界线宽广温润，暗部通透有空气感而不死黑，拒绝刺眼硬光与高对比度数字切割 |
| 克制低饱和电影调色 | restrained desaturated cinema color palette; neutral authentic skin tone reproduction; subtle tonal separation | 整体色彩饱和度克制内敛，肤色还原真实中性（不泛橘红或死白），环境色彩雅致沉稳，拒绝高饱和霓虹糖果色 |
| FACS 亚毫米级内敛演技 | understated screen acting; subtle FACS micro-expression control (trace AU1/AU4/AU7); relaxed lower face and jaw; nuanced ocular focus and natural catchlights; quiet breath modulation | 演员表演克制内敛、毫不费力：靠眼神聚焦、眼睑微张力、呼吸起伏和毫厘级唇角变化传情，中下脸肌肉松弛，绝不用力过猛、挤眉弄眼或张大嘴咆哮 |

### 真人电影档的高危禁用/改写词（防 AI 翻车硬闸）

| 易引发 AI 伪影的词 | 翻车后果 | 在真人电影档中的强制改写 |
|---|---|---|
| `ultra-detailed pores, deep wrinkles, hyper-realistic skin creases, intense facial lines` | 触发 AI 过度雕刻通道，生成刀割般的深法令纹、木偶纹与显老沟壑 | 改为 `supple cheek volume, smooth nasolabial transition, natural matte skin finish with subtle soft micro-texture` |
| `dewy skin, glossy skin, sweaty face, shiny highlights, specular skin reflection` | 变成满脸涂油、塑料反光或刚抹了猪油的劣质 AI 脸 | 改为 `natural matte skin finish, soft diffused skin reflectance, zero oily sheen or plastic glare` |
| `high contrast, dramatic harsh shadows, vibrant colors, rich saturation, HDR, 8K sharp` | 画面像廉价高对比度短视频滤镜，肤色橘红高饱和，暗部死黑 | 改为 `soft low-to-medium filmic contrast, smooth logarithmic highlight roll-off, restrained desaturated cinema color grade` |
| `intense emotional outburst, crying hard, screaming, wide eyes, contorted face, dramatic grimace` | 演员五官乱飞、用力过猛、嘴角剧烈抽动并瞬间拉出深法令纹 | 改为 `understated cinematic performance, subtle FACS micro-expression control, relaxed lower face, emotion carried through quiet gaze and breath` |

### 真人电影档精简底座

中文可写：采用 35mm 胶片与 ARRI Alexa 65 大画幅院线实拍电影摄影质感：演员面部保持平滑饱满的面颊体积与柔和的鼻唇过渡，彻底杜绝深陷的法令纹与沟壑黑影；肤质为自然清爽的哑光微绒漫反射，无油腻反光或塑料蜡感。由场景真实柔光塑形，呈现宽动态范围的对数高光柔和滚降、温和低对比度明暗过渡与克制低饱和度的电影调色。表演遵循大银幕内敛派法则与 FACS 微肌肉控制，中下脸保持松弛，以眼神聚焦、眼睑微张力、呼吸节律与毫米级唇部微动传递深层情绪，自然松弛、绝不用力过猛。

英文可裁剪为：`Live-action cinema photography shot on 35mm film with ARRI Alexa 65 optical characteristics. The actor features supple cheek volume, a smooth nasolabial transition free of deep-carved folds, and a natural matte skin finish with zero oily sheen or plastic specular glare. Lit by soft motivated diffused light with smooth logarithmic highlight roll-off, gentle low-to-medium filmic contrast, and a restrained desaturated color palette. The performance is understated and naturalistic, driven by subtle FACS micro-expressions—nuanced eye focus, trace eyelid tension, quiet breath and a relaxed lower face without melodramatic overacting.`
