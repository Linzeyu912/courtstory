"""One allowlisted catalogue for detector/tracker selection and processing."""
import json
from pathlib import Path

MODEL_CHOICES = json.loads((Path(__file__).resolve().parents[1] / 'configs/tracking/workbench-models.json').read_text(encoding='utf-8'))
PRESETS = MODEL_CHOICES['combinations'] + [item for item in MODEL_CHOICES['legacy'] if 'profile' in item]


def processing_recipe(variant):
    recipe = next((item for item in PRESETS if item['id'] == variant), None)
    if recipe is None:
        raise ValueError('请选择有效的检测器与跟踪器组合。')
    return recipe


def resolve_selection(detector, tracker, variant=None):
    recipe = next((item for item in MODEL_CHOICES['combinations'] if item['detector'] == detector and item['tracker'] == tracker), None)
    if recipe is None or (variant is not None and variant != recipe['id']):
        raise ValueError('检测器、跟踪器与结果版本不匹配。')
    return recipe['id']
