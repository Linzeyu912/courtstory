"""Read-only inventory of public upstream assets; no account data or secrets."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from datetime import datetime, timezone
import requests


def github(path):
    return json.loads(subprocess.check_output(['gh','api',path],encoding='utf-8'))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report={'collected_at_utc':datetime.now(timezone.utc).isoformat(),'repositories':[],
            'boundary':'Current public default-branch trees and GitHub releases; not all private assets or git history.'}
    for name in ['HoopTransformer','HoopEval','HoopEval_vis_2','HoopPad','CBA-Shiny','video_clipmark']:
        base='repos/Mr81wx/'+name
        meta=github(base)
        commit=github(base+'/commits/'+meta['default_branch'])['sha']
        tree=github(base+'/git/trees/'+commit+'?recursive=1')
        entries=[e for e in tree['tree'] if e['type']=='blob' and not e['path'].startswith('node_modules/')]
        # Only metadata is inspected for unknown files, never their content.
        weights=[{'path':e['path'],'bytes':e.get('size')} for e in entries if Path(e['path']).suffix.lower() in ['.ckpt','.pt','.pth','.safetensors','.onnx','.h5']]
        licenses=[e['path'] for e in entries if Path(e['path']).name.lower().startswith(('license','copying'))]
        releases=github(base+'/releases')
        report['repositories'].append({'name':name,'url':meta['html_url'],'commit':commit,
            'branch':meta['default_branch'],'pushed_at':meta['pushed_at'],
            'github_license':meta.get('license'),'license_paths':licenses,'weight_paths':weights,
            'releases':[{'tag':r['tag_name'],'assets':[{'name':a['name'],'bytes':a['size'],'url':a['browser_download_url']} for a in r['assets']]} for r in releases],
            'tree_truncated':tree.get('truncated'),'files_excluding_node_modules':len(entries)})
    report['discovery']={}
    for name in ['HoopTransformer','HoopEval','Hoop-MSSL']:
        try:
            r=github('search/repositories?q='+name)
            report['discovery'][name]={'github_total':r['total_count'],
                'github_repositories':[x['full_name'] for x in r['items']]}
        except Exception as exc:report['discovery'][name]={'github_error':str(exc)}
        for kind in ['models','datasets']:
            try:
                r=requests.get('https://huggingface.co/api/'+kind,params={'search':name,'limit':30},timeout=30)
                r.raise_for_status()
                report['discovery'][name]['huggingface_'+kind]=[x['id'] for x in r.json()]
            except Exception as exc:report['discovery'][name]['huggingface_'+kind]={'error':str(exc)}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True))


if __name__=='__main__':main()
