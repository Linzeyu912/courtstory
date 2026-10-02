from pathlib import Path
import json,re
script_root=Path(__file__).resolve().parent
root=script_root.parents[1]/'requirements/archive/broadcast-code-12'
# Reuse the established document styles and OOXML helpers without executing the previous authoring block.
code=(script_root/'build_doc.py').read_text(encoding='utf-8').split('\ndef section(name):')[0]
code=code.replace("elif re.match(r'^\\d+\\. ',l):style='List Number';l=re.sub(r'^\\d+\\. ','',l)","elif re.match(r'^\\d+\\. ',l):style='Normal'")
exec(compile(code,str(script_root/'build_doc.py'),'exec'))
for style in doc.styles:
    for border in list(style.element.iter(qn('w:pBdr'))):
        border.getparent().remove(border)
doc.styles['Subtitle'].font.italic=False

def block(text):
    buf=[]
    def flush():
        if buf: content('\n'.join(buf));buf.clear()
    for line in text.splitlines():
        if line.startswith('### '):
            flush();doc.add_heading(line[4:].strip(),2)
        elif line.startswith('## '):
            flush();doc.add_heading(line[3:].strip(),1)
        elif line.startswith('# '):
            continue
        else:buf.append(line)
    flush()

def group(title):
    if title.startswith('一 ') or title.startswith('五 '):doc.add_page_break()
    doc.add_heading(title,1)

doc.add_paragraph('Broadcast Code 12\n赛事理解与报名准备手册',style='Title')
doc.add_paragraph('团队讨论版  2026 年 9 月 17 日',style='Subtitle')
doc.add_paragraph('这份手册帮助我们理解比赛任务，并准备真实、具体、与赛题相关的报名材料。当前首先要争取的是参赛资格；进入澳门 TOP 8 决赛，还需要在珠海初赛交付作品并通过评审。')
doc.add_paragraph('报名准备的核心是把能力与任务对应起来：我们做过什么、各自负责什么、有什么结果和证据，以及这些经验如何用于篮球视频与数据解读。报名筛选权重尚未公开，因此本文提供的是有依据的准备建议，而不是保证入围的公式。')
doc.add_heading('先看这些信息',1)
content('- 报名与组队截止：9 月 23 日；参赛资格公布：9 月 24 日。\n- 组队人数：每队 2 至 3 人；参赛总规模上限 120 人。\n- 10 月 9 日抵达珠海；10 月 10 日初赛选出 TOP 8；10 月 11 日澳门决赛。\n- 核心任务：比赛视频与深度数据分析、视觉标注叠加、与画面同步的篮球解说。\n- 当前最值得准备的内容：个人简介、一次具体开发经历、真实 AWS 经验、篮球理解和线下参赛安排。')
doc.add_heading('阅读顺序',1)
content('1. 赛事要求与赛程：统一我们对比赛的理解。\n2. 报名表与准备指南：逐题梳理事实、经历和证据。\n3. NBA 数据与其他赛事经验：建立准确的知识背景。\n4. 奖项条款与待确认事项：识别需要核实的条件。\n5. 来源索引：需要时返回官方或原始页面。')
doc.add_paragraph('文中“官网要求”“外部赛事规则”“讨论建议”应分别理解。其他赛事的评分、工具限制和提前开发规则，不适用于本届，除非本届组委会另行确认。')
inline(doc.add_paragraph(),'官方入口：[赛事介绍](https://builderx.csdn.net/bcast-code?from=yaofoundation#eligibility)  [报名表](https://marketing.csdn.net/questions/Q2609071804379567473?from=yaofoundation)')

group('一 赛事要求与赛程')
for name in ['比赛做什么','资格与规模','赛程','已公布的评审方向','作品交付']:
    doc.add_heading(name,2);content(parts[name])

group('二 报名表与准备指南')
field,terms=parts['报名表字段清单'].split('报名页显示需同意的条款：',1)
content(field)
guide=(root/'报名准备指南.md').read_text(encoding='utf-8').replace('身份证明、参赛次数的完整下拉选项','当前身份、参赛次数的完整下拉选项')
block(guide)

group('三 NBA 数据与外部赛事参考')
expanded=(root/'expanded/扩展调研与团队讨论资料.md').read_text(encoding='utf-8')
expanded=expanded[expanded.index('## 一 NBA 官方指标说明'):expanded.index('## 资料索引')]
expanded=expanded.replace('## 一 NBA 官方指标说明','## NBA 官方指标说明').replace('## 二 其他黑客松的规则比较','## 其他黑客松的规则比较').replace('## 三 值得阅读的获奖案例','## 值得阅读的获奖案例').replace('## 四 演示和呈现可以提前学习什么','## 演示和呈现可以提前学习什么').replace('## 五 与本届接近但可信度不足的线索','## 与本届接近但可信度不足的线索').replace('## 六 团队下一次讨论可以聚焦的问题','## 团队下一次讨论可以聚焦的问题')
doc.add_paragraph('下面的资料用于帮助理解篮球指标、作品质量与展示方式。它们能支持准备过程，但不能证明本届组委会采用相同的筛选标准。')
block(expanded)

group('四 奖项条款与待确认事项')
doc.add_heading('奖项与保障',2);content(parts['奖项与保障'])
doc.add_heading('报名条款',2);content(terms)
doc.add_heading('需要向组委会核实的问题',2);content(parts['讨论前需要知道的未知项'])
doc.add_paragraph('报名截止前优先确认组队流程、最新字段、参赛条件和条款；取得参赛资格后，优先确认数据接口、技术限制、提前开发边界和作品提交规范。此为团队工作顺序建议。')

group('五 来源索引')
doc.add_paragraph('本手册综合赛事官网、报名页及 17 个扩展来源。网页可能更新，以下链接用于复核。发布时间为空的页面没有统一补写日期。采集日期为 2026 年 9 月 17 日；官网赛程以月日显示，按当前 2026 年招募背景整理。')
content('- [本届赛事官网](https://builderx.csdn.net/bcast-code?from=yaofoundation#eligibility)\n- [本届报名表](https://marketing.csdn.net/questions/Q2609071804379567473?from=yaofoundation)\n- [亚马逊云科技活动条款和条件](https://amazoncloud.cn/legal/eventterms)\n- [亚马逊云科技行为规范](https://amazoncloud.cn/legal/codeofconduct)')
sources=json.loads((root/'expanded/source-index.json').read_text(encoding='utf-8'))
for s in sources:
    p=doc.add_paragraph();inline(p,s['id']+'  ['+s['title']+']('+s['final_url']+')')
    p.paragraph_format.keep_with_next=True
    p=doc.add_paragraph(s['source_type']+('；页面发布时间 '+s['published_date'][:10] if s['published_date'] else ''))
    p.paragraph_format.space_after=Pt(8)
    for r in p.runs:r.font.size=Pt(9)

# Tune table widths by purpose; the comparison matrices need a readable first column.
for t in doc.tables:
    n=len(t.columns)
    if n==3:
        first=t.cell(0,0).text
        ws=[1.0,8.8,7.2] if first=='序号' else [4.0,7.0,6.0]
    else:ws=[3.0,14.0]
    for col,w in zip(t.columns,ws):col.width=Cm(w)
    for row in t.rows:
        for j,c in enumerate(row.cells):
            c.width=Cm(ws[j])
            if n==3 and t.cell(0,0).text!='序号':
                for p in c.paragraphs:p.alignment=WD_ALIGN_PARAGRAPH.LEFT
    for c in t.rows[0].cells:
        for p in c.paragraphs:p.paragraph_format.keep_with_next=True
for p in doc.paragraphs:
    for border in list(p._p.iter(qn('w:pBdr'))):border.getparent().remove(border)
doc.core_properties.title='Broadcast Code 12 赛事理解与报名准备手册'
doc.core_properties.subject='比赛规则 报名准备 真实经历与证据 NBA数据指标 外部赛事参考'
doc.core_properties.author=''
out=root/'Broadcast Code 12 赛事理解与报名准备手册.docx'
doc.save(out)
print(str(out))
print('Tables',len(doc.tables),'Paragraphs',len(doc.paragraphs))
