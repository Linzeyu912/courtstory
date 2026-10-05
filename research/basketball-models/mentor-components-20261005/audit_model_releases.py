"""Read-only GitHub release audit. Inspect metadata, never execute upstream files."""
import argparse
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import PurePosixPath, Path


CORE = ['Mr81wx/HoopTransformer', 'Mr81wx/HoopEval', 'ytrqua3/Hoop-MSSL']
RELATED = ['Mr81wx/HoopEval_vis_2', 'Mr81wx/EPVDemo',
           'Cesar-Shao/HoopTransformer_Annotation', 'Cesar-Shao/Thoops_NBA',
           'Cesar-Shao/game_res_prediction']
WEIGHTS = {'.ckpt', '.pt', '.pth', '.safetensors', '.onnx', '.h5', '.hdf5', '.pb'}


def asset_links(body):
    # Do not copy email threads, addresses, or account-specific notification URLs.
    return sorted(set(re.findall(r'https://(?:drive\.google\.com|colab\.research\.google\.com)/[^\s<>]+', body or '')))


def github(path, paginate=False):
    cmd = ['gh', 'api', path]
    if paginate:
        cmd += ['--paginate', '--slurp']
    result = subprocess.run(cmd, capture_output=True, encoding='utf-8', check=True)
    data = json.loads(result.stdout)
    return [item for page in data for item in page] if paginate else data


def tree(repo, sha):
    result = github(f'repos/{repo}/git/trees/{sha}?recursive=1')
    blobs = [x for x in result['tree'] if x['type'] == 'blob'
             and 'node_modules/' not in x['path']]
    return {'sha': sha, 'truncated': result.get('truncated'), 'file_count': len(blobs),
            'weight_extension_files': [x for x in blobs
                                       if PurePosixPath(x['path']).suffix.lower() in WEIGHTS],
            'large_or_model_named_files': [x for x in blobs
                 if x.get('size', 0) >= 1000000 or any(word in x['path'].lower()
                    for word in ['checkpoint', 'pretrain', 'weight', 'download', 'license'])]}


def audit(repo):
    base = f'repos/{repo}'
    meta = github(base)
    branches = github(base + '/branches?per_page=100', True)
    tags = github(base + '/tags?per_page=100', True)
    releases = github(base + '/releases?per_page=100', True)
    issues = github(base + '/issues?state=all&per_page=100', True)
    issue_records = []
    for issue in issues:
        comments = github(base + f'/issues/{issue["number"]}/comments?per_page=100', True)
        issue_records.append({'number': issue['number'], 'url': issue['html_url'],
              'title': issue['title'], 'public_asset_links': asset_links(issue['body']), 'state': issue['state'],
              'comments': [{'url': c['html_url'], 'user': c['user']['login'],
                            'public_asset_links': asset_links(c['body'])} for c in comments]})
    tips = {x['commit']['sha'] for x in branches + tags}
    commits = {}
    if repo in CORE:
        for sha in sorted(tips):
            for commit in github(base + f'/commits?sha={sha}&per_page=100', True):
                commits[commit['sha']] = {'sha': commit['sha'],
                    'tree': commit['commit']['tree']['sha'],
                    'date': commit['commit']['committer']['date']}
        tree_ids = {x['tree'] for x in commits.values()}
    else:
        tree_ids = tips
    with ThreadPoolExecutor(max_workers=4) as pool:
        trees = list(pool.map(lambda sha: tree(repo, sha), sorted(tree_ids)))
    return {'repository': repo, 'url': meta['html_url'], 'description': meta['description'],
            'default_branch': meta['default_branch'], 'pushed_at': meta['pushed_at'],
            'is_fork': meta['fork'], 'github_license': meta.get('license'),
            'branches': branches, 'tags': tags,
            'releases': [{'tag': r['tag_name'], 'url': r['html_url'], 'body': r['body'],
                          'assets': [{'name': a['name'], 'bytes': a['size'],
                                      'url': a['browser_download_url']} for a in r['assets']]}
                         for r in releases],
            'issues_including_pull_requests': issue_records,
            'history_scope': 'all commits reachable from public branch and tag tips'
                if repo in CORE else 'public branch and tag tips only',
            'commits': list(commits.values()), 'trees': trees}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {'collected_at_utc': datetime.now(timezone.utc).isoformat(),
        'boundary': 'Public refs, reachable history for three core repositories, releases, '
            'and all issue comments. Filename metadata is evidence of discoverability, '
            'not proof of model contents. Deleted/unreachable/private assets are out of scope.',
        'repositories': []}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for repo, item in zip(CORE + RELATED, pool.map(audit, CORE + RELATED)):
            result['repositories'].append(item)
            print(json.dumps({'repository': repo, 'branches': len(item['branches']),
                'commits': len(item['commits']), 'trees': len(item['trees']),
                'weight_paths': sorted({f['path'] for t in item['trees']
                                      for f in t['weight_extension_files']}),
                'issues': len(item['issues_including_pull_requests'])}), flush=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
