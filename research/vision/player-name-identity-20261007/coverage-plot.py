"""Plot saved per-player name coverage; this is not an accuracy score."""
import argparse
import json
from pathlib import Path


def main():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', default='artifacts/player-name-optimization-20261007/full-tracking')
    args = parser.parse_args()
    folder = (root / args.folder).resolve()
    if not folder.is_relative_to((root / 'artifacts').resolve()):
        raise ValueError('Coverage artifacts must stay in local artifacts')
    data = json.loads((folder / 'coverage.json').read_text(encoding='utf-8'))
    players = data['players']
    fig, ax = plt.subplots(figsize=(13, 7.5))
    labels = []
    for index, player in enumerate(players):
        visible = player['visiblePositionFrames']
        named = player['namedPositionFrames']
        color = '#ee5568' if int(player['id'][1:]) <= 5 else '#4295ed'
        ax.barh(index, visible, color='#e3e9ee', height=.6)
        ax.barh(index, named, color=color, height=.6)
        names = ' / '.join(player['names']) or 'Unidentified'
        labels.append(f"{player['id']}   {names}")
        percentage = f'{named / visible:.0%}' if visible else 'no positions in this input'
        ax.text(max(visible, named) + 12, index, f'{named}/{visible}  ({percentage})', va='center', fontsize=10)
    ax.set_yticks(range(len(players)), labels)
    ax.invert_yaxis()
    ax.set_xlim(0, max((p['visiblePositionFrames'] for p in players), default=1) * 1.25 + 60)
    ax.set_xlabel('Source frames with a visible bound position')
    ax.set_title('Per-player name evidence coverage', loc='left', fontsize=18, pad=18)
    ax.spines[['top', 'right', 'left']].set_visible(False)
    ax.grid(axis='x', alpha=.2)
    ax.set_axisbelow(True)
    fig.text(.01, .005, 'Color = named position frames; gray = available positions without a supported name. '
             'Machine evidence coverage, not human-verified accuracy.', fontsize=10, color='#46545f')
    fig.tight_layout(rect=(0, .04, 1, 1))
    output = folder / 'name-coverage.png'
    fig.savefig(output, dpi=150, facecolor='white')
    plt.close(fig)
    print(output)


if __name__ == '__main__':
    main()
