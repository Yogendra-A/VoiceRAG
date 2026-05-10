import os
import ast
import sys
import re

def get_imports(dir_path):
    imports = set()
    for root, _, files in os.walk(dir_path):
        if 'venv' in root or '__pycache__' in root or '.git' in root:
            continue
        for file in files:
            if file.endswith('.py'):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        tree = ast.parse(f.read(), filename=file_path)
                    for node in ast.walk(tree):
                        if isinstance(node, ast.Import):
                            for alias in node.names:
                                imports.add(alias.name.split('.')[0])
                        elif isinstance(node, ast.ImportFrom):
                            if node.module:
                                imports.add(node.module.split('.')[0])
                except Exception as e:
                    pass
    return imports

def main():
    project_dir = r"f:\edge_audio_framework"
    req_file = os.path.join(project_dir, "requirements.txt")
    
    imports = get_imports(project_dir)
    
    # Get standard library modules
    if hasattr(sys, 'stdlib_module_names'):
        stdlib = set(sys.stdlib_module_names)
    else:
        stdlib = set(sys.builtin_module_names)
    stdlib.add('pkg_resources')
    
    # Get internal modules (directories and .py files in root)
    internal_modules = set()
    for item in os.listdir(project_dir):
        if os.path.isdir(os.path.join(project_dir, item)):
            internal_modules.add(item)
        elif item.endswith('.py'):
            internal_modules.add(item[:-3])
            
    # Add known internal ones that might be in subfolders
    internal_modules.update({'core', 'tasks', 'agent', 'agent_memory', 'models', 'utils', 'wake_word_listener', 'run_live', 'fast_run', 'fast_run_file', 'download_models', 'audio_agent', 'audio_io', 'audiolib', 'config', 'crash', 'data_generator', 'export_funcs', 'features_vbx', 'losses', 'memory', 'model_registry', 'policy', 'pytorch_utils', 'remote_utils', 'scripts', 'segmenter', 'sidekit_mfcc', 'thread_returning', 'utilities', 'utils_vad', 'versioneer', 'viterbi_utils'})
    
    third_party_imports = {imp for imp in imports if imp not in stdlib and imp not in internal_modules and not imp.startswith('.')}
    
    try:
        with open(req_file, 'r', encoding='utf-16le', errors='ignore') as f:
            req_content = f.read()
            if not req_content.strip() or '==' not in req_content:
                with open(req_file, 'r', encoding='utf-8', errors='ignore') as f2:
                    req_content = f2.read()
    except Exception as e:
        req_content = ""
        
    reqs = []
    for line in req_content.splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            pkg_name = re.split('==|>=|<=|>|<|~=|@', line)[0].strip().lower()
            reqs.append(pkg_name)
            
    missing = []
    for imp in third_party_imports:
        pkg_name = imp.replace('_', '-').lower()
        
        mappings = {
            'cv2': 'opencv-python',
            'yaml': 'pyyaml',
            'sklearn': 'scikit-learn',
            'pil': 'pillow',
            'soundfile': 'soundfile',
            'speech_recognition': 'speechrecognition',
            'dotenv': 'python-dotenv',
            'torchaudio': 'torchaudio',
            'webrtcvad': 'webrtcvad',
            'onnxruntime': 'onnxruntime',
            'faster_whisper': 'faster-whisper',
            'silero_vad': 'silero-vad',
            'pyannote': 'pyannote.audio',
            'skimage': 'scikit-image',
            'keras': 'keras',
            'tensorflow': 'tensorflow',
            'h5py': 'h5py'
        }
        
        expected_pkg = mappings.get(imp.lower(), pkg_name)
        
        # Check if the expected package name or the import name exists in requirements
        if not any(req == expected_pkg or req == imp.lower() or expected_pkg.replace('-','_') == req.replace('-','_') for req in reqs):
            missing.append(imp)
            
    if missing:
        print("\nPotentially missing dependencies in requirements.txt:")
        for m in sorted(missing):
            print(f"- {m}")
    else:
        print("\nAll imported third-party modules seem to be accounted for in requirements.txt.")

if __name__ == '__main__':
    main()
