import subprocess
import sys
import os

def run_training():
    # Get the path to Python executable
    python_exe = sys.executable
    
    # Get the absolute path to train.py
    script_dir = os.path.dirname(os.path.abspath(__file__))
    train_script = os.path.join(script_dir, "train.py")
    
    # For Windows, use start command to open new terminal
    cmd = f'start cmd /K "{python_exe} {train_script}"'
    subprocess.run(cmd, shell=True)
    
if __name__ == "__main__":
    run_training()