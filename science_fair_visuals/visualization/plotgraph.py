import matplotlib.pyplot as plt
import re

# Initialize lists
steps = []
losses = []
train_accs = []
val_accs = []

# Read and parse the log file
with open('ClassificationModel/runs/run_bs128_lr1e-04_ml256_do0.5/step_metrics.txt', 'r') as file:
    for line in file:
        match = re.search(
            r"step=(\d+)\s+epoch=\d+\s+loss=([0-9.]+)\s+train_acc=([0-9.]+)\s+val_acc=([0-9.]+)", 
            line
        )
        if match:
            steps.append(int(match.group(1)))
            losses.append(float(match.group(2)))
            train_accs.append(float(match.group(3)))
            val_accs.append(float(match.group(4)))

# === Plot Loss ===
plt.figure(figsize=(10, 5))
plt.plot(steps, losses, label='Loss', color='blue', marker='o')
plt.yscale('log')  # keep log scale for better visibility if needed
plt.xlabel('Training Step')
plt.ylabel('Loss (log scale)')
plt.title('Training Loss Over Steps')
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.show()

# === Plot Accuracy ===
plt.figure(figsize=(10, 5))
plt.plot(steps, train_accs, label='Train Accuracy', color='green', marker='o')
plt.plot(steps, val_accs, label='Validation Accuracy', color='orange', marker='o')
plt.xlabel('Training Step')
plt.ylabel('Accuracy')
plt.title('Accuracy Over Steps')
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.show()