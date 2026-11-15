import time, cv2, numpy as np, mediapipe as mp, sys
from mediapipe.tasks.python import vision, BaseOptions
img = cv2.imread(sys.argv[1]); img = cv2.resize(img, (640, int(640*img.shape[0]/img.shape[1])))
mpi = mp.Image(image_format=mp.ImageFormat.SRGBA, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGBA))
for nombre in ['pose_landmarker_heavy', 'pose_landmarker_full']:
  for deleg in [BaseOptions.Delegate.CPU, BaseOptions.Delegate.GPU]:
    try:
      p = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=f'modelos/{nombre}.task', delegate=deleg), running_mode=vision.RunningMode.VIDEO, output_segmentation_masks=True, num_poses=1))
    except Exception as e: print(nombre, deleg, 'falla', str(e)[:120]); continue
    ts=0
    for i in range(5): ts+=33; p.detect_for_video(mpi, ts)
    t=time.perf_counter()
    for i in range(30): ts+=33; r=p.detect_for_video(mpi, ts)
    print(nombre, deleg, f'{(time.perf_counter()-t)/30*1000:.1f} ms', len(r.pose_landmarks), r.segmentation_masks[0].numpy_view().shape if r.segmentation_masks else None)
h = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(base_options=BaseOptions(model_asset_path='modelos/hand_landmarker.task'), running_mode=vision.RunningMode.VIDEO, num_hands=2))
ts=0; t=time.perf_counter()
for i in range(30): ts+=33; r=h.detect_for_video(mpi, ts)
print('hands', f'{(time.perf_counter()-t)/30*1000:.1f} ms', len(r.hand_landmarks))
