"""Load existing YOLOv8 detectors with a fixed architecture allowlist."""
import builtins
import os


def load_detector(path):
    # Keep worker behavior consistent even after court inference enables this
    # setting in the parent server. Never retry with unrestricted pickle loading.
    os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '1'
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    os.environ['YOLO_OFFLINE'] = 'true'
    import torch
    from ultralytics import YOLO
    from ultralytics.nn.modules import Bottleneck, C2f, Concat, Conv, Detect, DFL, SPPF
    from ultralytics.nn.tasks import DetectionModel

    allowed = [DetectionModel, Conv, C2f, Bottleneck, SPPF, Concat, Detect, DFL,
               torch.nn.ModuleList, torch.nn.Sequential, torch.nn.Upsample,
               torch.nn.SiLU, torch.nn.MaxPool2d, torch.nn.Conv2d,
               torch.nn.BatchNorm2d, builtins.getattr]
    allowed_names = {f'{item.__module__}.{item.__name__}' for item in allowed}
    unexpected = set(torch.serialization.get_unsafe_globals_in_checkpoint(path)) - allowed_names
    if unexpected:
        raise ValueError(f'Unexpected checkpoint globals: {sorted(unexpected)}')
    with torch.serialization.safe_globals(allowed):
        return YOLO(str(path))
