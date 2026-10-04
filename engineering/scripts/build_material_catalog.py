"""Merge completed AI reviews into per-clip labels and a usable material catalog."""
import csv
import html
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT/'artifacts/material-review-20261003'
OUT = ROOT/'data/videos/reviews/2026-10-03'
DECISIONS = {'retain': '保留', 'exclude': '剔除', 'uncertain': '待确认'}
QUALITY = {'clear': '清晰', 'usable': '可用', 'poor': '不清晰'}


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    original=WORK/'before'/path.relative_to(ROOT)
    source=original if original.exists() else path
    indent=2
    if source.exists():
        match=re.search(r'^([ ]+)"',source.read_text(encoding='utf-8'),re.M)
        if match:indent=len(match.group(1))
    path.write_text(json.dumps(value, ensure_ascii=False, indent=indent)+'\n', encoding='utf-8', newline='\n')


def main():
    inventory = json.loads((WORK/'inventory.json').read_text(encoding='utf-8'))
    lookup = {r['clip_id']:r for r in inventory}
    reviews = {}
    result_paths=sorted((WORK/'results').glob('batch-*.json'))
    if (WORK/'results/quality-overrides.json').exists():
        result_paths.append(WORK/'results/quality-overrides.json')
    for path in result_paths:
        for review in json.loads(path.read_text(encoding='utf-8')):
            cid = review['clip_id']
            assert cid in lookup, f'Unknown review: {cid}'
            if path.name=='quality-overrides.json':
                assert cid in reviews and review.get('second_review') is True, cid
                review['first_review_summary']={k:reviews[cid][k] for k in ('decision','quality','reason')}
            else:
                assert cid not in reviews, f'Duplicate review: {cid}'
            assert review['decision'] in DECISIONS and review['quality'] in QUALITY, cid
            assert set(review['evidence_sheets']) == set(lookup[cid]['contact_sheets']), f'Missing contact pages: {cid}'
            assert review['reviewer_model'] == 'gpt-6.1-sol', cid
            assert review['reason'] and review['action_tags'] and review['difficulty_tags'], cid
            if review['decision']=='exclude':
                assert len(review['extra_frames'])>=2, f'Excluded without full-size frame check: {cid}'
            for frame in review['extra_frames']:
                assert (ROOT/frame).exists(), frame
            duration=lookup[cid]['video']['duration_seconds']
            for interval in review['issue_intervals']:
                assert 0 <= interval['start'] <= interval['end'] <= duration+1, f'Invalid interval: {cid}'
                interval['start']=round(min(interval['start'],duration),3)
                interval['end']=round(min(interval['end'],duration),3)
            if review['quality']=='usable' and any('运动拖影' in i['issue'] or '运动模糊' in i['issue'] for i in review['issue_intervals']):
                if '运动拖影' not in review['difficulty_tags']:
                    review['difficulty_tags'].append('运动拖影')
            reviews[cid] = review
    assert set(reviews)==set(lookup), f"Missing reviews: {sorted(set(lookup)-set(reviews))}"
    stamp = datetime.now().astimezone().isoformat(timespec='seconds')
    records = []
    for row in inventory:
        review = reviews[row['clip_id']]
        record = {**review, 'path':row['path'], 'dataset_id':row['dataset_id'],
                  'sha256':row['sha256'], 'video':row['video'], 'reviewed_at':stamp,
                  'human_reviewed':False, 'sample_count':row['sample_count'],
                  'evidence_location':'contact sheets and extra frames are local under artifacts/',
                  'selection_scope':'use_catalog_only; original asset remains available',
                  'tier':('primary' if review['quality']=='clear' else 'challenge') if review['decision']=='retain' else review['decision']}
        # AI material selection is separate from original collector/game/tactic evidence.
        shared = {k:v for k,v in record.items() if k not in {'evidence_sheets','extra_frames','video','path','dataset_id'}}
        shared['catalog_path'] = 'data/videos/reviews/2026-10-03/review.json'
        label_path = ROOT/row['label_path']
        label = json.loads(label_path.read_text(encoding='utf-8'))
        label['material_review'] = shared
        dump(label_path, label)
        records.append(record)
    for manifest_path in sorted({r['manifest_path'] for r in inventory}):
        path = ROOT/manifest_path
        manifest = json.loads(path.read_text(encoding='utf-8'))
        for entry in manifest['entries']:
            record = reviews[entry['clip_id']]
            entry['material_review'] = {
                'decision':record['decision'], 'quality':record['quality'],
                'action_tags':record['action_tags'], 'difficulty_tags':record['difficulty_tags'],
                'reason':record['reason'], 'review_method':record['review_method'],
                'reviewer_model':'gpt-6.1-sol', 'human_reviewed':False, 'reviewed_at':stamp,
                'catalog_path':'data/videos/reviews/2026-10-03/review.json',
            }
        dump(path, manifest)
    counts = Counter(r['decision'] for r in records)
    package = {'schema_version':'1.0.0', 'created_at':stamp, 'timezone':'America/New_York',
               'reviewer_model':'gpt-6.1-sol', 'review_method':'ai_dense_frame_review_2fps',
               'human_reviewed':False, 'sample_count':sum(r['sample_count'] for r in records),
               'counts':dict(counts), 'entries':records}
    dump(OUT/'review.json', package)
    dump(OUT/'selected.json', {**{k:v for k,v in package.items() if k!='entries'}, 'entry_count':counts['retain'],
                              'entries':[r for r in records if r['decision']=='retain']})
    dump(OUT/'clear.json', {'schema_version':'1.0.0','created_at':stamp,
                          'entry_count':sum(r['tier']=='primary' for r in records),
                          'entries':[r for r in records if r['tier']=='primary']})
    columns = ['片段ID','目录分组','状态','清晰度','可见动作标签','动作说明','画面范围','镜头与难点','异常时间段','用途','理由','视频路径','审核方式']
    with (OUT/'catalog.csv').open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.writer(handle)
        writer.writerow(columns)
        for r in records:
            intervals='；'.join(f"{i['start']}–{i['end']}秒：{i['issue']}" for i in r['issue_intervals'])
            writer.writerow([r['clip_id'],{'primary':'清晰主目录','challenge':'难点补充','exclude':'剔除','uncertain':'待确认'}[r['tier']],DECISIONS[r['decision']],QUALITY[r['quality']], '、'.join(r['action_tags']),
                             r['action_description'],r['scope'],'、'.join(r['difficulty_tags']),intervals,
                             r['usefulness'],r['reason'],r['path'],'GPT-6.1 Sol / 2fps AI抽帧审核'])
    groups=defaultdict(list)
    for r in records:
        if r['decision']=='retain':
            for tag in r['difficulty_tags']:
                groups[tag].append(r)
    difficulty_lines=['# 难点覆盖与代表素材','',
                      '只统计可用目录中的素材；每类选最多三段代表，其他清晰素材继续保留，可按用途选择。动作相似不等于内容重复。','',
                      '| 难点 / 画面类型 | 可用片段数 | 代表片段 |','|---|---:|---|']
    representatives={}
    for tag, rows in sorted(groups.items()):
        # Prefer clarity and diverse visible actions, rather than deleting useful peers.
        ordered=sorted(rows,key=lambda r:(r['quality']!='clear',-len(r['action_tags']),r['clip_id']))
        chosen=[]
        used=set()
        for r in ordered:
            key=tuple(sorted(r['action_tags']))
            if key not in used:
                chosen.append(r);used.add(key)
            if len(chosen)==3:break
        for r in ordered:
            if len(chosen)==3:break
            if r not in chosen:chosen.append(r)
        representatives[tag]=[r['clip_id'] for r in chosen]
        links='、'.join(f"[{r['clip_id']}](../../{r['path'].removeprefix('data/videos/')})" for r in chosen)
        difficulty_lines.append(f'| {tag} | {len(rows)} | {links} |')
    (OUT/'difficulty-coverage.md').write_text('\n'.join(difficulty_lines)+'\n',encoding='utf-8',newline='\n')
    dump(OUT/'representatives.json',representatives)
    lines=['# 素材审核目录','',f"审核日期：{stamp}。共 {len(records)} 条：保留 {counts['retain']}、剔除 {counts['exclude']}、待确认 {counts['uncertain']}。",'',
           '[筛选与播放目录](index.html) · [Excel 可读目录](catalog.csv) · [清晰素材 JSON](clear.json) · [含难点补充的可用目录](selected.json) · [全部审核记录](review.json) · [难点代表](difficulty-coverage.md)','',
           '审核由 GPT-6.1 Sol 子 agent 实际查看 2fps 时间序列图完成；必要时补看原尺寸帧。AI 抽帧审核不是真人审核或逐帧真值，镜头异常时间为近似范围，不宣称正常速度、球员实名、完整战术或米制精度已验收。', '',
           '剔除条目不进入可用素材目录。源文件与既有固定编号、来源、比赛信息、旧标签保留，避免破坏工作台和历史引用。逐段新标签在原 labels 文件的 material_review 字段，清单也有筛选摘要。','',
           '清晰素材归入 primary；轻微运动拖影等仍可辨认主要动作的素材单列 challenge，不混入清晰素材入口；核心内容无法辨认则 exclude。尺寸不代替画质判断，推拉、半场、遮挡本身不导致剔除。','',
           '当前使用目录以本轮 material_review 的动作 / 难点为准；既有 tactic 等字段保留前次采集口径，二者出现差异时可通过本轮可见动作说明追溯，不将旧字段当作本轮重新确认。','',
           '重新准备审核图：在仓库根目录运行 `python engineering/scripts/prepare_material_review.py`（需 FFmpeg 与 Pillow）。该脚本只生成本机审核图和批次，不产生视觉判断。子 agent 审核完成后，运行 `python engineering/scripts/build_material_catalog.py` 汇总本机结果并更新标签 / 目录；不得用生成审核图替代实际看片。','',
           '| 片段 ID | 状态 | 清晰度 | 可见动作 | 难点 | 理由 |','|---|---|---|---|---|---|']
    for r in records:
        values=[f"[{r['clip_id']}](../../{r['path'].removeprefix('data/videos/')})",DECISIONS[r['decision']],QUALITY[r['quality']],
                '、'.join(r['action_tags']),'、'.join(r['difficulty_tags']),r['reason']]
        lines.append('| '+' | '.join(v.replace('|','／').replace('\n',' ') for v in values)+' |')
    (OUT/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf-8',newline='\n')
    data=json.dumps(records,ensure_ascii=False).replace('<','\\u003c')
    page=r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>视频素材目录</title>
<style>body{font:15px/1.6 system-ui,sans-serif;margin:0;background:#f5f6f7;color:#20272c}main{max-width:1500px;margin:auto;padding:32px}h1{margin:0;font-size:30px}p{color:#59636c}input,select,button{font:inherit;padding:9px 12px;border:1px solid #ccd2d8;border-radius:5px;background:white}input{min-width:300px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.table{overflow:auto;background:white;border:1px solid #dbe0e4}table{border-collapse:collapse;width:100%;min-width:1050px}td,th{text-align:left;padding:12px;vertical-align:top;border-bottom:1px solid #e5e8eb}th{background:#eaf0f2}small{color:#66727b}.tags{font-size:13px}.id{white-space:nowrap;font-size:13px}dialog{width:min(1000px,90vw);border:0;border-radius:8px}video{width:100%;max-height:70vh;background:#111}#count{margin-left:auto;align-self:center}a{color:#126479}button{cursor:pointer}</style>
<main><h1>视频素材目录</h1><p>DATA_COUNT 段已审核 · GPT‑6.1 Sol · 2fps AI 密集抽帧审核，疑点补看原尺寸帧。默认显示清晰素材，仍有价值的困难画面单列。</p>
<p>半场、推拉和遮挡可作为难点样本；剔除条目保留理由和原始资产。动作描述属于本轮 AI 观察，不代表真人真值。</p>
<a href="catalog.csv">下载 CSV</a> · <a href="difficulty-coverage.md">难点代表</a> · <a href="selected.json">可用目录 JSON</a>
<nav><input id="q" placeholder="搜索动作、难点、编号或理由"><select id="state"><option value="primary">清晰素材</option><option value="challenge">难点补充</option><option value="retain">全部可用</option><option value="all">全部审核记录</option><option value="exclude">已剔除</option><option value="uncertain">待确认</option></select><select id="tag"><option value="">全部难点</option></select><span id="count"></span></nav>
<div class="table"><table><thead><tr><th>编号 / 播放</th><th>状态 / 质量</th><th>可见动作与用途</th><th>范围 / 镜头难点</th><th>筛选理由与异常</th></tr></thead><tbody id="rows"></tbody></table></div></main>
<dialog id="player"><button id="close">关闭</button><p id="title"></p><video controls id="video"></video></dialog>
<script>const data=REVIEW_DATA;const states={retain:'保留',exclude:'剔除',uncertain:'待确认'},quality={clear:'清晰',usable:'可用',poor:'不清晰'};const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));for(const t of [...new Set(data.flatMap(r=>r.difficulty_tags))].sort()){const o=document.createElement('option');o.value=t;o.textContent=t;$('tag').append(o)}function render(){const q=$('q').value.toLowerCase();const rows=data.filter(r=>($('state').value==='all'||r.decision===$('state').value||r.tier===$('state').value)&&(!$('tag').value||r.difficulty_tags.includes($('tag').value))&&JSON.stringify(r).toLowerCase().includes(q));$('count').textContent=rows.length+' 段';$('rows').innerHTML=rows.map(r=>`<tr><td class="id">${esc(r.clip_id)}<br><button data-play="${esc(r.clip_id)}">播放原视频</button><br><small>${r.video.width}×${r.video.height} · ${r.video.duration_seconds.toFixed(2)}秒</small></td><td>${states[r.decision]}<br>${quality[r.quality]}</td><td><b>${esc(r.action_tags.join(' · '))}</b><br>${esc(r.action_description)}<br><small>${esc(r.usefulness)}</small></td><td>${esc(r.scope)}<br><span class="tags">${esc(r.difficulty_tags.join(' · '))}</span><br><small>${esc(r.camera)}</small></td><td>${esc(r.reason)}<br><small>${esc(r.issue_intervals.map(i=>i.start+'–'+i.end+'秒：'+i.issue).join('；'))}</small></td></tr>`).join('')}for(const id of ['q','state','tag'])$(id).addEventListener('input',render);$('rows').addEventListener('click',e=>{const id=e.target.dataset.play;if(!id)return;const r=data.find(r=>r.clip_id===id);$('title').textContent=id+' · '+r.action_tags.join(' / ');$('video').src='../../'+r.path.replace(/^data\/videos\//,'');$('player').showModal()});$('close').onclick=()=>{$('video').pause();$('video').removeAttribute('src');$('video').load();$('player').close()};$('player').addEventListener('cancel',()=>{$('video').pause()});render();</script></html>'''
    (OUT/'index.html').write_text(page.replace('DATA_COUNT',str(len(records))).replace('REVIEW_DATA',data),encoding='utf-8',newline='\n')
    print(json.dumps({'reviewed':len(records),'counts':dict(counts),'difficulty_types':len(groups)},ensure_ascii=True))


if __name__=='__main__':
    main()
