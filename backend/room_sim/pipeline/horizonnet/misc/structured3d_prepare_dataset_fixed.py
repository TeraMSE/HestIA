import os
import argparse
from tqdm import tqdm

'''
Improved version with error handling and progress reporting.
Skips missing scenes and files instead of crashing.
'''

TRAIN_SCENE = ['scene_%05d' % i for i in range(0, 3000)]
VALID_SCENE = ['scene_%05d' % i for i in range(3000, 3250)]
TEST_SCENE = ['scene_%05d' % i for i in range(3250, 3500)]

parser = argparse.ArgumentParser()
parser.add_argument('--in_root', required=True)
parser.add_argument('--out_train_root', default='data/st3d_train_full_raw_light')
parser.add_argument('--out_valid_root', default='data/st3d_valid_full_raw_light')
parser.add_argument('--out_test_root', default='data/st3d_test_full_raw_light')
args = parser.parse_args()

def prepare_dataset(scene_ids, out_dir, split_name):
    root_img = os.path.join(out_dir, 'img')
    root_cor = os.path.join(out_dir, 'label_cor')
    os.makedirs(root_img, exist_ok=True)
    os.makedirs(root_cor, exist_ok=True)
    
    total_images = 0
    skipped_scenes = 0
    skipped_files = 0
    
    for scene_id in tqdm(scene_ids, desc=f'Processing {split_name}'):
        source_img_root = os.path.join(args.in_root, scene_id, 'rgb')
        source_cor_root = os.path.join(args.in_root, scene_id, 'layout')
        
        # Skip if scene directory doesn't exist
        if not os.path.isdir(source_img_root) or not os.path.isdir(source_cor_root):
            skipped_scenes += 1
            continue
        
        try:
            for fname in os.listdir(source_cor_root):
                room_id = fname.split('_')[0]
                source_img_path = os.path.join(args.in_root, scene_id, 'rgb', room_id + '_rgb_rawlight.png')
                source_cor_path = os.path.join(args.in_root, scene_id, 'layout', room_id + '_layout.txt')
                
                # Skip if files don't exist
                if not os.path.isfile(source_img_path) or not os.path.isfile(source_cor_path):
                    skipped_files += 1
                    continue
                
                target_img_path = os.path.join(root_img, '%s_%s.png' % (scene_id, room_id))
                target_cor_path = os.path.join(root_cor, '%s_%s.txt' % (scene_id, room_id))
                
                try:
                    # Skip if symlink already exists
                    if not os.path.exists(target_img_path):
                        os.symlink(source_img_path, target_img_path)
                    if not os.path.exists(target_cor_path):
                        os.symlink(source_cor_path, target_cor_path)
                    total_images += 1
                except Exception as e:
                    print(f"  Warning: Failed to create symlink for {scene_id}_{room_id}: {e}")
                    skipped_files += 1
        except Exception as e:
            print(f"  Warning: Error processing {scene_id}: {e}")
            skipped_scenes += 1
    
    print(f"\n{split_name} Summary:")
    print(f"  Total images linked: {total_images}")
    print(f"  Skipped scenes: {skipped_scenes}")
    print(f"  Skipped files: {skipped_files}")
    return total_images

print("Starting dataset preparation...")
train_count = prepare_dataset(TRAIN_SCENE, args.out_train_root, 'TRAIN')
valid_count = prepare_dataset(VALID_SCENE, args.out_valid_root, 'VALID')
test_count = prepare_dataset(TEST_SCENE, args.out_test_root, 'TEST')

print("\n" + "="*50)
print("FINAL SUMMARY:")
print(f"  Train images: {train_count}")
print(f"  Valid images: {valid_count}")
print(f"  Test images: {test_count}")
print(f"  Total: {train_count + valid_count + test_count}")
print("="*50)
