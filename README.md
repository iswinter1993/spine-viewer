# Spine 逆向数据查看器 / 导出器

用 **Spine 官方运行时（spine-webgl 3.8.75）** 在浏览器里打开 `spine_out/` 里的资源，
显示动画，并导出可直接使用的数据。

> 和 `spine_render.py`（我手写的渲染器）不同：这里用的是 **Esoteric Software 的官方实现**，
> 所以"渲染对不对"不再取决于我的代码，而是官方行为。

## 文件

```
index.html       工具本体（单文件，无构建）
spine-webgl.js   官方运行时 3.8.75，来自 spine-runtimes 仓库 3.8 分支
screenshots/     实测截图
_smoke_test.js   无头 Chrome 冒烟测试（用 CDP 驱动，会截图并读工具日志）
```

## 用法

### 方式一：直接打开（最简单）

双击 `index.html`，点左侧 **「选择角色文件夹…」**，
选 `spine_out/<角色>/` 这种目录（里面有同名的 `.json` / `.atlas` / `.png`）。
也可以把文件夹直接拖到右侧画布上。

### 方式二：本地服务器 + 自动载入

```bash
cd /Users/handong/test/spine_tools
python3 -m http.server 8777
# 浏览器打开：
# http://127.0.0.1:8777/spine_viewer/index.html?dir=../spine_out/linqinzhu
```

支持参数：`?dir=<路径>`、`&skin=<skin名>`、`&anim=<动画名>`

## 功能

| 区域 | 说明 |
|---|---|
| **1 载入** | 文件夹选择 / 拖拽 / `?dir=` 自动载入 |
| **2 人物动画** | **skin 多选列表**（显示每个 skin 的槽数，默认勾选部件最多的那个）、**🎲 随机**、**清空**、动画下拉、速度、循环、显示骨骼 |
| **3 视图** | 背景色、**取景模式**（整段动画 / 当前帧）、拖拽平移、滚轮缩放 |
| **4 导出** | 见下 |
| **5 数据信息** | 骨架版本/hash/尺寸/骨骼/插槽/skin/动画/图集区域/图集页 |

### 导出

| 按钮 | 产物 | 用途 |
|---|---|---|
| **导出精灵图集 + JSON** | `<名>_<动画>_sheet.png` + `.json` | Godot `AnimatedSprite2D` + `AtlasTexture`：JSON 里每帧有 `x/y/w/h/time` |
| **导出序列帧 PNG（zip）** | `frame_0000.png…` + `manifest.json` | 逐帧文件，任何引擎都能用 |
| **导出当前帧 PNG** | 单张 PNG（带透明背景） | 参考图 / 头像 |
| **导出清洗后的 Spine 三件套** | `.json` / `.atlas` / `.png` | 给带 Spine 运行时的引擎用（`skeleton.images` 已置空） |
| **批量导出全部 skin（zip）** | 每个 skin 一套 `_sheet.png` + `.json` | **适合「随机弟子」部件库**：一次导出几十上百个弟子外观 |

导出尺寸、帧数、帧率都可调。

## 实测验证结果

用无头 Chrome（CDP 驱动，读工具自身日志 + 截画布）跑过：

```
jingwei     ver=3.8.99  bones=148 slots=55   skins=1   anims=1   regions=55
linqinzhu   ver=3.8.99  bones=188 slots=132  skins=1   anims=2   regions=136
girl        ver=3.8.99  bones=90  slots=507  skins=20  anims=30  regions=505
```

- **官方运行时能直接读我们的数据**，不需要任何修补
- 官方解析出的槽数和 `spine_render.py` **完全一致** → 提取无损
- 导出帧的 alpha 正确：`全透明 71712 / 半透明边缘 9703 / 不透明 8585`（300×300）

截图见 `screenshots/`。

## ⚠️ 灰边 / 黑描边：预乘 alpha（默认已开启）

**症状**：某些小人嘴部、头发、轮廓周围有一圈灰线。典型例子 `lvdongbing_xin_xiaoren`。

**原因**：图集里**全透明像素的 RGB 是 (0,0,0) 纯黑**（实测确认）。
GPU 线性过滤会对 RGB 和 A **分别插值**：

```
不透明肤色 (233,216,197,255)  ←插值→  透明黑 (0,0,0,0)
中间结果      RGB=(116,108,98)  A=128
```

直通 alpha 混合时 `src.rgb * src.a`，RGB 已经**被黑色拉暗一半**，再乘一次 alpha：

```
实际 ≈ 233 × 0.5 × 0.5 = 58   → 灰
```

**放大倍数越高越明显**：这个资产的图集区域只有 8×8 ~ 24×87 像素，
附件却有 73×101 ~ 278×344，**46 个 mesh 里 36 个放大超过 2 倍，最高 16.9 倍**。
一个边缘像素被放大成 10~17 个像素，于是一圈灰线变得肉眼可见。

**解法**：上传贴图前把 RGB 乘以 A 做预乘，混合方式改成 `premultipliedAlpha = true`。

工具里就是「**预乘 alpha**」复选框，**默认已勾选**（`premultiplyImage()` + `rebuildTextures()`）。
关掉可以复现这个问题做对比。截图见 `screenshots/premul_compare.png`。

## 随机弟子（一键生成）

「5. 随机弟子」区块：

| 按钮 | 作用 |
|---|---|
| **🎲 一键生成一个（预览）** | 随机挑一个 skin → 随机动画 → 自动取景，立刻看到结果 |
| **🎲 批量生成并导出 zip** | 生成 N 个，每个一套 `_sheet.png` + `.json`，外加 `index.json` |

随机池会**过滤掉不是人物的 skin**（`default` 特效、`beijian`/`beilou` 背饰、
`body_*` 身体零件、`wuqi`/`item`/`sashui` 武器杂物）。
实测 `girl`：随机池 **16/20**。

「允许组合多个 skin」默认**关闭** —— 整套 skin 本身就是完整外观，
而且两个角色各占各的槽位，组合后包围盒会炸开（实测 465×2070）、画面缩得很小。

实测：`girl` 生成 6 个随机弟子 → `dizi_random_disciples_6.zip` **1.99 MB**，
`index.json` 记录每个弟子的 skin / 动画 / 时长。截图见 `screenshots/random_disciples.png`。

## 「随机弟子」部件库的用法

`girl` / `dizi` / `nvdizi` / `nanzhangmen` / `nvzhangmen` 这些**不是完整角色**，
是给随机弟子功能用的**部件库**：一个骨架装几十套外观，skin 名字混多个前缀正是随机组合的痕迹。

工具里对应三种玩法：

1. **单个浏览** —— 勾一个 skin，看这套外观
2. **🎲 随机** —— 一键随机挑 1~2 个 skin，预览随机弟子
3. **组合** —— 勾多个 skin，用官方 `Skin.addSkin` 叠加
   （后选的覆盖先选的；不同角色占用不同槽位时会叠在一起，这是数据本身的结构）

**批量导出全部 skin** 于 `girl` 实测产出 **19.5 MB zip**（20 个 skin），
`jingwei` 单 skin 产出 303 KB。

## ⚠️ `computeWorldVertices` 的两种签名（踩过的大坑）

这个 bundle 里两种附件的方法签名**不一样**：

```js
RegionAttachment.computeWorldVertices(bone, out, offset, stride)              // 收 bone，没有 count
VertexAttachment.computeWorldVertices(slot, start, count, out, offset, stride) // 收 slot
```

而 `VertexAttachment` 内部第一行是：

```js
count = offset + (count >> 1) * stride;
```

**所以 `count` 必须传浮点数个数（`worldVerticesLength`），不是顶点数。**
传顶点数只会填满数组的一半，**后半段留 0** —— 于是包围盒的 `y0` 永远是 0。

后果（实测）：

| 现象 | 原因 |
|---|---|
| 站在地面的角色看起来正常 | `y0=0` 恰好就是地面，bug 被掩盖 |
| 抬到空中的角色（`feijian_idle`）"看不到小人" | 角色在 y≈1738，包围盒却被算成 0~1993，人物只占画面 23% |
| 画面被拉伸/压扁 | 宽高比被错误的高度撑坏 |
| region 部件漏算、画面被裁 | `RegionAttachment` 传 6 个参数全错位 → 抛异常 → 被 try/catch 吞掉 |

实测 `boy / feijian_idle`：

```
修复前  取景 中心(0.3, 996.3) 范围 417×1993   导出非透明像素 1389   ← 几乎看不见
修复后  取景 中心(0.3, 1738.6) 范围 428×573   导出非透明像素 16867  ← 正常
```

工具里统一走 `attachmentWorldVerts(at, slot)`，按类型分派。

> 注：**渲染本身一直是对的**（`SceneRenderer.drawSkeleton` 内部用的是正确调用），
> 错的只是我自己手算的包围盒。所以是"画面能画对但取景错"。

## 取景（避坑）

- **`computeBounds` 里动画状态只能 `setAnimation` 一次**。
  每轮循环都调会把时间重置回 0，"整段动画的包围盒"其实只算了一个姿势 → 画面看不全。
  这是实测踩到的真 bug，已修。
- 会自动校验：整段动画模式下采样 13 帧，检查每帧是否都落在视野内
  （`girl` / `linqinzhu` 实测**越界 0/13**）。
- 留白 1.22 倍。
- **会大幅度位移的动作**（`walk`/`run`、以及 `feijian_start` 这种"从地面飞到空中"的过渡）
  整段动画的包围盒会很大（实测 722×2260），**请切「当前帧」模式**。
  这类动画本来就需要相机跟随，不是取景算错。

## 已知限制

- 运行时是 **3.8.75**，数据里有 6 个标 `3.8-from-4.0.x` 的资产可能读不了（版本不匹配）。
- `spine.SkeletonBounds` 在这个 bundle 里是坏的（`polygons` 恒为 0），
  所以自动取景是自己用 `attachment.computeWorldVertices` 手算的
  —— 注意 3.8 的签名是 `computeWorldVertices(slot, start, count, out, offset, stride)`，
  少传 `count` 会得到全 0 坐标。
- 导出用的是**主画布**渲染再拷进 2D canvas。之前用第二个 WebGL 上下文，
  对某些资源（如 `girl`）会渲染成全空白；主画布稳定 —— 这是实测结论。
- 组合模式（多选 skin）对 `girl` 这类资源会让不同角色的部件同时出现（各占各的槽位），
  这是数据结构决定的，不是 bug。要单个人物就单选。

## 版权

`spine_out/` 里的美术资源是第三方商业游戏的资产，**只能用于格式/技术验证，不能进入任何发布产品**。
`spine-webgl.js` 是 Esoteric Software 的运行时，遵循其自身授权（Spine 编辑器需付费许可才能导出）。
