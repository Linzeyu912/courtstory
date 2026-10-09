# 解说表达材料

由`engineering/scripts/commentary_polish.py`实际读取，供产品模型使用。不是安装到开发助手的全局skill。版本：2026-10-09-v3.1；根据首轮输出偏保守、暂停句变长的问题，补充“听得出态度、避免只换同义词”与短促调侃指导。暂停句预算取原稿粗估加0.5秒与4秒中较大值，容纳少量停顿变化，避免长段子。

- [guide.md](guide.md)：整段口语表达说明。
- [examples.md](examples.md)：8组原创虚构场景示例，不代表当前视频事实。
- [basketball-memes.json](basketball-memes.json)：24条材料，包含NBA文化、球场用语、动作表达和原创场景幽默；不能把全部24条称作互联网既有梗。

下列来源于2026-10-09检索/访问。只记录短事实概括和链接，中文变体为本项目原创；不复制网站全文或假定网站语料已获开源许可。动作参考只证明篮球含义，不证明本项目比喻的历史出处。公开视频条目用于核对标题与人物关联，本轮未逐段观看全部视频。

| source | 来源与核对范围 |
| --- | --- |
| KYM-BBQ | [BBQ Chicken Alert](https://knowyourmeme.com/memes/bbq-chicken-alert)：含义与来源线索；百科仍标Submission，未把每项历史日期写入卡片 |
| NBA-NIGHT | [NBA Night Night](https://www.nba.com/watch/video/stephen-curry-night-night-celebrations)：库里的庆祝关联 |
| NBA-DAME | [NBA Dame Time](https://www.nba.com/watch/video/damian-lillard-clutch-dame-time-bucks-turn-keys-dec-23)：利拉德与关键时刻 |
| NBA-SPLASH | [NBA Curry与Thompson](https://api-hub.nba.com/news/stephen-curry-klay-thompson-keep-sharpening-each-others-games)：称呼与投射关联 |
| NBA-DREAM | [NBA Dream Shake](https://www.nba.com/watch/video/hakeem-olajuwons-signature-move-the-dream-shake)：奥拉朱旺的招牌动作 |
| NBA-FUNDAMENTAL | [Jazz Big Fundamental](https://www.nba.com/jazz/features/favors-learns-big-fundamental)：邓肯与基本功 |
| NBA-WHITE | [Kings Jason Williams](https://www.nba.com/kings/j-will-reminisces-and-reacts-house-highlights)：外号对应人物 |
| NBA-DREW | [Cavaliers Irving](https://www.nba.com/cavaliers/releases/irving-bobblehead-giveaway-130225)：欧文与Uncle Drew关联 |
| NBA-MUTOMBO | [NBA Mutombo tribute](https://www.nba.com/news/nuggets-honor-dikembe-mutombo)：摇手指关联 |
| GQ-TERMS | [GQ Taiwan篮球用语](https://www.gq.com.tw/article/籃球術語)：吃饼含义，非技术实现依据 |
| JR-ALLEY | [Jr. NBA Alley-Oop](https://jr.nba.com/alley-oop-pass/)：空接动作 |
| JR-ASSIST | [Jr. NBA Assists](https://jr.nba.com/assists/)：传球与得分联系 |
| NBA-POSTER | [NBA Poster Dunk](https://www.nba.com/watch/video/victor-wembanyama-with-the-poster-dunk)：官方该词用例 |
| SLANG-HEAT | [Slang.net Heat Check](https://slang.net/meaning/heat_check)：词义；前序手热必须由当前输入支持 |
| FIBA-TERMS | [FIBA Basketball Terminology](https://assets.fiba.basketball/image/upload/documents-corporate-regional-offices-europe-programs-fiba-europe-coaching-certificate-fiba-europe-basketball-terminology.pdf)：掩护、顺下、错位与协防等动作背景；中文比喻原创 |
| TEAM-ORIGINAL | 本项目根据篮球动作创作的联想，非外部已有名梗 |

方法参考[StyleForge](https://github.com/SankarSubbayya/styleforge)、[humor.skill](https://github.com/caicai688/humor.skill)、[nba-weibo-writer](https://github.com/tianyayu6/nba-weibo-writer)。未复制其提示正文、未安装依赖。详细研究和许可核对见[调研](../../../../../research/agents/commentary-personality-20261009.md)。
